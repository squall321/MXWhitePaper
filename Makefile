.PHONY: help build up down restart logs status migrate seed schema-gen schema-validate openapi-dump codegen test lint clean

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
	@echo "  make test            Run all tests"
	@echo "  make lint            Run linters across the monorepo"
	@echo "  make clean           Remove .sif images and bind-mounted data (DESTRUCTIVE)"

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
pyinstaller-smoke:
	apptainer exec instance://mxwp_api bash -lc '\
		cd /workspace/dist/llm-docx-toolkit && \
		python3 build.py --variant lite 2>&1 | tail -20 && \
		echo "=== binary version check ===" && \
		for b in mxwp-validator mxwp-rules mxwp-mcp mxwp-import; do \
			echo "--- $$b ---"; \
			./bin/$$b-linux --version || { echo "[FAIL] $$b"; exit 1; }; \
		done && \
		echo "✓ all 4 binaries respond to --version" \
	'
