#!/usr/bin/env bash
# apptainer 1.3.6 을 사용자 영역(~/.local/apptainer-1.3.6/) 에 설치.
#
# 동기: target 서버에 apptainer 1.5.0 이 시스템 설치돼있는데 우리 스택과
# 호환성 이슈 (instance start 시 "container cleanup failed" 등). 시스템
# apptainer 는 절대 건드리지 않고 *우리 버전*만 별도 설치 + .env 에 경로
# 명시 → 우리 스크립트만 1.3.6 사용, 다른 프로젝트는 그대로 1.5.0.
#
# 방식: GitHub release 의 .deb 파일을 sudo 없이 dpkg-deb -x 로 사용자
# 영역에 풀기. setuid 기능 없는 unprivileged 모드만 동작하지만, 우리
# 스택은 이미 rootless (user namespace) 모드라 OK.
#
# 사용:
#   bash infra/scripts/install-apptainer-1.3.6.sh
#   ↑ 끝나면 안내 그대로 .env 에 APPTAINER=... 한 줄 추가
#   ↑ 또는 alias 사용

set -euo pipefail

VERSION="${APPTAINER_VERSION:-1.3.6}"
ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
PREFIX="${PREFIX:-$HOME/.local/apptainer-$VERSION}"

URL="https://github.com/apptainer/apptainer/releases/download/v${VERSION}/apptainer_${VERSION}_${ARCH}.deb"
DEB_TMP="$(mktemp -d)/apptainer.deb"

echo "→ apptainer $VERSION ($ARCH) 설치 → $PREFIX"
echo

# 1. 이미 설치돼있으면 skip
if [ -x "$PREFIX/usr/bin/apptainer" ]; then
  INSTALLED_VER=$("$PREFIX/usr/bin/apptainer" --version 2>&1 | awk '{print $NF}')
  if [ "$INSTALLED_VER" = "$VERSION" ]; then
    echo "✓ 이미 설치됨: $PREFIX/usr/bin/apptainer ($INSTALLED_VER)"
    echo "  재설치하려면 먼저 rm -rf $PREFIX"
    INSTALL_SKIPPED=1
  fi
fi

if [ "${INSTALL_SKIPPED:-0}" != "1" ]; then
  # 2. 다운로드
  echo "→ download $URL"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$DEB_TMP"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$DEB_TMP" "$URL"
  else
    echo "✗ curl 또는 wget 필요"; exit 1
  fi
  echo "  ✓ downloaded $(du -h "$DEB_TMP" | cut -f1)"

  # 3. extract (sudo 없이)
  mkdir -p "$PREFIX"
  dpkg-deb -x "$DEB_TMP" "$PREFIX"
  rm -rf "$(dirname "$DEB_TMP")"
  echo "  ✓ extracted to $PREFIX"
fi

APPTAINER_BIN="$PREFIX/usr/bin/apptainer"

# 4. 동작 확인
echo
echo "→ 동작 확인"
"$APPTAINER_BIN" --version 2>&1 | head -1 | sed 's/^/  /'

# 5. 안내
echo
echo "─────────────────────────────────────────────────"
echo "✓ 설치 완료: $APPTAINER_BIN"
echo "─────────────────────────────────────────────────"
echo
echo "이 버전을 우리 스택만 쓰게 하려면 *둘 중 한 가지* 선택:"
echo
echo "  [방법 A — 권장] .env 에 한 줄 추가 (스크립트 자동 감지):"
echo
echo "    echo 'APPTAINER=$APPTAINER_BIN' >> .env"
echo
echo "    → start.sh / recover.sh / boot.sh / diag-postgres.sh 자동으로 이 버전 사용"
echo "    → 다른 프로젝트 (aidh/koodtx/sf) 는 그대로 시스템 apptainer"
echo
echo "  [방법 B] 본인 shell 의 alias (옵션 — 모든 명령에 적용)"
echo
echo "    echo 'alias apptainer=$APPTAINER_BIN' >> ~/.bashrc"
echo "    source ~/.bashrc"
echo
echo "    ⚠ 다른 프로젝트도 본인이 운영하면서 별도 버전 안 쓰는 경우만"
echo
echo "─────────────────────────────────────────────────"
echo
echo "확인 후 진단/재기동:"
echo "  bash infra/scripts/diag-postgres.sh    # 1.3.6 으로 진단"
echo "  bash infra/scripts/start.sh             # 1.3.6 으로 시작"
