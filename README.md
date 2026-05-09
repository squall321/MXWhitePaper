# MX White Paper

> 사업부 지식 창고 — 나무위키 스타일 + 1/1.1/1.1.1 계층 + Block 기반 위젯 + JSON-First REST API

[![docs](https://img.shields.io/badge/docs-PROJECT__PLAN-1428A0)](./PROJECT_PLAN.md)
[![PDCA](https://img.shields.io/badge/PDCA-Sprint__0-2E5BFF)](./docs/03-do/features/MX-WhitePaper.do.md)

---

## 1분 시작 가이드 (Apptainer 기반)

> 본 프로젝트는 **Apptainer**로 운영됩니다(Docker 아님). HPC 친화적, root 불필요, single-`.sif` 이미지.

### 한 줄 시작 — 권장

```bash
./quickstart.sh
```

[quickstart.sh](quickstart.sh)가 8단계(preflight → .env → host deps → codegen → 이미지 빌드 → instance 기동 → 마이그/시드 → status)를 멱등하게 실행합니다. 재실행 시 완료 단계는 자동 skip.

| 옵션 | 동작 |
|------|------|
| `./quickstart.sh` | 처음부터 끝까지 실행 |
| `./quickstart.sh --only-7` | 상태 확인만 |
| `./quickstart.sh --skip-2 --skip-3` | 호스트 deps·codegen 건너뛰기 |
| `./quickstart.sh --help` | 전체 단계 설명 |

### 사전 요구사항

- **apptainer ≥ 1.2** (`apptainer --version`)
- pnpm 9 + node 20 (호스트, 스키마 codegen용)
- python 3.12 (호스트, datamodel-code-generator 실행용)

### 수동 실행 (단계별 이해 원할 때)

```bash
# 1) 환경 변수
cp .env.example .env

# 2) 호스트 의존성
pnpm install
pip install --user datamodel-code-generator

# 3) 스키마 → TS·Python 타입 + OpenAPI 스냅샷 + baseline 커밋 (최초 1회)
make codegen   # = pnpm schema:gen + python3 apps/api/app/scripts/dump_openapi.py
git add apps/web/src/types/document.ts apps/api/app/schemas/document.py apps/api/openapi.json
git commit -m "chore: codegen baseline"

# 4) Apptainer 이미지 빌드/풀 (한 번만)
make build

# 5) 전체 스택 기동 (5개 instance, host network)
make up

# 6) 마이그레이션 + 시드
make migrate && make seed

# 7) 상태/접속
make status
# Web:   http://localhost:5173
# API:   http://localhost:8000/docs   (Swagger)
# Meili: http://localhost:7700
# MinIO: http://localhost:9001        (콘솔)

# 정지
make down       # 데이터(infra/data/) 보존
make clean      # .sif + 데이터 모두 삭제 (DESTRUCTIVE)
```

> **운영 환경 차이**: Apptainer instance는 host network로 실행되므로 모든 서비스가 `127.0.0.1:PORT`로 통신합니다. Docker Compose의 internal DNS와 다른 점에 유의.

## 모노레포 구조

```
MXWhitePaper/
├── apps/
│   ├── web/                   # React + TS + Vite (SPA)
│   └── api/                   # FastAPI + SQLAlchemy + Alembic
├── packages/
│   └── shared/                # DocumentJSON v1.0 SSOT (JSON Schema → TS + Python)
├── infra/                     # Docker Compose, nginx, devcontainer
├── docs/                      # PDCA: plan / design / do / analysis / report
└── PROJECT_PLAN.md            # 종합 계획서
```

## 핵심 문서

| 문서 | 위치 |
|------|------|
| 종합 계획서 | [PROJECT_PLAN.md](./PROJECT_PLAN.md) |
| PDCA Plan | [docs/01-plan/features/MX-WhitePaper.plan.md](./docs/01-plan/features/MX-WhitePaper.plan.md) |
| PDCA Design | [docs/02-design/features/MX-WhitePaper.design.md](./docs/02-design/features/MX-WhitePaper.design.md) |
| PDCA Do (Sprint 0) | [docs/03-do/features/MX-WhitePaper.do.md](./docs/03-do/features/MX-WhitePaper.do.md) |
| Document JSON 스키마 SSOT | [packages/shared/schemas/document.json](./packages/shared/schemas/document.json) |

## 기술 스택

- **Frontend**: React 18 · TypeScript · Vite · TanStack Query · Zustand · Tailwind · BlockNote · Recharts
- **Backend**: FastAPI · Pydantic v2 · SQLAlchemy 2.0 (async) · Alembic
- **Storage**: PostgreSQL 15 (JSONB + pgvector) · Meilisearch · MinIO
- **Infra**: Docker Compose · devcontainer · GitHub Actions matrix(Win/Mac/Linux)

## 개발 명령어

```bash
make help              # 모든 명령 보기
make up | down         # 서비스 기동/중지
make logs SVC=api      # 로그 확인
make migrate | seed    # 마이그레이션·시드
make schema-gen        # 타입 재생성
make codegen           # 타입 재생성 + FastAPI OpenAPI 스냅샷 (커밋 전 실행)
make test | lint       # 테스트·린트
```

## API 한 번 호출로 페이지 만들기

DocumentJSON v1.0 한 파일만 있으면 위키 페이지가 즉시 만들어집니다.

```bash
# 1) 파일 import (멱등 — 같은 slug 재실행하면 PUT 으로 동작)
apptainer exec instance://mxwp_api /bin/sh -c \
  "cd /workspace/apps/api && python -m app.scripts.import_one /workspace/packages/shared/samples/01-month-end-closing.json"
# → {"mode":"replace", "slug":"month-end-closing",
#    "version":2, "url":"/api/v1/documents/month-end-closing",
#    "tree_path":"/mx/finance/accounting/closing",
#    "warnings":[]}

# 2) HTTP 로 직접 POST 도 가능
curl -X POST http://localhost:8000/api/v1/documents \
  -H 'Content-Type: application/json' \
  --data @packages/shared/samples/05-minimal-doc.json

# 3) CSV 로 한 번에 여러 문서 (admin only, ≤500 행 / ≤5 MB)
#    샘플: apps/api/scripts/sample-bulk-import.csv
curl -X POST http://localhost:8000/api/v1/imports/csv \
  -F "file=@apps/api/scripts/sample-bulk-import.csv"
# → {"data":{"created":N,"skipped":M,"errors":[…]}, "meta":{"total_rows":…}}
```

CSV 컬럼 (헤더 case-insensitive):
`slug,title,summary,division,team,group,part,tags,owners,confidentiality,body`.
`tags` 는 `,` 또는 `|`, `owners` 는 `|` 로 분리. `body` 의 빈 줄(`\n\n`)이
단락 경계이며 한 행은 level-1 섹션 하나로 만들어집니다. slug 가 이미 있으면
`skipped` 로 집계 — 충돌 없이 점진적 마이그레이션이 가능합니다.

POST 한 번이면 다음이 모두 자동으로 수행됩니다:

- DocumentJSON 본문 검증 + 섹션 1/1.1/1.1.1 번호 부여
- `metadata.part` 가 한글 이름이어도 자동으로 part_id 로 해석 (해석 실패 시 `meta.warnings` 회신)
- 본문 내 `[[slug]]` (한글 slug 포함) 위키링크 그래프 갱신
- `metadata.tags` → `tags` + `document_tags` 동기화
- `glossary[]` → `terms.related_docs[]` 누적/제거 동기화
- Meilisearch 인덱스 + `documents_flat_v` materialized view 갱신
- `audit_logs` 감사 기록

자세한 입출력은 Swagger `/docs` 페이지에서 확인할 수 있습니다 (각 엔드포인트에 한국어 요약 + 예시).

## Word(.docx) 가져오기

`POST /api/v1/imports/docx` (FE: `/docs/import`) — .docx 파일을 업로드하면
DocumentJSON v1.0 으로 변환합니다.

지원 (블록 변환표):

| docx feature | DocumentJSON 결과 |
| --- | --- |
| Heading 1/2/3 | `SectionLevel1/2/3` (스택 추적 + 자동 부모 보강) |
| Heading 4+ | `heading-4` 블록 |
| 일반 단락 | `paragraph` (markdown-lite: `**bold**`, `*italic*`, `~~strike~~`, `__underline__`) |
| 하이퍼링크 | `[label](url)` 인라인 |
| 표 | `table` 블록 (1행=headers, Caption 스타일 단락 → `meta.note`) |
| 그림(drawing) | `image` 블록 (sha256 dedup, `meta.width/height` 는 EMU→px) |
| OOXML 수식(`m:oMath`) | `math` 블록 (디스플레이) 또는 `$…$` (인라인) |
| 번호/불릿 리스트 | `list` 블록 (depth 는 2-space 들여쓰기) |
| 페이지 브레이크 | 빈 단락 + `meta.note='page-break-before'` |
| 각주 | 본문 끝 "각주" level-1 섹션 |

알려진 한계 / 폴백:

- **SmartArt** → 텍스트만 보존, 도형/관계는 손실됨.
- **임베디드 차트** → drawing 안의 raster image 만 추출 (chart 블록으로
  자동 변환 안 함).
- **복잡 수식** (matrix, accent, function with limits over) → 변환 실패 시
  `code` 블록 (`language='omml-xml'`) 으로 폴백.
- **Track changes / 코멘트** → 무시 (현재 텍스트만 사용).
- **헤더/푸터** → 본문에 포함하지 않음.
- **이미지 영속화**: 현 구현은 import 응답 시점에 placeholder ULID 만
  발급. 실제 MinIO 영속화는 추후 백그라운드 잡으로 분리 예정 (대량 이미지가
  포함된 .docx 의 import 지연을 피하기 위해).

제약:

- 크기 한도: **30 MB**
- 권한: editor 이상
- 레이트 리밋: **5/min/user**
- 응답은 DB 미기록. FE 가 받은 DocumentJSON 을 사용자 확인 후 별도로
  `POST /documents` 로 영구화한다 (이중 확인 UX).

## 전체 검증 (한 번에 schema + tsc + build + vitest)

`apps/web/scripts/check-all.sh` 는 회로(circuit) 4개를 차례로 돌려 “지금
스택이 통째로 컴파일 가능한가”를 한 번에 확인합니다. 새 widget·sample을
추가하거나 schema/렌더러를 손본 직후 마지막 게이트로 쓰세요.

```bash
chmod +x apps/web/scripts/check-all.sh   # 최초 1회
./apps/web/scripts/check-all.sh
# ▶ 1/4  Validate DocumentJSON samples       (pnpm --filter @mx/shared run validate)
# ▶ 2/4  TypeScript typecheck (@mx/web)
# ▶ 3/4  Vite build (@mx/web)
# ▶ 4/4  Vitest                              (apps/web — unit+integration, no e2e)
```

운영 노트:

- **샘플 9개 모두 valid** (`packages/shared/samples/01..09-*.json`) — schema 변경 시 가장 먼저 깨지는 게이트.
- **AllBlocksRender** (26 tests) + **AllBlockEditors** (21 tests) 가 SSOT 26 block
  타입의 read-mode/edit-mode 컴파일을 한 번에 보장합니다.
- BE에 샘플을 즉시 반영하려면 `python -m apps.api.scripts.seed_samples` (orgs/admin은 `app.scripts.seed`가 먼저 깔려있어야 함).

## AI 보조 훅 (요약 / 번역 / 다듬기 / 이어쓰기 / 제목 자동생성)

EditorToolbar 의 "✨ AI" 버튼을 통해 5종의 보조 액션을 호출합니다.
**현재 응답은 모두 placeholder** — 실제 LLM 호출은 별도 작업으로 분리되어
있고, FE 와이어링·rate-limit·feature flag 만 미리 깔아둔 상태입니다.

### 1) Feature flag

`.env` (또는 apptainer `--env-file`) 에 다음을 설정:

```bash
AI_ENABLED=true        # 기본 false. false 이면 모든 /ai/* 가 503(AI_DISABLED).
```

flag 가 꺼져 있으면 BE 가 503 + `{ "code": "AI_DISABLED" }` 를 돌려주고,
FE 는 "AI 기능이 비활성화되어 있습니다. 관리자에게 문의하세요." 메시지를
보여줍니다.

### 2) 현재는 placeholder 응답

- `/ai/summarize` → 입력의 앞 ~30% (문장 경계에서 절단)
- `/ai/translate` → `[KO→EN placeholder] <원문>` 처럼 라벨링된 원문
- `/ai/polish`    → 좌우 공백 제거 + 끝 문장부호 `.` 정규화
- `/ai/continue`  → `"...(이어 쓰기 자리표시자: 실제 LLM 연결 시 자동완성)"`
- `/ai/title`     → 입력의 앞 50자

모든 endpoint 는 editor+ 권한 + **10/min/user** in-process rate-limit.

### 3) 실제 LLM 연결 (추후)

`apps/api/app/routers/ai.py` 의 `_call_llm(...)` placeholder 를 실 SDK 호출로
교체하면 됩니다. 권장 절차:

1. `.env` 에 키 추가:

   ```bash
   OPENAI_API_KEY=sk-...
   # 또는
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. `apps/api/app/core/config.py` 의 `Settings` 에 `openai_api_key` /
   `anthropic_api_key` 필드 추가.
3. `_call_llm` 안에서 `AsyncOpenAI` 또는 `AsyncAnthropic` 호출.
4. 각 placeholder 함수 (`_placeholder_summary` 등) 를 system-prompt + user-text
   조합으로 교체. **응답 shape (`{ summary }`, `{ translated, source_language }`,
   …) 는 그대로** 두면 FE 변경 없이 실시간 응답이 흐릅니다.

## i18n in MX White Paper

Lightweight in-house i18n layer, no external library. Default locale is Korean
(`ko`); English (`en`) is the secondary locale. The active language lives in
the global settings store (`useSettingsStore.language`), which round-trips
through `localStorage` (`mxwp.uiSettings`).

### Bundle file structure

- `apps/web/src/lib/i18n/ko.ts` — source-of-truth Korean strings.
  `LocaleKey` is `keyof typeof ko`, so every key in this file is statically
  enforced across the codebase.
- `apps/web/src/lib/i18n/en.ts` — English mirror. Typed as
  `Record<LocaleKey, string>` so renaming a key in `ko.ts` surfaces a TS
  error here.
- `apps/web/src/lib/i18n/index.ts` — `t()`, `useT()`, `useLocale()`. The
  imperative `t()` reads the live store on the server (handy in unit tests);
  the hook version subscribes via `useSyncExternalStore` so React components
  re-render on locale switch.

### Adding a new key

1. Add the Korean string in `ko.ts`. Pick a dotted namespace
   (`topbar.search.placeholder`, `palette.callout`, `shortcuts.basic.save`).
2. Add the matching English string in `en.ts` (typecheck enforces this).
3. Replace the hard-coded literal at the call site:

   ```tsx
   import { useLocale } from '@/lib/i18n'
   const { t } = useLocale()
   return <button title={t('toolbar.save.title')}>{t('toolbar.save')}</button>
   ```

   For one-shot scripts / non-React code use the imperative `t('key')` —
   it reads the same store, just without the subscription.

4. Optional placeholders: `t('hello', { name: '구건모' })` → the bundle string
   `안녕, {name}!` becomes `안녕, 구건모!`.

### Switching locale

- UI: the **🌐 KO/EN** dropdown in the top bar, next to the profile menu
  (`apps/web/src/components/layout/LanguageSwitcher.tsx`). Selection persists
  to `localStorage` immediately.
- Settings page: `/settings → 언어` exposes the same toggle for keyboard users.
- Programmatic: `useSettingsStore.getState().set('language', 'en')`.

### Coverage today

Sprint scope: TopBar, Breadcrumb, BlockInsertPalette tile labels,
EditorToolbar buttons, KeyboardShortcutsModal sections + descriptions, and
the existing home / login / settings pages. The block editors, AI feature
strings, and per-page copy still use Korean literals — they're earmarked for
a follow-up extraction pass. Missing keys at runtime emit a single
`console.warn('[i18n] missing key: …')` and fall through to the key itself,
so dev-mode usage surfaces gaps.

## PWA / 오프라인

`apps/web/public/` 에 vanilla service worker (`service-worker.js`) +
`manifest.webmanifest` 가 들어 있다. 등록 헬퍼는
`apps/web/src/features/pwa/swRegistration.ts` 에 있고, dev 모드(`import.meta.env.DEV`)에서는 HMR 충돌을 피하려고 자동 skip 된다.

캐시 전략:

| 패턴 | 전략 | 캐시 이름 |
| --- | --- | --- |
| `/assets/*` (Vite hashed) | stale-while-revalidate | `mxwp-runtime-v1` |
| `GET /api/v1/documents/:slug` | network-first, 캐시 폴백 (LRU 50) | `mxwp-docs-v1` |
| 그 외 `/api/v1/*` | network-first, no fallback | — |
| HTML navigation | network-first → app-shell → `offline.html` | `mxwp-static-v1` |

오프라인 상태에서 캐시된 문서를 보여줄 때는 SW 가 응답에
`X-Mxwp-Cache: hit` 헤더를 추가하고, `WikiArticle` 헤더의
`<OfflineBanner />` 가 `navigator.onLine === false` 시 안내 띠를 띄운다.

설치 프롬프트는 `<InstallPrompt />` 가 `beforeinstallprompt` 를 가로채
오른쪽 아래 "📱 앱으로 설치" 알약 버튼으로 노출한다 (이미 standalone 상태면 숨김).

### 아이콘

`apps/web/public/icon-192.png` + `icon-512.png` 가 빌드에 포함되어
있어 크롬 데스크톱 설치 게이트가 통과한다 (Samsung 블루 배경 + 흰색 "MX"
워드마크). 두 가지 방법으로 재생성할 수 있다:

```bash
# (a) Node 빌트인만 — 단색 placeholder
node apps/web/scripts/gen-pwa-icons.cjs

# (b) Pillow 사용 — "MX" 워드마크 포함 (현재 커밋된 형태)
python3 apps/web/scripts/gen-pwa-icons.py
```

브랜드 디자인 PNG 가 따로 있다면 동일 경로에 덮어쓰면 매니페스트가 자동으로 잡는다.

### 미배송

- 푸시 알림 (Notification API + push subscription) — 별도 사이클.
- background sync (`periodicSync`) 통한 자동 미러 — 별도 사이클.
- service-worker 자체에 대한 진짜 jsdom + workbox-style 단위 테스트 —
  현재는 smoke test (parse + listener wiring) 만 있다.

## Webhook 페이로드

외부 도구(Slack/Discord/Teams/Linear/...) 와 연결할 때 사용되는 outgoing
webhook 의 본문 형식 + 서명 알고리즘. 관리자 화면 `/admin/webhooks` 에서
URL/이벤트/part 필터/secret 을 등록한다.

### 헤더

```http
POST <등록한 URL>
Content-Type:    application/json
User-Agent:      mx-white-paper-webhook
X-MXWP-Signature: sha256=<hex digest>
```

`X-MXWP-Signature` 의 hex digest 는

```text
HMAC_SHA256(secret, raw_body_bytes)
```

로 계산된다. `secret` 은 등록 직후 1회만 평문으로 회신되며 이후 화면/응답에서는
`••••<last4>` 로 마스킹된다. 수신측은 받은 `raw_body_bytes` 와 자기가 보관 중인
secret 으로 같은 HMAC 을 계산해 `sha256=` 접두사까지 포함한 문자열을 비교하면
된다 (timing-safe 비교 권장).

#### Python 검증 예시

```python
import hmac, hashlib

def verify(raw: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), raw, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)
```

#### Node 검증 예시

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(raw, header, secret) {
  const exp = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
  return (
    exp.length === header.length &&
    timingSafeEqual(Buffer.from(exp), Buffer.from(header))
  )
}
```

### 이벤트 종류

| event_kind        | 트리거                                   | 페이로드 핵심 필드                              |
|-------------------|------------------------------------------|-------------------------------------------------|
| `doc_created`     | `POST /api/v1/documents`                 | `document_id, slug, title, version, actor_user_id` |
| `doc_edited`      | 모든 본문/섹션/블록 수정                 | `document_id, slug, title, version, actor_user_id, change_log` |
| `doc_published`   | `transition` → `published`               | `document_id, slug, title, actor_user_id, from_status` |
| `comment_added`   | `POST /documents/:slug/comments`         | `document_id, slug, comment_id, anchor_kind, anchor_id, author_user_id, body_md` |
| `review_decided`  | 리뷰어가 결정 제출 (approved/rejected/changes_requested) | `document_id, slug, title, reviewer_user_id, status, comment` |

모든 페이로드는 공통적으로 `event` 필드(이벤트 종류 문자열) 를 포함한다.

### 신뢰성

`5xx` 또는 timeout 응답 시 약 60초 뒤에 1회 재시도된다. 4xx 는 영구 실패로
간주되어 재시도하지 않으며, `webhooks.last_status` 가 `4xx` 로 갱신된다.
`/admin/webhooks` 의 “전송 로그” 모달이 최근 20건의 응답 코드 + 본문 일부를
보여 주므로 디버깅에 사용한다. `webhooks.filter_part_ids` 에 part UUID 를 넣어
두면 그 part 에 속한 문서의 이벤트만 발사된다 (빈 리스트 = 모든 part 매칭).

## 최종 기능 (cycle 20 기준)

20 사이클의 자기개선 루프를 거친 시점의 모듈 단위 요약:

- **Editor / Renderer**: BlockNote 기반 에디터 + 26 종 블록 (paragraph,
  heading-2/3/4, list, table, image, file, callout, code, math, mermaid,
  whiteboard, form, org-chart, flow, gantt, calculator, dashboard-embed,
  data-source, kpi-cards, gallery, chart, quiz, embed, divider, …).
- **검색 / 임베드**: Meilisearch 인덱스 + dependency graph 페이지
  (`/dep-graph` — cytoscape cose-bilkent + d3-force fallback) + 위키링크
  자동 갱신.
- **워크플로우 자동화**: 이벤트(`doc_published`, `review_decided`, …) +
  cron 트리거(IANA 시간대 지원), webhook · 알림 · 이메일 · 태그 · 상태
  전이 액션, 다단계 chain, 실행 로그.
- **공유 / 협업**: 공유 링크 (만료, 비밀번호, 짧은 alias, **수신 거부**
  토큰), 코멘트/리뷰/승인 → 알림 / 이메일 다이제스트 / 구독.
- **import / export**: DocumentJSON, .docx, .pptx, Markdown, PDF, CSV bulk
  import.
- **운영**: 백업 러너, 보존 정책, audit pruner, search audit, TOTP 2FA,
  API token scopes, RBAC.
- **PWA**: 192/512 PNG 아이콘 포함, network-first / cache-then-network 전략,
  오프라인 페이지.

### 주요 라우트 맵

| 경로 | 역할 |
| ------ | ------ |
| `/` | 홈 / 최근 문서 |
| `/docs/:slug` | 문서 읽기 |
| `/docs/:slug/edit` | 문서 편집 (editor+) |
| `/docs/:slug/present` | 프리젠테이션 모드 |
| `/dep-graph?root=<slug>` | 의존성 그래프 (cytoscape) |
| `/share/:token` | 공개 공유 링크 |
| `/share/short/:short_id` | 짧은 alias 리다이렉트 |
| `/share/email-optout?token=…` | 공유 메일 수신 거부 |
| `/admin/automation` | 자동화 규칙 관리 (admin) |
| `/admin/webhooks` | webhook 관리 (admin) |
| `/admin/sso-providers` | SSO 공급자 (admin) |
| `/admin/health` | 헬스 대시보드 (admin) |

### 환경 변수 핵심

`.env.example` 에 전체 목록이 있다. 운영에서 가장 자주 만지는 것들:

| 키 | 의미 |
| --- | --- |
| `DATABASE_URL` | Postgres async URL |
| `MEILI_URL` / `MEILI_KEY` | 검색 |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | 파일 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | 이메일 |
| `EMAIL_ENABLED` | false 면 콘솔 폴백 |
| `AI_ENABLED` | `/ai/*` 게이트 |
| `MXWP_SKIP_AUTOMATION` | `1` 이면 cron/이벤트 ticker 정지 (테스트용) |
| `JWT_SECRET` | 토큰 서명 |

### 핵심 명령어 한 줄 모음

```bash
make codegen                           # 스키마 → TS/Python + OpenAPI 스냅샷
make migrate                           # alembic upgrade head
make seed                              # 초기 데이터
make up | down | clean                 # 서비스 라이프사이클
pnpm --filter @mx/web run typecheck    # FE 타입 검사
pnpm --filter @mx/web run build        # 프로덕션 번들
pnpm --filter @mx/web test             # vitest
pytest -q                              # BE 테스트
node apps/web/scripts/check-bundle-size.cjs   # 번들 게이트
./apps/web/scripts/check-all.sh        # 4단계 통합 게이트
```

### Production checklist

`launch` 전에 수동 확인이 필요한 항목들. 자동화된 회로(루프)에서 다루지
않거나, 도메인 결정이 남아 있어 의도적으로 deferred 된 것들이다.

- [ ] **AI 백엔드 연결** — `apps/api/app/routers/ai.py` 의 `_call_llm` 을
  실 SDK 로 교체 (현재 5종 모두 placeholder).
- [ ] **PWA 아이콘 디자인** — 현재는 단색 + "MX" 워드마크.
  `apps/web/public/icon-{192,512}.png` 를 디자인 시안으로 교체.
- [ ] **이미지 영속화 잡** — .docx import 가 placeholder ULID 만 발급.
  실제 MinIO 업로드는 백그라운드 잡으로 분리 예정.
- [ ] **푸시 알림 / periodic background sync** — PWA 미배송 영역.
- [ ] **Service worker 단위 테스트** — 현재는 smoke 만.
- [ ] **다중 replica cron ticker** — 현재는 single-replica 가정 (`automation_cron`,
  `digest_runner`, `retention_runner`, `reminder_runner`, `backup_runner`).
  HA 배포 시 advisory lock 또는 외부 큐로 마이그레이트.
- [ ] **Webhook 4xx 영구 실패 알림** — admin email 통보 흐름 미작성.
- [ ] **i18n 확장** — 블록 에디터 라벨, AI 패널 등 한국어 리터럴이 남은 영역.
- [ ] **HTML email 템플릿** — 현재는 plain text 만.
- [ ] **SSO 프로비저닝 자동화** — SsoProviders 모듈은 라우터/페이지만 있고,
  실제 SAML / OIDC 핸드셰이크는 Z1 에이전트가 마무리 중.
- [ ] **Health 대시보드 실시간 스트리밍** — Z2 에이전트가 별도 진행 중.
- [ ] **Custom CSS 인젝션 보안 리뷰** — Z3 에이전트가 별도 진행 중.

자동화된 회로가 추적 중인 follow-up 은 본 문서가 아니라
`docs/04-analysis/` 의 마지막 분석서를 참조.

## 라이선스

사내 전용 (UNLICENSED)
