"""mxwp-roundtrip — 폴더 안의 .docx 들을 라운드트립 API 로 일괄 정규화.

사용 예시
=========
    # 컨테이너 안에서 (api 컨테이너의 venv 사용)
    mxwp-roundtrip \\
        --input  /data/whitepapers/raw \\
        --output /data/whitepapers/normalized \\
        --base-url http://localhost:8000 \\
        --token   "$MXWP_API_TOKEN" \\
        --concurrency 4

`--input` 폴더의 모든 `*.docx` 를 API `POST /api/v1/imports/docx/roundtrip`
로 보내고 결과를 `--output` 폴더에 `<원본>.normalized.docx` 로 떨군다.
DB / MinIO 영구화는 일어나지 않는다 — 양식 정규화 전용.

사이드카 리포트
---------------
파일별: ``<원본>.normalized.report.json``  (성공 시)
        ``<원본>.report.json``             (실패 시 — docx 출력 없음)
        ``<원본>.toc-report.json``         (TOC 휴리스틱 약함 또는 missing/extra 존재 시)

폴더 전체: ``--output/_report.json`` — 모든 파일의 집계 결과.

종료 코드
---------
* 0 — 전체 성공
* 1 — 인자/환경 오류
* 2 — 일부 또는 전체 파일 실패 (`--continue-on-error` 가 아니면 첫 실패에서 abort)
"""
from __future__ import annotations

import argparse
import concurrent.futures as _fut
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "httpx is required for mxwp-roundtrip (already in api deps). "
        f"import failed: {e}"
    ) from e


DOCX_MIME = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


# ── result records ───────────────────────────────────────────────────
@dataclass
class FileResult:
    source: str
    output: str | None = None
    ok: bool = False
    status: int | None = None
    error: str | None = None
    sections: int = 0
    images: int = 0
    tables: int = 0
    warnings: list[str] = field(default_factory=list)
    toc_found: bool = False
    toc_method: str = ""
    toc_weak: bool = False
    toc_entries: int = 0
    toc_missing: list[str] = field(default_factory=list)
    toc_extra: list[str] = field(default_factory=list)
    elapsed_seconds: float = 0.0


@dataclass
class AggregateReport:
    started_at: str
    ended_at: str
    total: int
    succeeded: int
    failed: int
    skipped: int
    concurrency: int
    base_url: str
    options: dict[str, Any]
    files: list[dict[str, Any]] = field(default_factory=list)


# ── CLI plumbing ─────────────────────────────────────────────────────
def _add_bool_flag(
    parser: argparse.ArgumentParser, name: str, default: bool, help_text: str
) -> None:
    """`--flag / --no-flag` 페어를 한 번에 추가하는 헬퍼.

    `action='store_true' + dest=...` 패턴을 직접 쓰면 --no-... 일 때 메시지가
    어색해서, BooleanOptionalAction 으로 통일한다.
    """
    parser.add_argument(
        f"--{name}",
        action=argparse.BooleanOptionalAction,
        default=default,
        help=help_text,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="mxwp-roundtrip",
        description=(
            "Round-trip every .docx in --input through the MXWP normalisation "
            "API and drop the results in --output. Does NOT persist to DB."
        ),
    )
    p.add_argument(
        "--input",
        "-i",
        required=True,
        type=Path,
        help="source folder containing *.docx files (recursive)",
    )
    p.add_argument(
        "--output",
        "-o",
        required=True,
        type=Path,
        help="destination folder; '<name>.normalized.docx' is written per file",
    )
    p.add_argument(
        "--base-url",
        default=os.environ.get("MXWP_API_BASE_URL", "http://localhost:8000"),
        help="API base URL (env: MXWP_API_BASE_URL). Default http://localhost:8000",
    )
    p.add_argument(
        "--token",
        default=os.environ.get("MXWP_API_TOKEN"),
        help="bearer token for the API (env: MXWP_API_TOKEN)",
    )
    p.add_argument(
        "--concurrency",
        "-c",
        type=int,
        default=4,
        help="parallel uploads. Default 4. Reasonable cap for a single API worker",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="per-request timeout in seconds. Default 120",
    )
    _add_bool_flag(
        p, "strip-toc", True,
        "strip manually-authored TOC before re-exporting (default on)",
    )
    _add_bool_flag(
        p, "verify-toc", True,
        "compare TOC against body headings and report missing chapters (default on)",
    )
    p.add_argument(
        "--aggressive-toc",
        action="store_true",
        default=False,
        help="enable heuristic 'D' TOC detection (header + leader-dot lines)",
    )
    p.add_argument(
        "--skip-existing",
        action="store_true",
        default=False,
        help="skip files whose normalized output already exists in --output",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="enumerate files and print what would happen — no HTTP calls",
    )
    p.add_argument(
        "--continue-on-error",
        action="store_true",
        default=False,
        help="keep processing the rest of the queue after a failure (default: abort)",
    )
    p.add_argument(
        "--report",
        type=Path,
        default=None,
        help="aggregate report path (default: <output>/_report.json)",
    )
    p.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        default=False,
        help="suppress per-file progress lines",
    )
    return p


