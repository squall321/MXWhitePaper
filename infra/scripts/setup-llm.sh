#!/usr/bin/env bash
# Triple 추출용 로컬 LLM (ollama) 환경을 1회 셋업.
#
# GPU (NVIDIA) 가 감지되면:
#   - ollama 설치 (없으면)
#   - ollama 서비스 기동 확인
#   - 추출 모델 pull
#   - .env 의 TRIPLE_EXTRACTOR_PROVIDER=ollama + ENDPOINT/MODEL 박기
#
# GPU 가 없으면:
#   - 아무것도 설치하지 않고 .env 를 TRIPLE_EXTRACTOR_PROVIDER=mock 으로 둔다
#   - triple 추출 API 는 mock placeholder 로 graceful 동작 (무중단)
#
# 즉 "그래픽 카드만 있으면 자동으로 LLM provider 가 켜진다".
#
# Usage:
#   ./infra/scripts/setup-llm.sh                 # GPU 자동 감지
#   ./infra/scripts/setup-llm.sh --force-gpu     # 감지 무시하고 ollama 셋업 강행
#   ./infra/scripts/setup-llm.sh --force-mock    # 감지 무시하고 mock 으로
#   ./infra/scripts/setup-llm.sh --model=llama3.1
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
cd "$REPO_ROOT"

# ── Args ────────────────────────────────────────────────────────────────────
FORCE=""               # "" | gpu | mock
MODEL="llama3.1:8b"    # ollama 에 pull 할 추출 모델 (8B — 16GB VRAM 정도면 충분)
OLLAMA_ENDPOINT="http://localhost:11434"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force-gpu)   FORCE="gpu"; shift ;;
    --force-mock)  FORCE="mock"; shift ;;
    --model=*)     MODEL="${1#*=}"; shift ;;
    --endpoint=*)  OLLAMA_ENDPOINT="${1#*=}"; shift ;;
    --help|-h) sed -n '2,22p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $1"; exit 1 ;;
  esac
done

log()  { printf '\033[1;36m[llm]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ⚠\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m  ✗\033[0m %s\n' "$*" >&2; }

ENV_FILE="$REPO_ROOT/.env"

# ── .env 의 키를 set/replace 하는 헬퍼 ──────────────────────────────────────
# 키가 있으면 sed 치환, 없으면 append. (주석된 '# KEY=' 도 활성화.)
set_env() {
  local key="$1" val="$2"
  [ -f "$ENV_FILE" ] || touch "$ENV_FILE"
  if grep -qE "^#? *${key}=" "$ENV_FILE"; then
    sed -i "s|^#\? *${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# ── 1) GPU 감지 ─────────────────────────────────────────────────────────────
log "step 1/4 — GPU 감지"
GPU_PRESENT=0
if [ "$FORCE" = "gpu" ]; then
  GPU_PRESENT=1
  warn "--force-gpu — 감지 건너뛰고 ollama 셋업 강행"
elif [ "$FORCE" = "mock" ]; then
  GPU_PRESENT=0
  warn "--force-mock — 감지 건너뛰고 mock 으로"
else
  # nvidia-smi 가 있고 실제 GPU 를 보고하면 GPU 있음으로 판단.
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    GPU_PRESENT=1
    GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || true)"
    ok "NVIDIA GPU 감지: ${GPU_NAME:-unknown}"
  else
    ok "GPU 미감지 (nvidia-smi 없음/실패)"
  fi
fi

# ── GPU 없음 → mock 으로 두고 종료 ──────────────────────────────────────────
if [ "$GPU_PRESENT" -eq 0 ]; then
  log "step 2/4 — GPU 없음 → mock provider"
  set_env "TRIPLE_EXTRACTOR_PROVIDER" "mock"
  ok ".env: TRIPLE_EXTRACTOR_PROVIDER=mock"
  echo
  ok "LLM 셋업 생략 — triple 추출은 mock placeholder 로 동작 (무중단)"
  echo "  나중에 GPU 머신에서: ./infra/scripts/setup-llm.sh"
  exit 0
fi

# ── 2) ollama 설치 ──────────────────────────────────────────────────────────
log "step 2/4 — ollama 설치"
if command -v ollama >/dev/null 2>&1; then
  ok "ollama 이미 설치됨 ($(ollama --version 2>/dev/null | head -1 || echo 'version?'))"
else
  # 공식 설치 스크립트. 프록시 환경이면 .env 의 HTTPS_PROXY 가 상속되도록
  # 호출 측 (install-host-deps) 이 export 해 둔 상태를 가정.
  log "ollama 공식 설치 스크립트 실행 (curl -fsSL https://ollama.com/install.sh)"
  if curl -fsSL https://ollama.com/install.sh | sh; then
    ok "ollama 설치 완료"
  else
    err "ollama 설치 실패 — 네트워크/프록시 확인. mock 으로 폴백."
    set_env "TRIPLE_EXTRACTOR_PROVIDER" "mock"
    exit 1
  fi
fi

# ── 3) ollama 서비스 기동 확인 ──────────────────────────────────────────────
log "step 3/4 — ollama 서비스 확인"
# install.sh 가 systemd 서비스를 등록/기동하지만, 컨테이너/비-systemd 환경
# 대비로 직접 확인 후 필요 시 background 기동.
if curl -fsS --max-time 3 "${OLLAMA_ENDPOINT}/api/tags" >/dev/null 2>&1; then
  ok "ollama 응답 OK (${OLLAMA_ENDPOINT})"
else
  warn "ollama 미응답 — background 기동 시도"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^ollama'; then
    sudo systemctl enable --now ollama 2>/dev/null || true
  else
    # systemd 없는 환경 — nohup 으로 직접.
    nohup ollama serve >/tmp/ollama.log 2>&1 &
  fi
  # 기동 대기 (최대 ~20s).
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 2 "${OLLAMA_ENDPOINT}/api/tags" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if curl -fsS --max-time 3 "${OLLAMA_ENDPOINT}/api/tags" >/dev/null 2>&1; then
    ok "ollama 기동 완료"
  else
    err "ollama 기동 실패 — /tmp/ollama.log 확인. mock 으로 폴백."
    set_env "TRIPLE_EXTRACTOR_PROVIDER" "mock"
    exit 1
  fi
fi

# ── 4) 모델 pull + .env 갱신 ───────────────────────────────────────────────
log "step 4/4 — 모델 pull: $MODEL"
if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$MODEL"; then
  ok "$MODEL 이미 pull 됨"
else
  log "ollama pull $MODEL — 모델 크기에 따라 수 분 소요"
  if ollama pull "$MODEL"; then
    ok "$MODEL pull 완료"
  else
    err "$MODEL pull 실패 — 모델명/디스크 확인. mock 으로 폴백."
    set_env "TRIPLE_EXTRACTOR_PROVIDER" "mock"
    exit 1
  fi
fi

set_env "TRIPLE_EXTRACTOR_PROVIDER" "ollama"
set_env "TRIPLE_EXTRACTOR_ENDPOINT" "$OLLAMA_ENDPOINT"
set_env "TRIPLE_EXTRACTOR_MODEL" "$MODEL"
ok ".env: TRIPLE_EXTRACTOR_PROVIDER=ollama, MODEL=$MODEL"

echo
ok "LLM provider 셋업 완료 — triple 추출이 실제 LLM ($MODEL) 로 동작"
echo "  변경 반영: ./infra/scripts/restart.sh (api 인스턴스 재기동)"
