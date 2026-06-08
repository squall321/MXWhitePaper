#!/usr/bin/env bash
# Nightly snapshot driver — taken + retention pruning.
#
# Why this exists vs. calling snapshot.sh directly from systemd:
#   - We need to source .env for MXWP_SNAPSHOT_RETAIN_DAYS (which lives in
#     the repo's .env via _common.sh).
#   - We need a post-step that prunes archives older than the retention
#     window so the snapshots dir doesn't grow forever.
#   - We need plain stdout/stderr logging that journald can absorb (no
#     extra log file management) — same style as snapshot.sh.
#
# Invoked by: mxwp-snapshot.service (user timer, nightly).
# Manually:   ./infra/scripts/snapshot-retention.sh
set -euo pipefail

. "$(dirname "$0")/_common.sh"

SNAPSHOT_DIR="${SNAPSHOT_DIR:-$REPO_ROOT/infra/backups/snapshots}"
RETAIN_DAYS="${MXWP_SNAPSHOT_RETAIN_DAYS:-7}"

# Validate retention — must be a positive integer. A typo like "7d" would
# silently disable pruning under `find -mtime +<bad>` on some find variants.
if ! [[ "$RETAIN_DAYS" =~ ^[0-9]+$ ]] || [ "$RETAIN_DAYS" -lt 1 ]; then
  echo "✗ MXWP_SNAPSHOT_RETAIN_DAYS must be a positive integer (got: '$RETAIN_DAYS')" >&2
  exit 1
fi

echo "═════ MXWP nightly snapshot run ═════"
echo "  started_at   : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  snapshot_dir : $SNAPSHOT_DIR"
echo "  retain_days  : $RETAIN_DAYS"
echo

# ── 1) Take snapshot ────────────────────────────────────────────────
# snapshot.sh handles its own banner, exit codes, and trap-cleanup.
# It honours SNAPSHOT_DIR via env (already exported by _common.sh's `set -a`).
echo "→ taking snapshot"
SNAPSHOT_DIR="$SNAPSHOT_DIR" "$REPO_ROOT/infra/scripts/snapshot.sh" \
  --note "nightly $(date -u +%Y-%m-%d)"

# ── 2) Prune old snapshots ──────────────────────────────────────────
# Only target our own archive naming pattern so we never delete a
# user-dropped file in the same directory.
echo
echo "→ pruning archives older than $RETAIN_DAYS days"

PRUNED=0
while IFS= read -r -d '' f; do
  echo "  · removing $(basename "$f")"
  rm -f -- "$f" "$f.sha256"
  PRUNED=$((PRUNED + 1))
done < <(find "$SNAPSHOT_DIR" -maxdepth 1 -type f \
           -name 'mxwp-snapshot-*.tar.gz' \
           -mtime +"$RETAIN_DAYS" -print0)

echo "  ✓ pruned $PRUNED archive(s)"

echo
echo "✓ nightly snapshot run finished at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
