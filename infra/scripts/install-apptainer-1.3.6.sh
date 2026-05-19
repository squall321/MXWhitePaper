#!/usr/bin/env bash
# apptainer 1.3.6 을 *프로젝트 내부* (infra/apptainer/bin-1.3.6/) 에 설치.
#
# 동기: target 서버에 apptainer 1.5.0 이 시스템 설치돼있는데 우리 스택과
# 호환성 이슈 (instance start 시 "container cleanup failed" 등). 시스템
# apptainer 는 절대 건드리지 않고 *우리 버전*만 프로젝트 내부에 설치 →
# .env 자동 갱신 → 우리 스크립트만 1.3.6 사용.
#
# 왜 프로젝트 내부?
#   - 다른 프로젝트와 완전 격리 (홈 폴더 안 건드림)
#   - bin-1.3.6/ 는 .gitignore — repo 비대화 안 됨
#   - 프로젝트 폴더 삭제하면 함께 사라짐 — 흔적 0
#
# 왜 .deb 가 repo 안에?
#   - git pull 후 *네트워크 없이* 즉시 설치 가능 (target 이 인터넷 차단된 환경 가능성)
#   - 27 MB 한 번만 LFS 없이 commit (드물게 갱신)
#
# 사용:
#   # 기본 — 설치만 (안내 보고 .env 직접 수정)
#   bash infra/scripts/install-apptainer-1.3.6.sh
#
#   # 자동 — 설치 + .env 자동 갱신 (git pull 직후 한 줄)
#   bash infra/scripts/install-apptainer-1.3.6.sh --auto

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VERSION="${APPTAINER_VERSION:-1.3.6}"
ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
PREFIX="${PREFIX:-$REPO_ROOT/infra/apptainer/bin-$VERSION}"
# bootstrap-host.sh 와 동일 경로 검색 — find_cached_deb 패턴 재사용.
# 우선순위: infra/packages/deb/ > infra/deb/ > infra/packages/ > repo root.
VENDOR_DEB=""
for cand in \
  "$REPO_ROOT/infra/packages/deb/apptainer_${VERSION}_${ARCH}.deb" \
  "$REPO_ROOT/infra/deb/apptainer_${VERSION}_${ARCH}.deb" \
  "$REPO_ROOT/infra/packages/apptainer_${VERSION}_${ARCH}.deb" \
  "$REPO_ROOT/apptainer_${VERSION}_${ARCH}.deb"; do
  [ -f "$cand" ] && VENDOR_DEB="$cand" && break
done
URL_FALLBACK="https://github.com/apptainer/apptainer/releases/download/v${VERSION}/apptainer_${VERSION}_${ARCH}.deb"

AUTO_MODE=0
for arg in "$@"; do
  case "$arg" in
    --auto) AUTO_MODE=1 ;;
    -h|--help)
      sed -n '1,30p' "$0" | grep -E '^#'
      exit 0 ;;
  esac
done

echo "→ apptainer $VERSION ($ARCH) 설치 → $PREFIX"
echo

# 1. 이미 설치돼있으면 skip
INSTALL_SKIPPED=0
if [ -x "$PREFIX/usr/bin/apptainer" ]; then
  INSTALLED_VER=$("$PREFIX/usr/bin/apptainer" --version 2>&1 | awk '{print $NF}')
  if [ "$INSTALLED_VER" = "$VERSION" ]; then
    echo "✓ 이미 설치됨: $PREFIX/usr/bin/apptainer ($INSTALLED_VER)"
    echo "  재설치하려면: rm -rf $PREFIX"
    INSTALL_SKIPPED=1
  fi
fi