# ── core: per-file processing ────────────────────────────────────────
def _post_one(
    client: httpx.Client,
    *,
    path: Path,
    strip_toc: bool,
    verify_toc: bool,
    aggressive_toc: bool,
    timeout: float,
) -> tuple[int, dict[str, str], bytes]:
    """Send one .docx to the roundtrip API; return (status, headers, body)."""
    with path.open("rb") as fh:
        files = {"file": (path.name, fh, DOCX_MIME)}
        data = {
            "strip_toc": "true" if strip_toc else "false",
            "verify_toc": "true" if verify_toc else "false",
            "aggressive_toc": "true" if aggressive_toc else "false",
        }
        resp = client.post(
            "/api/v1/imports/docx/roundtrip",
            files=files,
            data=data,
            timeout=timeout,
        )
    return resp.status_code, dict(resp.headers), resp.content


def _parse_summary_header(headers: dict[str, str]) -> dict[str, Any]:
    """Pull `X-MXWP-Roundtrip-Summary` out as a dict; tolerate truncation."""
    raw = headers.get("x-mxwp-roundtrip-summary") or headers.get(
        "X-MXWP-Roundtrip-Summary"
    )
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _process_file(
    client: httpx.Client,
    src: Path,
    out_dir: Path,
    args: argparse.Namespace,
) -> FileResult:
    """One file end-to-end: API call, write .docx, write sidecar."""
    out_name = src.stem + ".normalized.docx"
    out_path = out_dir / out_name
    started = time.monotonic()

    if args.skip_existing and out_path.exists():
        return FileResult(
            source=str(src),
            output=str(out_path),
            ok=True,
            status=0,
            error="skipped (already exists)",
            elapsed_seconds=0.0,
        )

    try:
        status, headers, body = _post_one(
            client,
            path=src,
            strip_toc=args.strip_toc,
            verify_toc=args.verify_toc,
            aggressive_toc=args.aggressive_toc,
            timeout=args.timeout,
        )
    except (httpx.RequestError, httpx.HTTPError) as e:
        return FileResult(
            source=str(src),
            ok=False,
            error=f"transport error: {e!s}",
            elapsed_seconds=time.monotonic() - started,
        )

    elapsed = time.monotonic() - started
    if status != 200:
        # API envelope error body is JSON; surface the message if we can read it
        try:
            err_body = json.loads(body.decode("utf-8", errors="replace"))
            err_msg = (
                err_body.get("error", {}).get("message")
                if isinstance(err_body, dict)
                else None
            )
        except json.JSONDecodeError:
            err_msg = None
        result = FileResult(
            source=str(src),
            ok=False,
            status=status,
            error=err_msg or f"HTTP {status}",
            elapsed_seconds=elapsed,
        )
        _write_sidecar(out_dir, src, result, suffix=".report.json")
        return result

    summary = _parse_summary_header(headers)
    result = FileResult(
        source=str(src),
        output=str(out_path),
        ok=True,
        status=status,
        sections=int(headers.get("x-mxwp-roundtrip-sections") or 0),
        images=int(headers.get("x-mxwp-roundtrip-images") or 0),
        tables=int(headers.get("x-mxwp-roundtrip-tables") or 0),
        warnings=list(summary.get("warnings") or []),
        toc_found=(headers.get("x-mxwp-roundtrip-toc-found") == "true"),
        toc_method=headers.get("x-mxwp-roundtrip-toc-method", "") or "",
        toc_weak=(headers.get("x-mxwp-roundtrip-toc-heuristic") == "weak"),
        toc_entries=int(headers.get("x-mxwp-roundtrip-toc-entries") or 0),
        toc_missing=list(summary.get("toc_missing") or []),
        toc_extra=list(summary.get("toc_extra") or []),
        elapsed_seconds=elapsed,
    )

    out_path.write_bytes(body)
    _write_sidecar(out_dir, src, result, suffix=".normalized.report.json")

    # TOC 가 의심스러우면 별도 sidecar (eyeball 용)
    if result.toc_found and (
        result.toc_weak or result.toc_missing or result.toc_extra
    ):
        _write_sidecar(out_dir, src, result, suffix=".toc-report.json")

    return result


