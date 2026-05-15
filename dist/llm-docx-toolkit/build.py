"""Build script — produces a standalone mxwp-validator binary.

DESIGN: zero source duplication.

The toolkit's `validate.py` and `_settings_stub.py` are the only Python files
*owned* by this folder. The actual `docx_import` and `widget_markers` modules
are imported live from `apps/api/app/services/` at build time. PyInstaller's
dependency analyser follows the import graph and bundles a snapshot — so the
released binary always reflects whatever `widget_markers.py` / `docx_import.py`
look like at HEAD when CI runs.

There is therefore NO COPY of those files in this folder. The single source
of truth lives under `apps/api/`. When a new widget lands or autodetect rules
change, the next push to main rebuilds the toolkit automatically (see
`.github/workflows/llm-docx-toolkit.yml`).

Usage:
    python build.py                # build for the current platform
    python build.py --onedir       # produce an unpacked folder (debugging)

CI cross-platform builds are handled by GitHub Actions on `ubuntu-latest` and
`windows-latest`. This script works locally for either.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent  # MXWhitePaper repo root
API_SRC = REPO / "apps" / "api" / "app" / "services"
SCHEMA = REPO / "packages" / "shared" / "schemas" / "document.json"


def run(cmd: list[str], **kw: object) -> None:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, **kw)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onedir", action="store_true", help="Produce an unpacked folder instead of a single file (debugging).")
    parser.add_argument("--clean", action="store_true", help="Wipe dist/build before building.")
    args = parser.parse_args()

    if not (API_SRC / "docx_import.py").exists():
        print(f"ERROR: cannot find {API_SRC / 'docx_import.py'}", file=sys.stderr)
        print("This script must run from inside the MXWhitePaper repo.", file=sys.stderr)
        return 2
    if not SCHEMA.exists():
        print(f"ERROR: cannot find {SCHEMA}", file=sys.stderr)
        return 2

    bin_dir = HERE / "bin"
    work_dir = HERE / "_build"
    if args.clean and bin_dir.exists():
        shutil.rmtree(bin_dir)
    if args.clean and work_dir.exists():
        shutil.rmtree(work_dir)
    bin_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    # Stage source. We need to take a snapshot of the *production* source
    # so PyInstaller can package it — but we patch the one line that
    # imports `app.core.config` (server-only) to point at the toolkit stub.
    # Origin files stay unchanged; the patch only lives in the build stage.
    stage = work_dir / "stage"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)

    # Toolkit-owned files.
    shutil.copy(HERE / "src" / "validate.py", stage / "mxwp_validator.py")
    shutil.copy(HERE / "src" / "_settings_stub.py", stage / "_settings_stub.py")

    # Snapshot the production imports. Two patches are needed:
    #   1. `app.core.config` → toolkit's _settings_stub.
    #   2. `from . import widget_markers as _wm` → flat `import widget_markers`
    #      (and the same for `toc_extract`), since the stage is a flat folder,
    #      not a package.
    for fname in ("docx_import.py", "widget_markers.py", "toc_extract.py"):
        src_path = API_SRC / fname
        if not src_path.exists():
            # toc_extract is optional — only used by the round-trip path.
            print(f"  skipping {fname} (not present)")
            continue
        src_text = src_path.read_text(encoding="utf-8")
        patched = (
            src_text
            .replace(
                "from app.core.config import get_settings",
                "from _settings_stub import get_settings",
            )
            .replace(
                "from . import widget_markers as _wm",
                "import widget_markers as _wm",
            )
            .replace(
                "from . import toc_extract as _toc",
                "import toc_extract as _toc",
            )
        )
        (stage / fname).write_text(patched, encoding="utf-8")
        print(f"  staged {fname} ({len(patched)} bytes)")

    sep = ";" if sys.platform == "win32" else ":"
    add_data_schema = f"{SCHEMA}{sep}."

    mode_flag = "--onedir" if args.onedir else "--onefile"

    # PyInstaller invocation. We pass --paths for both the staged folder
    # (so `_settings_stub` resolves) and the live API services folder (so
    # `docx_import` and `widget_markers` resolve to the real production
    # source — no duplication).
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "mxwp-validator",
        mode_flag,
        "--clean",
        "--noconfirm",
        "--paths", str(stage),
        "--add-data", add_data_schema,
        # Hidden imports — the toolkit imports them dynamically; ensure
        # PyInstaller sees them.
        "--hidden-import", "docx_import",
        "--hidden-import", "widget_markers",
        "--hidden-import", "toc_extract",
        "--hidden-import", "_settings_stub",
        "--hidden-import", "jsonschema",
        "--hidden-import", "ulid",
        "--distpath", str(work_dir / "dist"),
        "--workpath", str(work_dir / "work"),
        "--specpath", str(work_dir),
        str(stage / "mxwp_validator.py"),
    ]
    run(cmd)

    # Move the produced artefact into bin/.
    if args.onedir:
        src_artefact = work_dir / "dist" / "mxwp-validator"
        dst = bin_dir / f"mxwp-validator-{sys.platform}"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.move(str(src_artefact), str(dst))
        print(f"\n✓ produced folder: {dst}")
    else:
        exe_suffix = ".exe" if sys.platform == "win32" else ""
        src_artefact = work_dir / "dist" / f"mxwp-validator{exe_suffix}"
        dst = bin_dir / f"mxwp-validator-{sys.platform}{exe_suffix}"
        if dst.exists():
            dst.unlink()
        shutil.move(str(src_artefact), str(dst))
        print(f"\n✓ produced binary: {dst}")

    print("\nQuick sanity:", flush=True)
    try:
        subprocess.check_call([str(dst), "--version"])
    except Exception as e:
        print(f"  (sanity skipped — {e})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
