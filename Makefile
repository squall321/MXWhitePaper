.PHONY: help build up down restart logs status migrate seed schema-gen schema-validate openapi-dump codegen test lint clean pyinstaller-smoke glossary-dump build-web ship-web pull-web ship

help:
	@echo "MX White Paper — Apptainer-based stack"
	@echo ""
	@echo "  make build           Build/pull all .sif images (postgres, meili, minio, api, web)"
	@echo "  make up              Start all 5 service instances (host network)"
	@echo "  make down            Stop all instances (data preserved in infra/data/)"
	@echo "  make restart         down + up"
	@echo "  make status          Show instances + healthchecks"
	@echo "  make logs SVC=api    Tail logs for one service (api|web|postgres|meili|minio)"
	@echo "  make migrate         alembic upgrade head"
	@echo "  make seed            Load seed data (orgs + 5 sample documents)"
	@echo "  make schema-gen      Regenerate TS + Python types from JSON Schema"
	@echo "  make schema-validate Validate golden samples against JSON Schema"
	@echo "  make openapi-dump    Dump FastAPI runtime spec to apps/api/openapi.json"
	@echo "  make codegen         schema-gen + openapi-dump (run before commit)"
	@echo "  make glossary-dump   Dump approved glossary terms to rag/glossary.json (needs DB up)"
	@echo "  make test            Run all tests"
	@echo "  make lint            Run linters across the monorepo"
	@echo "  make clean           Remove .sif images and bind-mounted data (DESTRUCTIVE)"
	@echo ""
	@echo "  ─ Portal ship pipeline (online build host → Drive → cae00) ─"
	@echo "  make build-web       Build SPA dist (portal base baked) + repack web.sif"
	@echo "  make ship-web        Push web.sif to Drive (rclone, sha256-verified)"
	@echo "  make ship            build-web + ship-web (one-shot online-side release)"
	@echo "  make pull-web        Pull web.sif from Drive into infra/apptainer/ (run on cae00)"

SCRIPTS := ./infra/scripts

build:
	$(SCRIPTS)/build.sh

up:
	$(SCRIPTS)/start.sh

down:
	$(SCRIPTS)/stop.sh

restart: down up

status:
	$(SCRIPTS)/status.sh

logs:
	$(SCRIPTS)/logs.sh $(SVC)

migrate:
	$(SCRIPTS)/migrate.sh

seed:
	$(SCRIPTS)/seed.sh

schema-gen:
	pnpm -w schema:gen

schema-validate:
	pnpm -w schema:validate

# Dump FastAPI runtime OpenAPI spec. Prefers the running api instance so we
# don't need to install the full Python deps on the host.
openapi-dump:
	@if apptainer instance list 2>/dev/null | grep -q mxwp_api; then \
		apptainer exec instance://mxwp_api /bin/sh -c "cd /workspace && python3 apps/api/app/scripts/dump_openapi.py"; \
	else \
		python3 apps/api/app/scripts/dump_openapi.py; \
	fi

codegen: schema-gen openapi-dump
	@echo "✓ codegen complete (TS + Pydantic + OpenAPI snapshot)"

test:
	pnpm -r run test
	apptainer exec instance://mxwp_api /bin/sh -c "cd /workspace/apps/api && pytest"

lint:
	pnpm -r run lint
	apptainer exec instance://mxwp_api /bin/sh -c "cd /workspace/apps/api && ruff check ."

clean:
	-$(MAKE) down
	rm -f infra/apptainer/*.sif
	rm -rf infra/data
	@echo "✓ images and data removed"

# S6 — local PyInstaller smoke test. N-3 사이클의 수동 verify 단축.
# preflight (hidden import 누락 체크) + build lite + 4 binary --version
# 응답 확인. CI 는 .github/workflows/llm-docx-toolkit.yml 에서 동일
# pipeline 을 example docx 까지 verify (이 target 은 단축 버전).
# self-review F5 — `set -o pipefail` 로 build 실패가 tail 파이프에 의해
# 삼켜지지 않게 함. --clean 으로 stale work-dir 의 dependency drift 회피.
pyinstaller-smoke:
	apptainer exec instance://mxwp_api bash -lc 'set -o pipefail; \
		cd /workspace/dist/llm-docx-toolkit && \
		python3 build.py --clean --variant lite 2>&1 | tail -20 && \
		echo "=== binary version check ===" && \
		for b in mxwp-validator mxwp-rules mxwp-mcp mxwp-import; do \
			echo "--- $$b ---"; \
			./bin/$$b-linux --version || { echo "[FAIL] $$b"; exit 1; }; \
		done && \
		echo "✓ all 4 binaries respond to --version" \
	'

# Phase 3 — glossary offline dump. DB 의 approved terms 를
# rag/glossary.json 으로 저장해 DB 없는 환경 (CI / PyInstaller binary) 에서도
# chunker 가 glossary chunk 를 만들 수 있게 한다.
glossary-dump:
	apptainer exec instance://mxwp_api bash -lc 'cd /workspace && set -a && . ./.env && set +a && python3 dist/llm-docx-toolkit/rag/chunker.py --dump-glossary'

# ── Portal ship pipeline (D) ─────────────────────────────────────────
# 3-zone 아키텍처를 자동화 — online build host → Drive → cae00.
#
#   make build-web  : SPA dist 빌드 (portal base 베이크) + web.sif 재포장
#                     온라인 빌드 호스트 (인터넷 / npm / Docker-Hub 도달 가능) 에서만 실행.
#   make ship-web   : web.sif 를 Drive 로 push (sha256 verify).
#                     온라인 빌드 호스트에서 build-web 직후 실행.
#   make ship       : 위 둘을 묶은 one-shot — 일반적인 릴리즈 흐름.
#   make pull-web   : Drive 에서 web.sif 받아 infra/apptainer/ 에 stage.
#                     cae00 (corp TLS-intercept) 에서만 실행 — 빌드 0 회.
#
# 사용 흐름:
#   [online host]   make ship                # build + push
#   [cae00]         make pull-web && make up # pull + start (no build)
#
# .env 의 MXWP_IMAGES_REMOTE (예: MxwpDrive:MXWhitePaper/images) 필수.
build-web:
	@echo "→ building SPA dist with portal base"
	@MXWP_BASE_PATH=$${MXWP_BASE_PATH:-/mx-white-paper/} \
		pnpm --filter @mx/web build
	@echo "→ rebuilding web.sif (bakes apps/web/dist)"
	@apptainer build --force infra/apptainer/web.sif infra/apptainer/web.def

ship-web:
	@$(SCRIPTS)/images-to-drive.sh

ship: build-web ship-web
	@echo "✓ web.sif built + shipped to Drive"

pull-web:
	@$(SCRIPTS)/images-from-drive.sh