def _write_sidecar(
    out_dir: Path, src: Path, result: FileResult, *, suffix: str
) -> None:
    path = out_dir / (src.stem + suffix)
    payload = asdict(result)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── entry point ──────────────────────────────────────────────────────
def _enumerate_inputs(root: Path) -> list[Path]:
    if root.is_file() and root.suffix.lower() == ".docx":
        return [root]
    if not root.is_dir():
        return []
    out = sorted(
        p for p in root.rglob("*.docx")
        if p.is_file() and not p.name.startswith(".")
        and ".normalized." not in p.name  # don't re-process our own output
    )
    return out


def _build_client(base_url: str, token: str | None) -> httpx.Client:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(base_url=base_url, headers=headers)


def run(args: argparse.Namespace) -> int:
    in_dir: Path = args.input
    out_dir: Path = args.output
    if not in_dir.exists():
        print(f"error: --input not found: {in_dir}", file=sys.stderr)
        return 1
    out_dir.mkdir(parents=True, exist_ok=True)

    files = _enumerate_inputs(in_dir)
    if not files:
        print(f"warning: no .docx files found under {in_dir}", file=sys.stderr)

    options = {
        "strip_toc": args.strip_toc,
        "verify_toc": args.verify_toc,
        "aggressive_toc": args.aggressive_toc,
        "skip_existing": args.skip_existing,
        "timeout": args.timeout,
    }

    if args.dry_run:
        print(f"[dry-run] {len(files)} files would be processed:")
        for f in files:
            print(f"  - {f}")
        return 0

    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    started_ts = time.monotonic()
    succeeded = 0
    failed = 0
    skipped = 0
    file_results: list[FileResult] = []

    with _build_client(args.base_url, args.token) as client:
        # Pool sized to the requested concurrency, but never larger than the
        # input set (zero-size pool would raise).
        max_workers = max(1, min(args.concurrency, len(files) or 1))
        with _fut.ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = {
                ex.submit(_process_file, client, src, out_dir, args): src
                for src in files
            }
            for fut in _fut.as_completed(futures):
                src = futures[fut]
                try:
                    res = fut.result()
                except Exception as e:  # noqa: BLE001 — last-resort capture
                    res = FileResult(
                        source=str(src),
                        ok=False,
                        error=f"unexpected: {e!r}",
                    )
                file_results.append(res)

                if res.ok and res.error and res.error.startswith("skipped"):
                    skipped += 1
                    if not args.quiet:
                        print(f"[skip] {src}")
                elif res.ok:
                    succeeded += 1
                    if not args.quiet:
                        print(
                            f"[ok]   {src} -> {res.output} "
                            f"sec={res.sections} img={res.images} tab={res.tables}"
                            + (
                                f" toc={res.toc_method}"
                                f" miss={len(res.toc_missing)}"
                                if res.toc_found else ""
                            )
                        )
                else:
                    failed += 1
                    print(
                        f"[fail] {src}: {res.error or 'unknown'}",
                        file=sys.stderr,
                    )
                    if not args.continue_on_error:
                        for pending in futures:
                            pending.cancel()
                        break

    ended_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    elapsed = time.monotonic() - started_ts

    report = AggregateReport(
        started_at=started_at,
        ended_at=ended_at,
        total=len(files),
        succeeded=succeeded,
        failed=failed,
        skipped=skipped,
        concurrency=max(1, args.concurrency),
        base_url=args.base_url,
        options=options,
        files=[asdict(r) for r in file_results],
    )
    report_path: Path = args.report or (out_dir / "_report.json")
    report_path.write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if not args.quiet:
        print(
            f"\nDone in {elapsed:0.1f}s — "
            f"ok={succeeded} fail={failed} skip={skipped} "
            f"report={report_path}"
        )

    return 0 if failed == 0 else 2


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
