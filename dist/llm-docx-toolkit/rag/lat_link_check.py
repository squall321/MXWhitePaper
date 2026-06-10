#!/usr/bin/env python3
"""Check [[path]] / [[path#symbol]] reference integrity in docs/lat/*.md.

Guards against silent breakage when files move. stdlib only.

Reference syntax (lat convention):
  [[path]]                 repo file/dir reference
  [[path#symbol]]          + symbol (function/class/anchor) inside that file
  [[path|alias]]           alias part after '|' is display-only, ignored
  [[word]]                 area link -> docs/lat/<word>.md
  [[#anchor]]              same-file anchor

Path resolution order (first match wins):
  a. as-is, repo-relative (also tried relative to the lat file's dir,
     which handles '../foo.md' style refs)
  b. 'src/...'  -> lat API convention: src/app/... means apps/api/app/...
     (strip the 'src/' prefix, prepend 'apps/api/')
  c. 'src/...'  -> apps/web/ + path (web convention: real dir apps/web/src)
  c'. 'src/...' -> strip 'src/', repo-root (snapshots.md convention:
      src/infra/... means infra/..., src/.github/... means .github/...)
  d. single word (no '/') -> docs/lat/<word>.md

Occurrences inside fenced code blocks (``` / ~~~) and inline code spans
(`...`) are skipped: lat docs use those to show the syntax itself.

Symbol check is best effort: plain substring grep in the resolved file.
A missing symbol is a 'symbol?' warning, not a failure.

Exit 1 if any broken link is found; --warn-only forces exit 0.
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
LAT_DIR = REPO_ROOT / "docs" / "lat"

REF_RE = re.compile(r"\[\[([^\[\]]+)\]\]")
INLINE_CODE_RE = re.compile(r"`[^`]*`")
FENCE_RE = re.compile(r"^\s*(```|~~~)")


def iter_refs(lat_file: Path):
    """Yield (lineno, raw_ref) for refs outside code fences / inline code."""
    in_fence = False
    for lineno, line in enumerate(
        lat_file.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        stripped = INLINE_CODE_RE.sub("", line)
        for m in REF_RE.finditer(stripped):
            yield lineno, m.group(1).strip()


def parse_ref(raw: str):
    """Return (path, symbol). '|alias' is dropped; '#' splits path/symbol."""
    raw = raw.split("|", 1)[0].strip()
    if "#" in raw:
        path, symbol = raw.split("#", 1)
        return path.strip(), symbol.strip() or None
    return raw.strip(), None


def candidate_paths(path: str, lat_file: Path):
    """Resolution candidates in convention order (dedup, order kept)."""
    cands = []
    cands.append(REPO_ROOT / path)                      # a. repo-relative
    cands.append(lat_file.parent / path)                # a'. lat-dir relative
    if path.startswith("src/"):
        stripped = path[len("src/"):]
        cands.append(REPO_ROOT / "apps" / "api" / stripped)  # b. API
        cands.append(REPO_ROOT / "apps" / "web" / path)      # c. web
        cands.append(REPO_ROOT / stripped)                   # c'. repo root
    if "/" not in path:
        cands.append(LAT_DIR / (path + ".md"))           # d. area link
    seen, out = set(), []
    for c in cands:
        r = c.resolve()
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def check():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--warn-only", action="store_true",
        help="report broken links but exit 0",
    )
    args = parser.parse_args()

    if not LAT_DIR.is_dir():
        print(f"error: lat dir not found: {LAT_DIR}", file=sys.stderr)
        return 2

    total = 0
    broken = []   # (lat_file, lineno, raw, tried)
    warnings = []  # (lat_file, lineno, raw, resolved)

    for lat_file in sorted(LAT_DIR.glob("*.md")):
        for lineno, raw in iter_refs(lat_file):
            total += 1
            path, symbol = parse_ref(raw)

            if not path:  # [[#anchor]] -> same file
                resolved = lat_file
            else:
                tried = candidate_paths(path, lat_file)
                resolved = next((c for c in tried if c.exists()), None)
                if resolved is None:
                    broken.append((lat_file, lineno, raw, tried))
                    continue

            if symbol and resolved.is_file():
                try:
                    text = resolved.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                if symbol not in text:
                    warnings.append((lat_file, lineno, raw, resolved))

    rel = lambda p: p.relative_to(REPO_ROOT) if p.is_relative_to(REPO_ROOT) else p

    if broken:
        print(f"BROKEN LINKS ({len(broken)}):")
        cur = None
        for lat_file, lineno, raw, tried in broken:
            if lat_file != cur:
                cur = lat_file
                print(f"\n{rel(lat_file)}:")
            print(f"  {rel(lat_file)}:{lineno} -> [[{raw}]]")
            print(f"    tried: {', '.join(str(rel(c)) for c in tried)}")

    if warnings:
        print(f"\nSYMBOL WARNINGS ({len(warnings)}) — file ok, symbol not found:")
        for lat_file, lineno, raw, resolved in warnings:
            print(f"  {rel(lat_file)}:{lineno} -> [[{raw}]] (symbol? in {rel(resolved)})")

    print(
        f"\n{total} refs checked, {len(broken)} broken, "
        f"{len(warnings)} symbol warnings"
    )
    if broken and not args.warn_only:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(check())
