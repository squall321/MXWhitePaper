#!/usr/bin/env bash
# Dump MXWP content (JSONL + MinIO) and upload to Google Drive via rclone.
#
# 한 줄로 *현재 서버에서 데이터 export → tar.gz → Google Drive 업로드* 끝.
# 새 서버에서는 가이드(md) 보고 다운로드해서 ./infra/scripts/data-merge.sh 로 적용.
#
# Required env (load from $REPO_ROOT/.env or shell):
#   MXWP_DRIVE_REMOTE     rclone remote+path. e.g. "ApptainerImages:MXWhitePaper/data-dumps"
#
# Optional:
#   MXWP_DRIVE_RETAIN     keep only N most-recent dumps on Drive (default: 5, 0 = keep all)
#   MXWP_DUMP_NOTE        embed in archive manifest (default: auto)
#   MXWP_DUMP_NO_MINIO=1  컨텐츠만 dump, MinIO 제외
#
# Usage:
#   ./infra/scripts/data-dump-to-drive.sh
#   MXWP_DUMP_NOTE="weekly-sync" ./infra/scripts/data-dump-to-drive.sh
#   MXWP_DUMP_NO_MINIO=1 ./infra/scripts/data-dump-to-drive.sh
#
# rclone 설정 (1회):
#   rclone config   # → New remote → drive → 인증 →  alias 이름 정함 (예: MxwpDrive)
#   → .env 에 MXWP_DRIVE_REMOTE=MxwpDrive:MXWhitePaper/data-dumps
set -euo pipefail
. "$(dirname "$0")/_common.sh"

# ── Required tooling ────────────────────────────────────────────────────────
if ! command -v rclone >/dev/null 2>&1; then
  echo "✗ rclone not installed. Install: apt-get install rclone (or https://rclone.org/install/)"
  exit 1
fi

DRIVE_REMOTE="${MXWP_DRIVE_REMOTE:-}"
if [ -z "$DRIVE_REMOTE" ]; then
  echo "✗ MXWP_DRIVE_REMOTE not set. Example: MXWP_DRIVE_REMOTE=MxwpDrive:MXWhitePaper/data-dumps"
  echo "  Configure rclone first: rclone config"
  exit 1
fi
DRIVE_REMOTE="${DRIVE_REMOTE%/}"   # strip trailing slash

NOTE="${MXWP_DUMP_NOTE:-to-drive-$(date -u +%Y%m%d-%H%M%SZ)}"
NO_MINIO_FLAG=""
[ "${MXWP_DUMP_NO_MINIO:-0}" = "1" ] && NO_MINIO_FLAG="--no-minio"

RETAIN="${MXWP_DRIVE_RETAIN:-5}"

echo "═════ MXWP data-dump → Google Drive ═════"
echo "  remote   : $DRIVE_REMOTE"
echo "  note     : $NOTE"
echo "  no-minio : ${MXWP_DUMP_NO_MINIO:-0}"
echo "  retain   : $RETAIN (0 = keep all)"
echo

# ── 1) Run data-dump ────────────────────────────────────────────────────────
echo "→ running data-dump.sh"
DUMP_OUT="$("$REPO_ROOT/infra/scripts/data-dump.sh" --note "$NOTE" $NO_MINIO_FLAG 2>&1 | tee /dev/stderr | grep -E '^\s+file\s*:' | awk -F': ' '{print $2}')"
DUMP_OUT="$(echo "$DUMP_OUT" | xargs)"   # trim

if [ ! -f "$DUMP_OUT" ]; then
  echo "✗ data-dump.sh did not produce an archive (looked at: $DUMP_OUT)"
  exit 1
fi

DUMP_NAME="$(basename "$DUMP_OUT")"
DUMP_SIZE_MB="$(du -m "$DUMP_OUT" | cut -f1)"
DUMP_SHA256="$(sha256sum "$DUMP_OUT" | awk '{print $1}')"

echo
echo "→ dump ready : $DUMP_OUT"
echo "  size       : ${DUMP_SIZE_MB} MB"
echo "  sha256     : $DUMP_SHA256"

# ── 2) Render restore guide alongside the archive ───────────────────────────
GUIDE_TMP="$(mktemp -t mxwp-restore-guide-XXXXXX.md)"
trap 'rm -f "$GUIDE_TMP"' EXIT

cat > "$GUIDE_TMP" <<EOF
# MXWhitePaper — 데이터 머지 가이드

