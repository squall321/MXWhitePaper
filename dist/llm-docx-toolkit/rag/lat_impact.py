#!/usr/bin/env python3
"""Advise which docs/lat/*.md docs reference files being committed.

Builds a reverse index {resolved repo-relative path -> set(lat doc)} from
all [[ref]] links in docs/lat/*.md (path resolution reused from
lat_link_check.py, same conventions), then reports per lat doc which of
the input files it references:

  ℹ docs/lat/imports.md 가 참조하는 파일이 변경됨: <files> — lat 갱신 검토

Input files come from argv; with no argv, `git diff --cached --name-only`
is used. docs/lat/ files themselves are excluded (noise). No match -> no
output. Always exits 0 — advisory only, never blocks a commit.
"""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lat_link_check import (  # noqa: E402
    LAT_DIR,
    REPO_ROOT,
    candidate_paths,
    iter_refs,
    parse_ref,
)


def build_reverse_index():
    """{repo-relative resolved path: set(repo-relative lat doc path)}."""
    index = {}
    for lat_file in sorted(LAT_DIR.glob("*.md")):
        lat_rel = lat_file.relative_to(REPO_ROOT).as_posix()
        for _lineno, raw in iter_refs(lat_file):
            path, _symbol = parse_ref(raw)
            if not path:  # [[#anchor]] -> same file
                continue
            resolved = next(
                (c for c in candidate_paths(path, lat_file) if c.exists()),
                None,
            )
            if resolved is None or not resolved.is_relative_to(REPO_ROOT):
                continue
            rel = resolved.relative_to(REPO_ROOT).as_posix()
            index.setdefault(rel, set()).add(lat_rel)
    return index


def main():
    files = sys.argv[1:]
    if not files:
        proc = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        files = proc.stdout.splitlines()
    files = [
        f.strip() for f in files
        if f.strip() and not f.strip().startswith("docs/lat/")
    ]
    if not files:
        return 0

    index = build_reverse_index()
    hits = {}  # lat doc -> set(changed files it references)
    for f in files:
        for lat_doc in index.get(f, ()):
            hits.setdefault(lat_doc, set()).add(f)

    for lat_doc in sorted(hits):
        joined = ", ".join(sorted(hits[lat_doc]))
        print(f"ℹ {lat_doc} 가 참조하는 파일이 변경됨: {joined} — lat 갱신 검토")
    return 0


if __name__ == "__main__":
    sys.exit(main())
