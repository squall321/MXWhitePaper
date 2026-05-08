# MX White Paper — 사업부 지식 창고 구축 계획서

> **작성일**: 2026-05-06
> **목적**: 나무위키 스타일의 사업부 업무 백서 시스템 구축. 팀/그룹/파트 단위로 업무 지식을 체계적으로 정리하고, 업무 간 유관관계를 링크로 탐색한다. JSON-First 데이터 모델로 추후 AI 보조·Word 자동 변환(Phase 4) 통합에 대비한다.
> **사용자**: 사업부 내부 인원(작성자 + 열람자)
> **현재 단계**: 기획/설계 (Phase 0)

---

## 1. Executive Summary

| 항목 | 내용 |
|------|------|
| 프로젝트명 | MX White Paper (사업부 지식 창고) |
| 형태 | 사내 위키형 웹 애플리케이션 |
| 핵심 가치 | ① 분산된 업무 지식의 단일 소스화 ② 신규 인원 온보딩 시간 단축 ③ 위젯 기반 풍부한 표현(차트·동적 데이터) ④ Word 기반 기존 자료의 손쉬운 마이그레이션(후속 Phase) |
| 기술 스택 | **FE**: React + TypeScript + Vite / **BE**: FastAPI(Python) / **DB**: PostgreSQL + Meilisearch / **Infra**: **Apptainer** (`.def` + instance scripts, root-less, HPC 친화) |
| UI 컨셉 | 나무위키 레이아웃 + Samsung Blue(#1428A0) 톤앤매너 |
| 개발 기간(예상) | Sprint 0 (Foundation) 1주 + Sprint 1~6 (MVP) 6주 + Phase 2 4주 + Phase 3 4주 = **총 15주** (Phase 4 LLM 통합은 별도 의사결정) |

### 4-관점 가치 정의

| 관점 | 내용 |
|------|------|
| Problem | 업무 지식이 사람·PPT·Word·메일에 분산되어 신규 입사자 적응에 수개월 소요. 담당자 퇴사·이동 시 지식 휘발 |
| Solution | 위키형 단일 플랫폼 + 1/1.1/1.1.1 계층 + 위키 링크로 업무 간 관계 시각화 + Block 기반 위젯(차트·이미지·표·영상) + 자연스러운 이미지·캡션 UX. Word 자동 변환은 Phase 4 |
| UX 효과 | 검색 → 읽기 → 관련 문서 탐색이 3 클릭 이내. 작성은 AI가 70% 초안 생성 |
| Core Value | "업무를 묻지 말고 백서를 검색하라" — 지식의 자가증식 사이클 |

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────┐
│                  Browser (사내 사용자)                    │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTPS
       ┌─────────────▼──────────────┐
       │   Nginx Reverse Proxy       │
       └──┬─────────────────────┬───┘
          │                     │
   ┌──────▼────────┐    ┌───────▼──────────────┐
   │  React SPA    │    │  FastAPI App (MVP)   │
   │ (Vite build,  │    │  - REST API          │
   │  static)      │    │  - Auth (JWT, RBAC)  │
   │               │    │  - WikiLink parser   │
   │               │    │  - Image processor   │
   └───────────────┘    └───┬──────────────┬───┘
                            │              │
              ┌─────────────▼───┐  ┌───────▼─────────┐  ┌─────────────────┐
              │  PostgreSQL     │  │  Meilisearch    │  │  MinIO (S3)     │
              │  (JSONB+pgvec)  │  │  (전문검색)      │  │  (이미지/파일)    │
              └─────────────────┘  └─────────────────┘  └─────────────────┘

  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ Phase 4 (별도 의사결정) ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ┊  ┌─── FastAPI App (Phase 4 확장) ───┐                                ┊
  ┊  │  - LLM Gateway (어댑터)           │ ─→  ┌──────────────────┐      ┊
  ┊  │  - Word Parser (python-docx)     │     │ LLM Provider      │      ┊
  ┊  └──────────────────────────────────┘     │ (사내 모델 우선)    │      ┊
  ┊                                            └──────────────────┘      ┊
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
```

> **MVP 범위**: 실선 박스만. LLM/Word 변환은 Phase 4 점선 영역으로 분리. JSON-First API와 Pydantic 스키마 export로 추후 통합 비용을 최소화한다.

### 크로스 플랫폼 지원 전략 — Apptainer 기반
- **Apptainer (구 Singularity)**: HPC 친화, root 권한 불필요, single-`.sif` 이미지로 어떤 Linux/HPC 클러스터에서도 동일 실행
- **`.def` 파일 + 빌드 스크립트**: `infra/apptainer/{api,web}.def` + 베이스 이미지는 `apptainer pull docker://...`로 즉시 확보
- **Instance Orchestration**: `infra/scripts/{build,start,stop,status,logs,migrate,seed}.sh`로 Docker Compose 대체 (host network 모드)
- **Persistent 데이터**: `infra/data/{postgres,meili,minio}/` host bind-mount
- **CI**: GitHub Actions matrix로 ubuntu/macos/windows 빌드·테스트(스키마 + 코드 정적 검증). Apptainer 통합 테스트는 self-hosted Linux runner 사용

---

## 3. 데이터 모델 (핵심)

### 3.1 조직 계층 (Organization Hierarchy)
```
Division (사업부)
  └── Team (팀)
        └── Group (그룹)
              └── Part (파트)
                    └── Document (업무 백서)
```

### 3.2 PostgreSQL 스키마 (요약)

| 테이블 | 주요 컬럼 | 설명 |
|--------|----------|------|
| `divisions` | id, name, slug, description | 사업부 |
| `teams` | id, division_id, name, slug, lead | 팀 |
| `groups` | id, team_id, name, slug | 그룹 |
| `parts` | id, group_id, name, slug | 파트 |
| `documents` | id, part_id, title, slug, content_json (JSONB), summary, status, owner_id | **업무 백서 본체** |
| `document_versions` | id, document_id, version, content_json, edited_by, edited_at, change_log | 버전 이력 |
| `links` | id, source_doc_id, target_doc_id, anchor, link_type | 위키 링크 그래프 |
| `terms` | id, term, definition, related_doc_ids | 용어집(Glossary) |
| `tags` | id, name | 태그 |
| `document_tags` | document_id, tag_id | 다대다 |
| `users` | id, email, name, role, team_id | 사용자 |
| `audit_logs` | id, user_id, action, target, timestamp | 감사 로그 |

### 3.3 Document JSON 스키마 (JSON-First SSOT)

> **SSOT 위치**: `packages/shared/schemas/document.json` (JSON Schema 2020-12).
> 본 문서의 예시는 참고용이며, 정식 스키마는 [docs/02-design/features/MX-WhitePaper.design.md §3.1](docs/02-design/features/MX-WhitePaper.design.md)을 따른다. 추후 Phase 4에서 LLM/Word 변환의 입출력 포맷으로 그대로 재사용된다.

> **핵심 설계 원칙**: 문서 = **계층화된 Section 트리** (최대 3단계: 1 / 1.1 / 1.1.1) + 각 Section의 **Block 배열**. Block은 텍스트/표/위젯 등 자유 조합. → "나무위키의 견고한 목차 + Notion의 자유로운 본문"의 결합.

```json
{
  "schema_version": "1.0",
  "id": "01J9X1Y2Z3A4B5C6D7E8F9G0H1",
  "slug": "month-end-closing",
  "title": "재무회계 결산 프로세스",
  "summary": "월간/분기/연간 결산 절차와 R&R",
  "metadata": {
    "division": "MX",
    "team": "재무팀",
    "group": "회계그룹",
    "part": "결산파트",
    "owners": ["u-홍길동"],
    "reviewers": ["u-김철수"],
    "tags": ["결산", "프로세스", "R&R"],
    "category": "프로세스",
    "confidentiality": "internal"
  },
  "infobox": {
    "주요 산출물": "재무제표",
    "주기": "월간/분기/연간",
    "관련 시스템": ["SAP", "Hyperion"]
  },
  "sections": [
    {
      "id": "01J9X1Y2Z3A4B5C6D7E8F9G0S1",
      "number": "1",
      "level": 1,
      "title": "개요",
      "blocks": [
        { "type": "paragraph", "id": "01J...B1", "text": "이 문서는 ... [[월결산 체크리스트]] 참고." },
        { "type": "callout",   "id": "01J...B2", "variant": "info", "text": "본 절차는 분기마다 갱신됩니다." }
      ],
      "subsections": [
        {
          "id": "01J...S11", "number": "1.1", "level": 2, "title": "결산 일정",
          "blocks": [
            { "type": "table", "id": "01J...B3",
              "headers": ["단계","D-day","담당"],
              "rows": [["취합","D-3","결산팀"],["검토","D-1","감사팀"]] }
          ],
          "subsections": [
            {
              "id": "01J...S111", "number": "1.1.1", "level": 3, "title": "월결산 상세 일정",
              "blocks": [
                { "type": "chart", "id": "01J...B4", "chartType": "gantt",
                  "data": { "tasks": [{"name":"마감","start":"D-3","end":"D-1"}] } },
                { "type": "video", "id": "01J...B5",
                  "url": "https://intra/video/closing", "title": "결산 교육 영상" }
              ],
              "subsections": []
            }
          ]
        }
      ]
    }
  ],
  "related_documents": [
    {"slug": "month-end-checklist",  "relation": "참고"},
    {"slug": "sap-account-mapping",  "relation": "선행"}
  ],
  "glossary": [
    {"term": "DPS", "definition": "Days Payable Sales"}
  ],
  "references": [
    {"type": "internal", "label": "사내 회계규정 v3.2"},
    {"type": "external", "label": "K-IFRS 1018", "url": "https://www.kasb.or.kr/..."}
  ],
  "see_also": ["financial-policy", "audit-process"]
}
```

> **위키 링크 표기**: `[[문서 slug|표시 텍스트]]` — 나무위키 동일 문법 채택. 렌더링 시 그래프 갱신.
> **계층 제약**: `level ∈ {1, 2, 3}`만 허용. 그 이하는 Block(`heading-4`)으로 표현. 이는 TOC 가독성 + 자동 번호 매기기 안정성을 위함.

### 3.4 Block 타입 카탈로그 (위젯 시스템)

> 각 Section의 `blocks[]`는 아래 Block 타입을 자유롭게 조합. **Block은 1급 객체**로 독립 편집/이동/복사/AI 보조 가능.

| 카테고리 | type | 설명 | MVP |
|---------|------|------|-----|
| **텍스트** | `paragraph` | 마크다운 텍스트(위키 링크 포함) | ✅ |
| | `heading-4` | level 4 이상 소제목(번호 X) | ✅ |
| | `list` | 순서/비순서/체크리스트 | ✅ |
| | `quote` | 인용 | ✅ |
| | `callout` | 정보/주의/경고 박스(variant: info\|warn\|danger\|tip) | ✅ |
| | `code` | 코드 블록(언어 지정, syntax highlight) | ✅ |
| | `math` | 수식(KaTeX) | P1 |
| **표** | `table` | 일반 표(정렬/검색/병합 셀) | ✅ |
| | `kpi-cards` | KPI 카드 그리드(라벨/값/델타) | P1 |
| **차트(위젯)** | `chart` | line/bar/pie/area/radar/scatter (chartType + data) | ✅ |
| | `gantt` | 일정/타임라인 | P1 |
| | `flow` | 플로우차트(Mermaid/excalidraw) | P1 |
| | `org-chart` | 조직도 | P2 |
| **동적/임베드** | `iframe` | 화이트리스트 사내 도메인 | P1 |
| | `video` | 사내 영상/유튜브 | ✅ |
| | `dashboard-embed` | Grafana/Tableau/Superset 패널 ID 임베드 | P2 |
| | `data-source` | API 연결 → 실시간 표/차트 (예: 일일 KPI) | P2 |
| | `calculator` | 입력값 → 수식 계산(예: ROI 계산기) | P2 |
| **미디어** | `image` | 이미지 + 캡션 + 클릭 확대 | ✅ |
| | `gallery` | 이미지 갤러리 | P1 |
| | `file` | 첨부파일(다운로드) | ✅ |
| **참조** | `doc-link-card` | 위키 문서 카드(요약 + 썸네일) | P1 |
| | `glossary-ref` | 용어 임베드(인라인 정의) | P1 |
| **레이아웃** | `columns` | 2/3 컬럼 레이아웃(중첩 block 가능) | P1 |
| | `tabs` | 탭(중첩 block) | P1 |
| | `accordion` | 접기/펼치기 | P1 |

#### Block 공통 스키마
```ts
interface Block {
  id: string;              // ulid
  type: BlockType;
  // 타입별 필드 (위 카탈로그 참조)
  // 공통 옵션
  meta?: {
    align?: 'left'|'center'|'right'|'full';
    collapsed?: boolean;
    permission?: 'all'|'editor'|'admin';
    locked?: boolean;       // 편집 잠금
    note?: string;          // 작성자 메모(독자에게 미노출)
  }
}
```

#### 차트 위젯 — `chart` 상세
```json
{
  "type": "chart",
  "id": "blk-x",
  "chartType": "line",
  "title": "월별 결산 소요시간 추이",
  "data": {
    "labels": ["1월","2월","3월","4월"],
    "series": [
      {"name":"실적","values":[5,4.5,4.8,4.2]},
      {"name":"목표","values":[5,5,5,5]}
    ]
  },
  "options": { "yLabel": "Days", "stacked": false }
}
```
- 렌더링: `Recharts` 우선, 복잡한 케이스만 `Plotly`
- **MVP**: 표(`table`) 우클릭 → "차트로 변환" → 헤더 추론 기반 휴리스틱 추천
- **Phase 4 (LLM)**: LLM이 데이터 의미까지 파악하여 더 적절한 chartType·축·색상 추천

#### 동적 데이터 위젯 — `data-source` 상세
```json
{
  "type": "data-source",
  "id": "blk-y",
  "endpoint": "/api/v1/widgets/kpi/finance-daily",
  "params": { "team": "재무팀" },
  "render": "kpi-cards",
  "refreshInterval": 300
}
```
- 백엔드 `/api/v1/widgets/*` 라우터에서 사전 정의된 데이터 소스만 허용(보안)
- 위젯 정의는 `widget_registry.yaml`에 화이트리스트로 관리



---

## 4. UI / UX 설계 (나무위키 스타일 + Samsung Blue)

### 4.1 컬러 토큰
```css
--smsg-blue-900: #0A1F8F;   /* 헤더, 강조 */
--smsg-blue-700: #1428A0;   /* Samsung primary */
--smsg-blue-500: #2E5BFF;   /* 링크, 버튼 */
--smsg-blue-100: #E8EEFF;   /* 정보박스 배경 */
--smsg-gray-900: #1A1A1A;   /* 본문 텍스트 */
--smsg-gray-500: #6B7280;   /* 메타 텍스트 */
--smsg-gray-100: #F3F4F6;   /* 박스 배경 */
--smsg-link-red: #C00;      /* 미작성 링크 (나무위키 관습) */
```

### 4.2 레이아웃 (3-column)

```
┌──────────────────────────────────────────────────────┐
│ [Top Nav] 검색바 | 사업부▾ | 최근문서 | 작성 | 프로필 │
├────────────┬──────────────────────────┬──────────────┤
│            │                          │              │
│ Left Side  │       Article Body       │ Right Side   │
│ - 트리 탐색 │  ┌────────────────────┐  │ - 목차(TOC)  │
│   ▸ 사업부  │  │  Infobox (우상단)   │  │ - 관련 문서  │
│     ▸ 팀   │  └────────────────────┘  │ - 용어집     │
│       ▸ 그룹│  # 제목                  │ - 최근 편집자 │
│         ▸ 파트                         │              │
│            │  ## 1. 개요              │              │
│            │  본문 [[링크]] ...        │              │
│            │                          │              │
└────────────┴──────────────────────────┴──────────────┘
                    Footer
```

### 4.3 핵심 UI 컴포넌트

| 컴포넌트 | 설명 | 우선순위 |
|---------|------|---------|
| `WikiArticle` | 본문 렌더러: 자동 1/1.1/1.1.1 번호 매김, infobox, TOC, Block 렌더 | P0 |
| `SectionRenderer` | 섹션 단위 렌더(번호 + 제목 + Block 리스트), section permalink(#1.1.1) | P0 |
| `BlockRenderer` | Block 타입별 디스패처(text/table/chart/video/...) | P0 |
| `WikiLink` | `[[..]]` 파싱, 미작성 링크는 빨간색 + 작성 유도 | P0 |
| `Sidebar/Tree` | 팀-그룹-파트 트리 네비 (접기/펼치기) | P0 |
| `Infobox` | 우상단 정보 박스 (메타 키-값) | P0 |
| `TableOfContents` | 우측 sticky TOC, 1.1.1 들여쓰기, 스크롤 추적 | P0 |
| **`SectionEditor`** | 섹션 단위 인라인 편집(In-place), Block 추가/이동 | **P0** |
| **`BlockEditor`** | Block 타입별 폼(차트는 데이터 그리드, 표는 셀 편집...) | **P0** |
| **`OutlineEditor`** | 좌측 아웃라인에서 섹션 드래그로 순서/계층 변경 | **P0** |
| **`SlashCommandMenu`** | `/`로 Block 삽입 메뉴 (Notion 스타일) | **P0** |
| **`CommandPalette`** | `⌘K` 어디서나 액션/문서 검색 | P1 |
| `ChartEditor` | 표 ↔ 차트 변환, 시리즈/축/색상 GUI 편집 | P1 |
| `WordImportWizard` | 업로드 → LLM 변환 → 미리보기 → 확정 | **Phase 4** |
| `RelatedDocs` | 우측 관련 문서 카드 | P1 |
| `GlossaryTooltip` | 용어 마우스오버 시 정의 팝업 | P2 |
| `RevisionHistory` | 버전 비교 / 롤백 | P2 |
| `GraphView` | 문서 간 링크 그래프 시각화(D3) | P3 |

### 4.4 검색
- **빠른 검색**: 상단바 자동완성(타이틀/태그) — Meilisearch
- **고급 검색**: 본문/태그/팀 필터, 작성자/기간

---

## 5. 핵심 기능 상세

### 5.1 위키 링크 그래프
- 문서 저장 시 본문 파싱 → `links` 테이블 갱신
- 미작성 문서 링크는 빨간색 표시 + 클릭 시 "이 문서 작성하기" 유도
- 백링크(이 문서를 참조하는 문서들) 자동 표시

### 5.2 에디터 — "일목요연한 수정" 핵심 설계 ⭐

> 에디터는 본 시스템의 **가장 중요한 컴포넌트**. 작성/수정 비용을 최소화하기 위해 **3단 통합 인터페이스** + **Block 기반 편집** + **AI 보조** 채택.

#### 5.2.1 3단 통합 레이아웃

```
┌─────────────────────────────────────────────────────────────────────┐
│  [저장] [되돌리기] [버전이력] [미리보기] [공개도▾] [AI 도움말]         │
├──────────────┬─────────────────────────────────┬────────────────────┤
│              │                                 │                    │
│  Outline     │   Section / Block Editor        │   AI Assist /      │
│  (구조)       │   (현재 섹션만 집중 편집)         │   Live Preview     │
│              │                                 │                    │
│  ▼ 1. 개요   │   ┌── 섹션 헤더 ──────────────┐   │  [요약 생성]        │
│    ▾ 1.1 일정 │  │ # 1.1.1 월결산 상세 일정  │   │  [섹션 제안]        │
│      • 1.1.1 │  │ [↑↓] [복제] [삭제] [잠금] │   │  [용어 추출]        │
│  ▶ 2. R&R    │  └──────────────────────────┘   │                    │
│  ▶ 3. 산출물  │                                 │  ─── 또는 ───       │
│              │   [Block 1: 문단]               │                    │
│  [+섹션]      │   ┌──────────────────────────┐   │  Live Preview      │
│              │   │ 본문 입력... /로 위젯     │   │  (오른쪽 분할)      │
│              │   └──────────────────────────┘   │                    │
│              │   [드래그 핸들][⋮ 메뉴]          │                    │
│              │                                 │                    │
│              │   [Block 2: 차트]               │                    │
│              │   ┌── chart: line ──────────┐   │                    │
│              │   │ [데이터 그리드]          │   │                    │
│              │   │ [축/색상] [미리보기]     │   │                    │
│              │   └──────────────────────────┘   │                    │
│              │                                 │                    │
│              │   [+ 블록 추가] (또는 / 누르기) │                    │
└──────────────┴─────────────────────────────────┴────────────────────┘
```

#### 5.2.2 5대 편집 원칙

| 원칙 | 구현 |
|------|------|
| **① Section 단위 집중** | 한 번에 한 섹션만 편집(기본). 거대 문서 스크롤 지옥 방지. URL `?edit=sec-1.1.1`로 딥링크 |
| **② Block 단위 조작** | 모든 콘텐츠는 Block. Block은 ↑↓ 이동 / 복제 / 삭제 / 다른 섹션으로 이동 가능 |
| **③ Outline 우선** | 좌측 Outline에서 드래그로 섹션 순서/계층(1↔1.1↔1.1.1) 즉시 재구성. 번호는 자동 재계산 |
| **④ 슬래시 커맨드** | `/`만 누르면 Block 삽입 메뉴(차트, 표, 영상, 콜아웃...). 키보드만으로 작성 가능 |
| **⑤ 무손실 저장** | 자동 저장(5초 idle) + 명시 저장. 모든 저장은 새 버전 생성. **Optimistic Locking**으로 충돌 방지 |

#### 5.2.3 편집 모드 3가지

| 모드 | 단축키 | 용도 |
|------|--------|------|
| **읽기** | `E` 토글 | 일반 열람 |
| **빠른 편집(Quick Edit)** | 섹션 우상단 ✏️ | 단일 섹션만 수정 — 90% 케이스 |
| **전체 편집(Full Edit)** | 상단 [편집] 버튼 | 구조 재편/대규모 변경 시 |

→ "오타 1개 고치려고 전체 페이지를 편집 모드로 들어가는" 비효율 제거.

#### 5.2.4 충돌 / 동시 편집

- **MVP**: Optimistic Locking (`updated_at` + version 번호). 충돌 시 diff 표시 후 사용자 선택
- **Phase 2**: Section 단위 잠금(편집 중 표시). 동시 편집자는 다른 섹션으로 안내
- **Phase 3 (선택)**: Yjs/Automerge 기반 실시간 협업(필요성 확인 후 도입)

#### 5.2.5 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `/` | 슬래시 커맨드 (Block 삽입) |
| `⌘K` | 커맨드 팔레트(액션/문서/위젯 검색) |
| `⌘S` | 저장 |
| `⌘Z` / `⌘⇧Z` | 되돌리기 / 다시 |
| `⌘↑` / `⌘↓` | 현재 Block 위/아래 이동 |
| `⌘D` | Block 복제 |
| `⌘⌫` | Block 삭제 |
| `Tab` / `⇧Tab` | Outline에서 섹션 들여쓰기/내어쓰기(계층 변경) |
| `[[` | 위키 링크 자동완성 |
| `@` | 사용자/팀 멘션 |

#### 5.2.6 이미지·캡션 UX ⭐ (P0, 본 시스템 핵심 차별점)

> 업무 백서는 **스크린샷·다이어그램·사진**이 매우 빈번하다. "올리고 → 설명 다는" 흐름이 단 3초 안에 끝나야 한다.

**올리는 방법(어디서든)**
- ① **드래그 앤 드롭**: 본문 어디든 OS 파일을 끌어다 놓으면 즉시 업로드 + 위치에 삽입
- ② **클립보드 붙여넣기**: 스크린샷(`⌘⇧4`/`Win+Shift+S`) 후 `⌘V` → 즉시 업로드
- ③ **슬래시 커맨드**: `/이미지` 또는 `/img` → 파일 다이얼로그
- ④ **갤러리 드래그**: 여러 파일 동시 드롭 → `gallery` 블록으로 자동 변환 제안
- ⑤ **다른 문서에서 복사**: 이미지 우클릭 → "다른 문서로 복사"

**캡션 다는 흐름 (자연스러운 인터페이스)**
- 업로드 완료 즉시 이미지 **하단에 placeholder "캡션 입력..."** 자동 노출 + 포커스 이동
- 캡션 입력은 **인라인 텍스트** (별도 모달 X). Enter로 확정, Esc로 빈 캡션 유지
- `⇥(Tab)`으로 캡션 → Alt 텍스트로 빠른 이동(접근성)
- 캡션은 마크다운 일부 허용(굵게/링크/위키 링크 `[[..]]`)

**조작 (이미지 위에 마우스 호버 시 노출되는 컨트롤)**
| 컨트롤 | 동작 |
|--------|------|
| 드래그 핸들(좌상) | 다른 위치/섹션으로 이동 |
| 크기 슬라이더(우하) | 25% / 50% / 75% / 100% / 전체폭 |
| 정렬 토글 | 좌 / 가운데 / 우 / 전체폭(grid-wrap) |
| 자르기(crop) | 인라인 크롭 도구(Phase 2) |
| 교체(replace) | 같은 위치에서 파일 교체 |
| 링크 | 클릭 시 이동할 URL/문서 슬러그 |
| 다운로드 | 원본 다운로드 |
| 삭제 | 휴지통(7일 복구 가능) |

**갤러리 블록 (`gallery`)**
- 다중 이미지 드롭 시 자동 제안: "이미지 N장을 갤러리로?"
- 그리드 / 캐러셀 / 라이트박스 모드 토글
- 캡션은 각 이미지 아래 인라인, 또는 일괄 입력 모드

**스토리지 / 처리**
- 백엔드 `/api/v1/uploads/image` 엔드포인트: presigned URL 발급(S3/MinIO)
- **자동 변환**: WebP 변환 + 3종 크기(thumb 320px / view 1024px / orig)
- **EXIF 제거**: 보안/프라이버시 (위치정보 등)
- **중복 제거**: SHA-256 해시로 동일 이미지 1회만 저장
- **이미지 최대 크기**: 단건 20MB, 갤러리 일괄 100MB

**접근성 / 검색**
- Alt 텍스트 입력 권장 알림(빈 상태일 때 노란 표시)
- 캡션·Alt 텍스트는 Meilisearch 인덱싱 대상 → "그래프", "조직도" 같은 키워드로 이미지 검색 가능

#### 5.2.7 표·차트 GUI 편집기

- **표 ↔ 차트 1클릭 변환**: 표 헤더 자동 인식 → 적절한 차트 추천 → 미세조정 GUI
- **데이터 그리드**: Excel-like 셀 편집(복사/붙여넣기 지원). CSV 붙여넣기 = 자동 표 생성
- **수식 셀**: `=SUM(A1:A5)` 등 간단한 수식(Phase 2)
- **실시간 미리보기**: 편집과 동시에 우측 패널에서 즉시 렌더

#### 5.2.7 기술 선택 (에디터)

| 옵션 | 근거 |
|------|------|
| **TipTap (ProseMirror 기반)** | Block 구조, 슬래시 커맨드, 확장성 우수. Notion 풍 UX 가능. **채택** |
| Lexical (Meta) | 신생, 학습 곡선 ↑ |
| BlockNote | TipTap 래퍼, 빠른 시작 가능 → **MVP 가속용 검토** |
| Plate (Slate) | 커스터마이즈 강함, 안정성 보통 |

→ **결정**: BlockNote으로 MVP → 필요 시 TipTap 직접 구성으로 다운그레이드(커스텀 Block 자유도 위해)

### 5.3 JSON-First API 설계 (LLM 통합 대비)

> **결정**: LLM 기반 자동화(AI 작성 보조 / Word→JSON 변환)는 **후순위 Phase**로 미룬다.
> 단, 모든 API와 데이터 모델은 **JSON-First**로 설계하여 추후 LLM이 그대로 입출력으로 사용 가능하도록 준비만 해둔다.

**JSON-First 설계 원칙**
- 문서의 단일 진실 공급원(SSOT)은 `documents.content_json` (JSONB)
- 모든 읽기/쓰기 API는 DocumentJSON v1.0 스키마를 입출력
- API 엔드포인트 예:
  - `POST /api/v1/documents` — DocumentJSON 그대로 받음(LLM이 생성한 JSON 직접 업로드 가능)
  - `GET /api/v1/documents/{slug}` — DocumentJSON 그대로 반환
  - `POST /api/v1/documents/{slug}/sections` — Section 단위 부분 업데이트
  - `POST /api/v1/documents/{slug}/blocks` — Block 단위 부분 업데이트
- Pydantic 모델은 OpenAPI 스키마 + JSON Schema로 자동 export → 추후 LLM Function Calling/Structured Output에 그대로 주입
- `packages/shared/schemas/document.json`은 단일 SSOT, TS/Python 타입 자동 생성

**후속 LLM 통합 (Phase 4 이후, 별도 의사결정)**
| 기능 | 도입 단계 | 비고 |
|------|----------|------|
| Word → JSON 자동 변환 | Phase 4 | python-docx + LLM JSON 모드 |
| AI 작성 보조 (요약/섹션 제안/용어 추출) | Phase 4 | 임베딩 + LLM |
| 관련 문서 추천 | Phase 4 | pgvector 임베딩 |
| 문법/스타일 교정 | Phase 5 | 사내 톤앤매너 가이드 |

→ **MVP 시점 Word 마이그레이션**은 사용자 수동 입력(에디터의 우수한 UX로 보조). 자동 변환은 도입 가치 검증 후.

---

## 6. 인증 / 권한

| 역할 | 권한 |
|------|------|
| Guest | (사내 SSO 미인증) → 접근 불가 |
| Reader | 모든 공개 문서 열람 |
| Editor | 자기 팀/그룹 문서 작성·수정 |
| Owner | 문서 단위 owner 권한(삭제/공개도) |
| Admin | 사용자/조직/태그 관리, 감사 |

- **인증**: 사내 SSO(Azure AD/SAML) 우선, MVP는 이메일/비밀번호 + JWT
- **세션**: Access 1h / Refresh 7d
- **감사 로그**: 모든 쓰기 작업 기록

---

## 7. 개발 로드맵 (Phase 별)

### Phase 0 — 기반 (1주)
- [ ] 모노레포 구조 (`apps/web`, `apps/api`, `packages/shared`)
- [ ] Apptainer 인프라: postgres, meilisearch, minio, api, web (`.def` + start/stop 스크립트)
- [ ] devcontainer / GitHub Actions CI 골격
- [ ] DB 마이그레이션 (Alembic) + 시드 데이터

### Phase 0 — Foundation (1주)
- [ ] **Sprint 0**: 모노레포 + **Apptainer 인프라**(`.def` + 스크립트) + `packages/shared` JSON Schema SSOT + TS·Python codegen + Alembic 초기 마이그레이션 + GitHub Actions CI matrix(Win/Mac/Linux 정적)

### Phase 1 — MVP (6주)
- [ ] **Sprint 1**: 조직 계층 CRUD + 트리 네비 + 문서 GET/POST/PUT/DELETE (JSON-First)
- [ ] **Sprint 2**: 문서 읽기 — 1/1.1/1.1.1 자동 번호 + Block 렌더(text/list/table/callout/code/image)
- [ ] **Sprint 3**: 위키 링크 파서 + 나무위키 레이아웃(3-column, Infobox, TOC) + 백링크
- [ ] **Sprint 4**: ⭐ **에디터 MVP** — BlockNote 통합 + Outline 편집 + Slash Command + Section 단위 빠른 편집 + Optimistic Locking
- [ ] **Sprint 5**: ⭐ **이미지·캡션 UX** (드래그/붙여넣기/인라인 캡션/리사이즈) + `gallery` 위젯 + 이미지 스토리지(MinIO)
- [ ] **Sprint 6**: 위젯 MVP(`chart`/`video`) + Meilisearch 검색 + 인증(JWT/RBAC) + E2E 5종

**MVP 완료 기준**: 100건 시드 문서, 5명 사용자 시범, 이미지 첨부 평균 시간 ≤ 5초, JSON-First API 100% 커버리지(OpenAPI export), TS·Python 타입 codegen CI 통과

### Phase 2 — 협업 / 풍부한 위젯 (4주)
- [ ] 버전 이력 + diff 뷰
- [ ] 백링크 + 용어집 툴팁
- [ ] 위젯 확장: `gantt` / `flow(Mermaid)` / `kpi-cards` / `tabs` / `columns`
- [ ] 권한 세분화 + 감사 로그
- [ ] 이미지 인라인 크롭/회전, 갤러리 라이트박스

### Phase 3 — 확장 (4주)
- [ ] 그래프 뷰(문서간 링크 시각화)
- [ ] 댓글/리뷰/승인 워크플로우
- [ ] PDF/Word 내보내기
- [ ] 사내 SSO 연동
- [ ] 모니터링(Prometheus/Grafana)
- [ ] 동적 위젯: `data-source` / `dashboard-embed`

### Phase 4 — LLM 자동화 (별도 의사결정 후 착수)
- [ ] Word(.docx) → DocumentJSON 자동 변환 파이프라인
- [ ] AI 작성 보조 (요약/섹션 제안/용어 추출)
- [ ] 관련 문서 추천(pgvector 임베딩)
- [ ] 골든셋 회귀 테스트 (`evals/word_to_json/`)

---

## 8. 디렉토리 구조 (제안)

```
MXWhitePaper/
├── apps/
│   ├── web/                  # React + TS + Vite
│   │   ├── src/
│   │   │   ├── components/   # WikiArticle, Sidebar, Editor ...
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── lib/          # api client, wiki parser
│   │   │   ├── styles/       # tokens.css (Samsung Blue)
│   │   │   └── main.tsx
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                  # FastAPI
│       ├── app/
│       │   ├── routers/      # documents, orgs, search, import
│       │   ├── models/       # SQLAlchemy
│       │   ├── schemas/      # Pydantic (DocumentJSON v1.0)
│       │   ├── services/     # llm, word_parser, search
│       │   ├── core/         # config, security, db
│       │   └── main.py
│       ├── alembic/
│       ├── tests/
│       └── pyproject.toml
│
├── packages/
│   └── shared/               # 공유 JSON 스키마 + 타입 (TS/Python 동시 생성)
│       ├── schemas/document.json
│       └── codegen/          # datamodel-code-generator로 .py / .ts 생성
│
├── docs/
│   ├── 01-plan/PROJECT_PLAN.md   # 본 문서
│   ├── 02-design/
│   ├── 03-api/                   # OpenAPI export
│   └── 04-runbook/
│
├── evals/
│   └── word_to_json/         # 골든 샘플 + 회귀테스트
│
├── infra/
│   ├── apptainer/
│   │   ├── api.def
│   │   ├── web.def
│   │   └── *.sif (build 산출물, gitignore)
│   ├── scripts/
│   │   ├── build.sh / start.sh / stop.sh
│   │   ├── status.sh / logs.sh
│   │   └── migrate.sh / seed.sh
│   ├── data/                      # bind-mount (gitignore)
│   │   ├── postgres/  meili/  minio/
│   ├── nginx/
│   └── .devcontainer/
│
├── .github/workflows/        # ci.yml, release.yml (multi-arch)
├── Makefile                  # make up / make seed / make test
└── README.md
```

---

## 9. 기술 선택 근거

| 영역 | 선택 | 대안 | 근거 |
|------|------|------|------|
| FE 프레임워크 | React + Vite | Next.js | SPA 성격 강함. SEO 불필요(사내). 빌드 속도 우선 |
| 상태관리 | TanStack Query + Zustand | Redux | 서버 상태 위주, 보일러플레이트 최소 |
| UI 라이브러리 | Tailwind + shadcn/ui (커스텀) | Mantine, Chakra | 나무위키 룩앤필 커스텀 자유도 |
| 마크다운 | `react-markdown` + `remark`/`rehype` 플러그인 | MDX | 본문은 데이터, 코드 실행 불필요 |
| BE 프레임워크 | FastAPI | Django, Flask | OpenAPI 자동, 비동기, Pydantic 친화 |
| ORM | SQLAlchemy 2.0 + Alembic | Tortoise | 성숙도 + 마이그레이션 |
| DB | PostgreSQL (JSONB + pgvector) | MySQL | JSONB로 문서 저장, pgvector로 임베딩 |
| 검색 | Meilisearch | Elasticsearch | 셋업 단순, 한국어 양호, 사내 규모 충분 |
| Word 파싱 (Phase 4) | `python-docx` + `mammoth` | unoconv | 순수 파이썬, 안정적 |
| LLM (Phase 4) | 사내 모델 우선, OpenAI/Anthropic은 어댑터 | — | 어댑터 패턴으로 교체 가능 |
| 이미지 스토리지 | MinIO (S3 호환) | 로컬 디스크 | Presigned URL 표준, 사내 운영 |
| 배포 | **Apptainer instances** (사내, host network) | Docker Compose, K8s | HPC 친화, root 불필요, single-`.sif` 이식성 |

---

## 10. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| LLM Word 변환 품질 불균일 (Phase 4) | 중 | 골든셋 회귀테스트, 변환 미리보기 + 수동 보정 모드. MVP 범위 외 |
| 사내 보안 정책상 외부 LLM 호출 불가 | 고 | LLM 어댑터 인터페이스로 사내 모델 교체 가능 설계 |
| 위키 링크 양산으로 미작성 링크 폭증 | 중 | 미작성 링크 대시보드, "오늘의 작성 추천" |
| 작성자 인센티브 부족 | 고 | 기여도 리더보드, 팀별 KPI 연계(별도 협의) |
| Markdown 학습 부담 | 중 | WYSIWYG 토글 + AI 초안 생성으로 진입 장벽 완화 |

---

## 11. 성공 지표 (KPI)

### 11.1 MVP 6개월 목표 (Phase 1~3)

| 지표 | 목표 | 측정 |
|------|------|------|
| 등록 문서 수 | 500+ | DB count |
| 월간 활성 사용자(MAU) | 사업부 인원의 70%+ | audit_logs 분석 |
| 평균 문서당 백링크 수 | ≥ 3 | links 테이블 |
| 신규 입사자 온보딩 시간 | -30% (체감 설문) | 분기별 설문 |
| 검색 → 클릭률(CTR) | ≥ 60% | search 이벤트 로그 |
| 이미지 첨부 평균 시간 | ≤ 5초 | 클라이언트 perf 측정 |

### 11.2 Phase 4 (LLM 통합) 목표 — 별도 의사결정 후 적용

| 지표 | 목표 |
|------|------|
| Word → DocumentJSON 자동 변환 성공률 | ≥ 90% |
| LLM 작성 보조 채택률(초안 → 게시) | ≥ 50% |
| 임베딩 기반 관련 문서 추천 정확도 | NDCG@5 ≥ 0.7 |

---

## 12. 다음 단계 (Action Items)

1. **본 계획서 검토 및 승인**
2. **Sprint 0 착수**: 모노레포 골격, **Apptainer 인프라**(`.def` + 스크립트), 스키마 SSOT, CI matrix
3. **JSON 스키마 v1.0 확정**: 시드 문서 5건으로 검증, TS·Python 자동 생성
4. **Sprint 1~6 MVP 구현**: 조직 → Reader → WikiLink → Editor → 이미지 → 위젯/검색/인증

---

> 본 계획은 살아있는 문서입니다. Phase 진행 중 발견되는 사항은 PR 단위로 본 문서에 반영합니다.
> 다음 산출물 후보: `docs/02-design/data-model.md`, `docs/02-design/wiki-link-grammar.md`
