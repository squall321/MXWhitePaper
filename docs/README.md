# MX White Paper — Docs Index

> 새로 들어온 동료: 작업 영역을 정하고 아래 표의 첫 번째 진입점만 읽으면 된다.
> 코드를 만지기 전에 **반드시** [docs/lat/](./lat/) 의 해당 area 문서를 먼저 본다 (`CLAUDE.md` 강제 룰).

## 한 문장 요약

> **MX 사업부 위키** — 나무위키 스타일 계층 (`1`/`1.1`/`1.1.1`) + 37+ block widget +
> JSON-First REST API + Apptainer 배포. HWAX portal sub-path 또는 standalone 동작.

## 어디서부터 읽어야 하나

| 무엇을 하려고 하나? | 첫 진입점 |
| --- | --- |
| 처음 클론, 1분 안에 띄우기 | [`/README.md` 의 "1분 시작 가이드"](../README.md#1분-시작-가이드-apptainer-기반) |
| 코드를 만질 area 가 정해진 상태 | [`docs/lat/README.md`](./lat/README.md) → 해당 area `.md` |
| 새 block / widget 추가 | [`docs/lat/documents.md`](./lat/documents.md) → "새 block type 추가" 절 |
| docx/pptx import 흐름 | [`docs/lat/imports.md`](./lat/imports.md) |
| 외부 LLM 에 위젯 생성 시키기 | [`docs/llm-widgets-via-api.md`](./llm-widgets-via-api.md) |
| 외부 LLM 이 백서를 *읽을 때* (요약/Q&A) | [`docs/llm-viewer-guide.md`](./llm-viewer-guide.md) (영문: `.en.md`) |
| HWAX portal sub-path 로 띄우기 | [`docs/HWAX-PORTAL-INTEGRATION.md`](./HWAX-PORTAL-INTEGRATION.md) |
| 배포 / 운영 (apptainer instance 관리) | [`docs/deployment-playbook.md`](./deployment-playbook.md) |
| Windows Server / 에어갭 머신 배포 | [`docs/06-windows-server-deployment.md`](./06-windows-server-deployment.md) |
| PDCA 사이클로 새 기능 계획 | [`docs/01-plan/`](./01-plan/) |
| *지나간* 사이클 학습용 (G→N + meta-loop) | [`docs/archive/2026-06/_INDEX.md`](./archive/2026-06/_INDEX.md) |

## 3-zone 배포 아키텍처

```
ONLINE BUILD HOST (인터넷 / npm / Docker-Hub 도달 가능)
  • MXWP_BASE_PATH=/mx-white-paper/ pnpm --filter @mx/web build
  • apptainer build web.sif (apps/web/dist 베이크)
  • make ship  →  Drive (rclone + sha256)
                              │
                              ▼
cae00 DEPLOY (corp TLS-intercept, no npm / no Docker-Hub)
  • make pull-web  → web.sif 받음
  • make up        → mxwp_web instance (no build)
  • serve -s /opt/web/dist on :5173
                              │
                              ▼
HWAX PORTAL (front nginx)
  • https://hwax.sec.samsung.net/mx-white-paper/  → :5173
  • /mx-white-paper/api/*                          → :8800 (API server)
```

- **online build host**: 본 머신 (`110.15.177.120`) 또는 외부 빌드 인스턴스. SPA build + image 패키징.
- **cae00**: 코퍼레이트 TLS intercept 네트워크. `npm install` / `docker pull` 불가능. 배포만.
- **HWAX portal**: nginx reverse proxy. base path stripping 안 함 → SPA 가 prefix 안고 빌드되어야 함.

상세: [`docs/HWAX-PORTAL-INTEGRATION.md`](./HWAX-PORTAL-INTEGRATION.md) + Makefile 의 `make ship` / `make pull-web`.

## 디렉토리 의미

| 디렉토리 | 답하는 질문 |
| --- | --- |
| [`lat/`](./lat/) | **지금** 코드는 어떻게 생겼나? (지도, 코드 만지기 전 필수) |
| [`01-plan/`](./01-plan/) | **왜** 이걸 만들기로 했나? (Plan 단계 문서) |
| [`02-design/`](./02-design/) | **어떻게** 만들 건가? (Design 단계 문서) |
| [`03-do/`](./03-do/) | **무엇을** 구현 중인가? (Do 단계 진행) |
| [`03-analysis/`](./03-analysis/) | Gap 분석 / 매치율 (Check 단계 산출물) |
| [`04-report/`](./04-report/) | 사이클 완료 보고서 (Report 단계 산출물) |
| [`archive/`](./archive/) | 닫힌 사이클들 — 학습 / 누적 history |
| [`copilot/`](./copilot/) | Copilot 위임용 작업 명세 |
| [`backlog/`](./backlog/) | 발견된 작업 / 우선순위 큐 |

코드가 진실. lat 는 코드를 빠르게 탐색하기 위한 *지도*. 충돌 시 코드 우선.

## CLAUDE.md 강제 룰 (개발자 + AI 양쪽)

1. 코드를 만지기 *전에* `docs/lat/<해당 area>.md` 1 장을 먼저 읽는다.
2. 코드 변경으로 lat 의 사실관계가 깨지면 **같은 commit 에서** lat 갱신.
3. Apptainer 환경 — `docker run` 같은 명령은 동작 안 함.
4. 작업 완료 보고 전 실제 동작 확인 (테스트 / curl / type check / 브라우저).

상세: [`/CLAUDE.md`](../CLAUDE.md).