> 이 가이드는 \`$DUMP_NAME\` 와 같은 폴더에 자동 생성됨.
> 새 서버에서 *기존 데이터를 보존하면서 합치는* 절차다.
> 전체 wipe+restore 가 필요하면 \`docs/data-transfer.md\` 참고.

## 1. 다운로드

Google Drive 에서 두 파일을 같이 받는다:

- \`$DUMP_NAME\` (DB + MinIO 컨텐츠)
- \`$(basename "$GUIDE_TMP" | sed "s/mxwp-restore-guide-.*/RESTORE-GUIDE-${DUMP_NAME%.tar.gz}.md/")\` (이 가이드)

새 서버의 적당한 위치 (예: \`~/\` 또는 \`/tmp/\`) 에 둔다.

## 2. 사전 점검 (새 서버)

스택이 *돌고 있어야* 한다:
\`\`\`bash
apptainer instance list | grep mxwp_
# mxwp_api, mxwp_postgres, mxwp_meili, mxwp_minio, mxwp_web 5개 보여야 함
curl -s http://127.0.0.1:8800/api/v1/healthz
\`\`\`

스택이 없으면 먼저 설치:
\`\`\`bash
git clone <repo> /opt/MXWhitePaper && cd /opt/MXWhitePaper
cp .env.example .env  # 필요 시 secrets 채움
./quickstart.sh       # apptainer 1.3.6 vendor + image + instance start
\`\`\`

## 3. Merge (skip 정책 — 기존 데이터 안전)

\`\`\`bash
cd /opt/MXWhitePaper
mv ~/$DUMP_NAME infra/backups/data-dumps/

# 먼저 dry-run 으로 영향 확인
./infra/scripts/data-merge.sh infra/backups/data-dumps/$DUMP_NAME --dry-run
\`\`\`

예상 출력 (예시):
\`\`\`
  divisions  : +0 inserted / N skipped
  teams      : +0 inserted / N skipped
  groups     : +0 inserted / N skipped
  parts      : +0 inserted / N skipped
  tags       : 1200 reused / +120 new
  docs       : +450 inserted / 80 skipped / 0 overwritten
  doc_tags   : +1530
\`\`\`

→ 450 doc 이 새로 들어오고 80 doc 은 *이미 있어서 skip* 됨. 만족스러우면:

\`\`\`bash
./infra/scripts/data-merge.sh infra/backups/data-dumps/$DUMP_NAME
\`\`\`

## 4. 충돌 정책 선택

기본 \`skip\` 외에:

\`\`\`bash
# source 가 마스터 — 같은 slug 면 덮어씀 (위험. dry-run 필수)
./infra/scripts/data-merge.sh infra/backups/data-dumps/$DUMP_NAME --on-conflict=overwrite

# 양쪽 보존 — source 를 새 version 으로 추가
./infra/scripts/data-merge.sh infra/backups/data-dumps/$DUMP_NAME --on-conflict=version
\`\`\`

## 5. 자동 후처리

merge 끝나면 자동:
1. links 테이블 재계산 (본문의 \`[[wiki]]\` 파싱)
2. indegree 백필
3. (있으면) Meili 재인덱스

## 6. 검증

\`\`\`bash
curl http://127.0.0.1:8800/api/v1/healthz
curl http://127.0.0.1:8800/api/v1/home/hero | jq '.data.domains[].doc_count'
# 예: [86, 219, 109, 43] — 도메인별 doc 카운트
\`\`\`

## 메타데이터

| 항목 | 값 |
|---|---|
| 생성 시각 | $(date -u +%Y-%m-%dT%H:%M:%SZ) |
| 출처 호스트 | $(hostname) |
| 아카이브 | \`$DUMP_NAME\` |
| 크기 | ${DUMP_SIZE_MB} MB |
| sha256 | \`$DUMP_SHA256\` |
| 노트 | $NOTE |
| MinIO 포함 | $([ -z "$NO_MINIO_FLAG" ] && echo "예" || echo "아니오") |

자세한 옵션·시나리오는 출처 저장소의 \`docs/data-transfer.md\` 참고.
EOF

GUIDE_NAME="RESTORE-GUIDE-$(basename "${DUMP_NAME%.tar.gz}").md"
GUIDE_FINAL="$(dirname "$DUMP_OUT")/$GUIDE_NAME"
cp "$GUIDE_TMP" "$GUIDE_FINAL"

echo
echo "→ wrote guide : $GUIDE_FINAL"

# ── 3) Upload archive + guide to Google Drive ───────────────────────────────
echo
echo "→ uploading to Google Drive : $DRIVE_REMOTE/"

rclone copy --progress "$DUMP_OUT"   "$DRIVE_REMOTE/" || {
  echo "✗ rclone copy failed for archive"
  exit 1
}
rclone copy --progress "$GUIDE_FINAL" "$DRIVE_REMOTE/" || {
  echo "✗ rclone copy failed for guide"
  exit 1
}

echo
echo "→ shareable links"
ARCHIVE_LINK="$(rclone link "$DRIVE_REMOTE/$DUMP_NAME" 2>/dev/null || echo '(link generation failed — check rclone config)')"
GUIDE_LINK="$(rclone link "$DRIVE_REMOTE/$GUIDE_NAME" 2>/dev/null || echo '(link generation failed — check rclone config)')"
echo "  archive : $ARCHIVE_LINK"
echo "  guide   : $GUIDE_LINK"

# ── 4) Retention (delete old dumps on Drive) ────────────────────────────────
if [ "$RETAIN" -gt 0 ]; then
  echo
  echo "→ retention: keep last $RETAIN archives on remote"
  # 파일 이름이 mxwp-data-YYYYMMDD-HHMMSSZ.tar.gz 라 이름 기준 sort = 시간순.
  # (rclone lsf 의 modtime 포맷이 버전마다 달라 이름 기반으로 통일)
  TO_DELETE="$(
    rclone lsf --files-only "$DRIVE_REMOTE/" 2>/dev/null \
      | grep '^mxwp-data-.*\.tar\.gz$' \
      | sort \
      | head -n -"$RETAIN" || true
  )"
  if [ -n "$TO_DELETE" ]; then
    echo "$TO_DELETE" | while IFS= read -r old; do
      [ -z "$old" ] && continue
      echo "  · deleting $old"
      rclone deletefile "$DRIVE_REMOTE/$old" 2>/dev/null || echo "    ⚠ delete failed (ignore)"
      # 동일 prefix 의 guide md 도 같이 제거
      old_guide="RESTORE-GUIDE-${old%.tar.gz}.md"
      rclone deletefile "$DRIVE_REMOTE/$old_guide" 2>/dev/null || true
    done
  else
    echo "  (none to delete — fewer than $RETAIN archives present)"
  fi
fi

echo
echo "✓ data-dump-to-drive complete"
echo "  archive : $DUMP_OUT"
echo "  guide   : $GUIDE_FINAL"
echo "  remote  : $DRIVE_REMOTE/"
