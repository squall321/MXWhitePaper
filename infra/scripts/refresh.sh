#!/usr/bin/env bash
# 스택을 최신 코드/스키마로 간단 재실행 — down → up → migrate.
# 앱 코드는 /workspace bind 라 재시작만으로 최신 반영되고, DB/Meili/MinIO 데이터는
# infra/data bind 로 보존된다. FUSE overlay 장애("transport endpoint is not
# connected") 나 코드/마이그레이션 갱신 후 원클릭 복구용.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
cd "$REPO_ROOT"

echo "▶ (1/3) 스택 정지 (data 보존)"
bash "$HERE/stop.sh" || true
sleep 2

echo "▶ (2/3) 스택 기동"
bash "$HERE/start.sh"

echo "▶ (3/3) 마이그레이션 (최신 스키마 반영)"
bash "$HERE/migrate.sh"

echo ""
echo "✓ 최신화 완료"
echo "  api : http://127.0.0.1:8800/docs"
echo "  web : http://127.0.0.1:5173"
