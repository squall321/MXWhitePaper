#!/usr/bin/env bash
# Nuclear "everything's stuck, fix it" recovery script.
# Combines stop + desudo + clean + start + migrate + seed + diag
# into a single command. Use when:
#   - meili / web won't bind after install.sh
#   - "Permission denied" anywhere in errors.sh output
#   - sudo apptainer was accidentally invoked
#   - new .sif images shipped but old instances still running
#   - data dirs got weird ownership from a tar transfer
#
# What it does (in order):
#   1. apptainer instance stop --all  (user + sudo side)
#   2. desudo.sh --yes   (chown root → user, clear /tmp, /root/.apptainer)
#   3. clean.sh --yes    (wipe infra/data/{postgres,meili,minio,web-tmp})
#   4. start.sh          (picks up any newly-built .sif)
#   5. migrate.sh + seed.sh
#   6. diag.sh           (final state report)
#
# Usage:
#   ./infra/scripts/recover.sh             # interactive (asks once)
#   ./infra/scripts/recover.sh --yes       # no prompt — CI / scripted
#   ./infra/scripts/recover.sh --no-seed   # skip seed (preserve manually-loaded data)
set -uo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

YES=0
SEED=1
for arg in "$@"; do
  case "$arg" in
    --yes)     YES=1 ;;
    --no-seed) SEED=0 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done

echo "═══════════════════════════════════════════════════════════════"
echo "  MXWhitePaper — full recovery (nuclear)"
echo "═══════════════════════════════════════════════════════════════"
echo "  Will:  stop all → desudo → clean → start → migrate → seed → diag"
echo "  ⚠     DB / search index / uploaded files will be WIPED."
echo "═══════════════════════════════════════════════════════════════"

if [ "$YES" -ne 1 ]; then
  printf "Continue? Type 'RECOVER' to proceed: "
  read -r REPLY
  [ "$REPLY" = "RECOVER" ] || { echo "✗ aborted"; exit 1; }
fi

# ── 1. stop all (user + sudo side) ──────────────────────────────────
echo
echo "▶ 1/6  stop all instances"
"$APPTAINER" instance stop --all >/dev/null 2>&1 || true
if sudo -n true 2>/dev/null; then
  sudo "$APPTAINER" instance stop --all >/dev/null 2>&1 || true
fi
echo "  ✓ all instances stopped"

# ── 2. desudo ───────────────────────────────────────────────────────
echo
echo "▶ 2/6  desudo (chown root files back, clear /tmp & /root/.apptainer)"
"$REPO_ROOT/infra/scripts/desudo.sh" --yes || echo "  ⚠ desudo had partial errors — continuing"

# ── 3. clean ────────────────────────────────────────────────────────
echo
echo "▶ 3/6  clean data dirs"
"$REPO_ROOT/infra/scripts/clean.sh" --yes

# ── 4. start ────────────────────────────────────────────────────────
echo
echo "▶ 4/6  start stack"
"$REPO_ROOT/infra/scripts/start.sh"

# ── 5. migrate + seed ───────────────────────────────────────────────
echo
echo "▶ 5/6  migrate + seed"
"$REPO_ROOT/infra/scripts/migrate.sh" || echo "  ⚠ migrate had errors — see logs"
if [ "$SEED" -eq 1 ]; then
  "$REPO_ROOT/infra/scripts/seed.sh" || echo "  ⚠ seed failed — non-fatal, continuing"
fi

# ── 6. diag ─────────────────────────────────────────────────────────
echo
echo "▶ 6/6  status report"
"$REPO_ROOT/infra/scripts/diag.sh"

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ recover complete"
echo "═══════════════════════════════════════════════════════════════"
echo "  If diag's D/E sections still show errors:"
echo "    ./infra/scripts/errors.sh --grep    # see actual stderr"
echo "  Common follow-ups:"
echo "    - new .sif arrived but errors persist → check size / mtime"
echo "    - web TLS issue → MXWP_NODE_TLS_VERIFY=0 in .env"
echo "    - meili still permission denied → sudo chown -R \$(id -u): infra/data"
echo "═══════════════════════════════════════════════════════════════"