if [ "$INSTALL_SKIPPED" != "1" ]; then
  # 2. .deb 소스 결정 — repo 안 cached deb 우선, 없으면 다운로드
  DEB_SRC=""
  if [ -n "$VENDOR_DEB" ] && [ -f "$VENDOR_DEB" ]; then
    DEB_SRC="$VENDOR_DEB"
    echo "→ using cached .deb: $VENDOR_DEB ($(du -h "$VENDOR_DEB" | cut -f1))"
  else
    echo "→ vendor/ 에 .deb 없음 → GitHub release 에서 다운로드"
    DEB_TMP="$(mktemp -d)/apptainer.deb"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$URL_FALLBACK" -o "$DEB_TMP"
    elif command -v wget >/dev/null 2>&1; then
      wget -q -O "$DEB_TMP" "$URL_FALLBACK"
    else
      echo "✗ curl/wget 둘 다 없음 — .deb 를 직접 받아 $VENDOR_DEB 에 두고 재실행"
      exit 1
    fi
    DEB_SRC="$DEB_TMP"
    echo "  ✓ downloaded $(du -h "$DEB_SRC" | cut -f1)"
  fi

  # 3. extract (sudo 없이)
  mkdir -p "$PREFIX"
  dpkg-deb -x "$DEB_SRC" "$PREFIX"
  echo "  ✓ extracted to $PREFIX"

  # 3a. .deb 는 system install 가정이라 conf 를 etc/ 에 풀음. apptainer 바이너리
  # 가 자기 위치 (usr/bin/apptainer) 기준 ../etc/apptainer/ 가 아닌
  # usr/etc/apptainer/ 또는 컴파일 시점 /etc/apptainer/ 를 찾는 경우가 있어
  # *두 경로 모두 같은 conf 를 보게* 심볼릭 링크 + bind 한다.
  mkdir -p "$PREFIX/usr/etc"
  if [ -d "$PREFIX/etc/apptainer" ] && [ ! -e "$PREFIX/usr/etc/apptainer" ]; then
    ln -s ../../etc/apptainer "$PREFIX/usr/etc/apptainer"
    echo "  ✓ usr/etc/apptainer → ../../etc/apptainer (symlink for FATAL: couldn't parse conf fix)"
  fi
  # /var/lib/apptainer/ 도 동일 패턴 — instance start 시 session dir 가 여기.
  # .deb 의 실제 경로는 var/lib/apptainer/ (var/apptainer 가 아님 — 처음 fix 의 typo).
  # usr/var/lib/apptainer → ../../../var/lib/apptainer 로 심볼릭 링크.
  mkdir -p "$PREFIX/usr/var/lib" 2>/dev/null || true
  if [ -d "$PREFIX/var/lib/apptainer" ] && [ ! -e "$PREFIX/usr/var/lib/apptainer" ]; then
    ln -s ../../../var/lib/apptainer "$PREFIX/usr/var/lib/apptainer"
    echo "  ✓ usr/var/lib/apptainer → ../../../var/lib/apptainer (symlink for session dir)"
  fi

  # 다운받은 임시 파일이면 정리
  [ "$DEB_SRC" != "$VENDOR_DEB" ] && rm -rf "$(dirname "$DEB_SRC")"
fi

APPTAINER_BIN="$PREFIX/usr/bin/apptainer"

# 4. .gitignore 자동 추가
GITIGNORE="$REPO_ROOT/.gitignore"
GITIGNORE_LINE="infra/apptainer/bin-$VERSION/"
if [ -f "$GITIGNORE" ] && ! grep -qF "$GITIGNORE_LINE" "$GITIGNORE"; then
  {
    echo ""
    echo "# user-local apptainer install (project-internal, see infra/scripts/install-apptainer-*.sh)"
    echo "$GITIGNORE_LINE"
  } >> "$GITIGNORE"
  echo "  ✓ .gitignore 에 $GITIGNORE_LINE 추가"
fi

# 5. 동작 확인
echo
echo "→ 동작 확인"
"$APPTAINER_BIN" --version 2>&1 | head -1 | sed 's/^/  /'

# 6. .env 자동 갱신 (--auto 모드)
ENV_FILE="$REPO_ROOT/.env"
ENV_LINE="APPTAINER=$APPTAINER_BIN"

if [ "$AUTO_MODE" = "1" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo
    echo "⚠ .env 가 없음 — 먼저 cp .env.example .env 후 다시 --auto 실행"
    exit 1
  fi

  if grep -qE '^APPTAINER=' "$ENV_FILE"; then
    # 기존 줄 교체 (in-place)
    CUR=$(grep '^APPTAINER=' "$ENV_FILE" | head -1)
    if [ "$CUR" = "$ENV_LINE" ]; then
      echo "  ✓ .env APPTAINER 이미 정확 — 변경 없음"
    else
      # macOS / Linux 모두 안전: 임시 파일 경유
      sed -i "s|^APPTAINER=.*|$ENV_LINE|" "$ENV_FILE"
      echo "  ✓ .env APPTAINER 갱신: $ENV_LINE"
      echo "    (이전: $CUR)"
    fi
  else
    {
      echo ""
      echo "# auto-added by install-apptainer-$VERSION.sh"
      echo "$ENV_LINE"
    } >> "$ENV_FILE"
    echo "  ✓ .env 에 추가: $ENV_LINE"
  fi
fi

# 7. 안내
REL_PATH="infra/apptainer/bin-$VERSION/usr/bin/apptainer"
echo
echo "─────────────────────────────────────────────────"
echo "✓ 설치 완료: $APPTAINER_BIN"
echo "  (프로젝트 상대: $REL_PATH)"
echo "─────────────────────────────────────────────────"
echo

if [ "$AUTO_MODE" = "1" ]; then
  echo "다음 단계:"
  echo "  bash infra/scripts/diag-postgres.sh    # §1 에서 1.3.6 사용 확인"
  echo "  bash infra/scripts/recover.sh           # 1.3.6 으로 깨끗 시작"
else
  echo "이 버전을 우리 스택만 쓰게 하려면 .env 에 한 줄 추가:"
  echo
  echo "  echo '$ENV_LINE' >> .env"
  echo
  echo "또는 본 스크립트를 --auto 로 다시 실행:"
  echo
  echo "  bash infra/scripts/install-apptainer-$VERSION.sh --auto"
  echo
  echo "→ start.sh / recover.sh / boot.sh / diag-postgres.sh 자동으로 1.3.6 사용"
  echo "→ 다른 프로젝트 (aidh/koodtx/sf) 는 그대로 시스템 apptainer"
fi
echo "─────────────────────────────────────────────────"
