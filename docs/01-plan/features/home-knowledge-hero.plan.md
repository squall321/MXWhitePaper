# Home Hero 재설계 + 이종 지식그래프 Planning Document

> **Summary**: Home 의 hero 가 단순 "최근 추가 12건" 이라 임팩트가 없다. 3737 문서 +
> 5098 doc-tag + (link 회복 후) 수천 wiki link 라는 데이터 자산을 *지식의 영역 지도*
> 로 보여주는 hero 로 교체한다. 4개 super-domain 타일 → 클릭 시 *이종(heterogeneous)
> 지식그래프* (doc + tag 노드, 3 종류 엣지) 로 확장. 거미줄은 보편 3 기법
> (focus+context / degree filter / soft cluster) 으로 정리한다.
>
> **Project**: MX White Paper
> **Feature**: home-knowledge-hero
> **Version**: 0.1.0
> **Date**: 2026-05-20
> **Status**: Draft

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 현재 hero = "최근 업데이트된 문서 12건" 단순 리스트. 460+ Namu Archive 기술 문서, 5098 doc-tag, 향후 회복될 수천 wiki link 라는 *지식 자산* 이 첫 화면에 전혀 노출되지 않는다. 그래프는 `/graph` 별도 페이지에 있고 wiki link 만 다뤄 tag 차원이 빠져있다. |
| **Solution** | Hero 를 4개 super-domain 타일 (📱 Mobile / 💻 Software / 🔧 Hardware / 📡 Telecom) 로 교체. 타일 클릭 → `/graph?domain=mobile` 로 진입해 *이종 그래프* (doc 원 + tag 사각형, wiki link/소속/공동출현 3 엣지) 를 보여줌. 거미줄은 hover focus + degree slider + tag-centroid soft cluster 로 정리. |
| **Function/UX Effect** | 첫 화면에서 "이 위키엔 무엇이 있는가" 가 4타일로 즉시 인지된다. 타일 클릭 → 그 도메인의 문서·tag 가 별자리로 펼쳐지고, tag 클릭 시 같은 tag doc 들이 자석처럼 뭉친다 (soft cluster). hover 로 1-hop 강조, slider 로 degree N+ 만 보기. 모바일은 list view fallback. |
| **Core Value** | hero 자체가 *지식의 지도*. 사용자가 "어디서 시작할지" 와 "이 위키의 밀도" 를 동시에 본다. tag 데이터만으로도 (wiki link 가 빈약한 import 진행 중에도) 풍부한 그래프 형성 — 데이터 자가확장의 *시각적 증거*. |

---

## 1. Overview

### 1.1 Purpose

본 사이클의 목적은 두 개의 *결합된* 문제를 해결하는 것이다.

1. **Hero 임팩트 부재** — Home 의 hero 가 활동 로그 (최근 12건) 일 뿐, 위키의 *정체성과 구조* 를 보여주지 못한다.
2. **그래프의 의미 단순함** — 현재 `/graph` 는 wiki link (`[[A]]`) 만 다룬다. tag 정보는 fetch 도 안 한다. import 직후 link 가 적으면 그래프가 빈약해 보인다.

해결책은 *둘을 합친 흐름* 이다: hero 의 도메인 타일이 그래프 화면으로 자연스럽게 확장되며, 그래프는 tag 와 wiki link 를 *동시에* 표현한다.

### 1.2 Out of Scope

- **Hero 의 다른 콘텐츠** (오늘의 키워드, 추천 문서, KPI 카드 등) — 본 사이클은 *도메인 타일* 만
- **community detection (Louvain) 자동 클러스터링** — wiki link 가 회복된 후 별도 사이클
- **tag synonym / 다국어 매핑** (`mobile` ↔ `모바일`) — 별도 사이클
- **edge bundling** (인접 edge 곡선 묶기) — 비용 대비 가치 낮음, 보류
- **WebGL 그래프 (cosmos/sigma)** — 노드 수가 d3 한계를 넘으면 검토 (cycle 2+)
- **tag 노드 페이지** (`/tags/<name>` URL) — graph filter 만 본 사이클 범위
- **3-level 줌 (sunburst, hierarchical)** — tag hierarchy 데이터 없음, 별도 사이클

### 1.3 Decisions (사용자 확정 사항)

1. **이종 그래프 채택**: 노드 종류 2 (doc, tag), 엣지 종류 3 (wiki link / doc-tag 소속 / tag-tag 공동출현)
2. **시각 분리 — 모양과 색**: doc = 원/타원 (기존), tag = 둥근 사각형. doc 색은 depth 기반 (기존), tag 색은 super-domain 별 fixed 팔레트
3. **클릭 동작 분기**: doc 좌클릭 = 페이지 이동 (기존), tag 좌클릭 = cluster 토글 (페이지 이동 X), 둘 다 *우클릭* = 컨텍스트 메뉴
4. **거미줄 완화 = 보편 3 기법**: focus+context (hover 시 1-hop 강조), degree filter slider, tag-centroid soft cluster (strength 0.15)
5. **도메인 = 4 super-domain** (방향 2 채택). 기존 8 tag 를 그 안에 OR 매핑
6. **타일 클릭 시 OR 결합**: super-domain 의 *모든* 하위 tag 가 결합되어 그래프에 노출
7. **모바일 fallback**: lg breakpoint 미만 = 그래프 대신 super-domain 별 문서 list view
8. **백엔드 = 기존 endpoint 확장** (별도 endpoint 신설 안 함). `/api/v1/links/graph?include_tags=1&domain=mobile` 식 옵트인

### 1.4 Super-Domain 매핑 (확정)

| Super-Domain | Emoji | 하위 tag | 합계 문서 수 |
|---|---|---|---:|
| Mobile | 📱 | `mobile` | 86 |
| Software | 💻 | `software`, `programming`, `architecture` | 219 |
| Hardware | 🔧 | `semiconductor`, `electronics`, `display` | 109 |
| Telecom | 📡 | `telecom` | 43 |

합계 457 docs — 현재 namu-archive (460) 의 99% 커버.

**노이즈 tag (그래프/타일 모두 제외)**: `템플릿`, `미팅`, `faq`, `intro`, `sample`, `namu-archive`, `imported-bulk`

확장성: 새 tag 들어오면 코드 한 군데 (`SUPER_DOMAINS` 매핑) 만 갱신.

---

## 2. Architecture

### 2.1 Sprint 분할 (5)

본 사이클은 **5 sprint** 로 분할한다. 각 sprint 끝나면 사용자 확인 후 다음.

| Sprint | 범위 | 산출물 | 예상 시간 |
|---|---|---|---:|
| **S1** | 데이터 + 백엔드 | `SUPER_DOMAINS` 상수, `/links/graph` 확장, tag 노드/엣지 query | 반나절 |
| **S2** | Hero 도메인 타일 | Home 페이지 4 타일, 클릭 → `/graph?domain=X` | 반나절 |
| **S3** | 그래프 통합 시각 | tag 노드 (사각형), doc-tag 엣지 (점선), tag-tag 엣지 (무지개) | 반나절 |
| **S4** | cluster + focus + slider | force-cluster, hover focus, degree slider | 반나절 |
| **S5** | polish | 모바일 list fallback, 우클릭 메뉴 확장, 성능 튜닝 | 반나절 |

**Cycle 1 (이번 사이클) = S1 + S2 까지**. 도메인 타일이 *눈에 보이는* 진척. S3 이후는 별도 사이클로 검토.

### 2.2 백엔드 API 확장

기존 endpoint `/api/v1/links/graph` 에 query param 추가. 기본 동작 변경 없음 (backward compat).

```
GET /api/v1/links/graph?root=<slug>&depth=<N>
  → 기존 동작 (doc 노드 + wiki link edge 만)

GET /api/v1/links/graph?domain=mobile&include_tags=1
  → 신규: super-domain 의 하위 tag 가 가진 doc + 그 tag 들 + 엣지 3종
```

응답 schema 확장:

```json
{
  "data": {
    "nodes": [
      { "kind": "doc", "slug": "android", "title": "안드로이드", "status": "published", "group": null },
      { "kind": "tag", "name": "mobile", "doc_count": 86, "super_domain": "mobile" }
    ],
    "edges": [
      { "kind": "wiki", "source": "android", "target": "ios", "count": 3 },
      { "kind": "doc_tag", "source": "android", "target": "tag:mobile" },
      { "kind": "tag_cooc", "source": "tag:mobile", "target": "tag:software", "weight": 12 }
    ]
  }
}
```

- `nodes[].kind`: `"doc" | "tag"` — 신규 필드
- `edges[].kind`: `"wiki" | "doc_tag" | "tag_cooc"` — 신규 필드
- tag 노드 slug 는 `"tag:<name>"` 로 namespace 분리 (doc slug 와 충돌 방지)
- 기존 client (`include_tags` 미지정) 는 `kind` 필드 무시 가능 — backward compat

### 2.3 프론트엔드 — 데이터 모델

`SimNode` 확장:

```ts
type SimNodeKind = 'doc' | 'tag'
interface SimNode extends SimulationNodeDatum {
  kind: SimNodeKind
  slug: string           // doc 이면 slug, tag 이면 "tag:<name>"
  title: string
  // doc 전용
  status?: string
  degree?: number
  isMissing?: boolean
  depth?: number
  // tag 전용
  docCount?: number
  superDomain?: string
}

type SimLinkKind = 'wiki' | 'doc_tag' | 'tag_cooc'
interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: SimLinkKind
  weight: number
}
```

### 2.4 시각 언어

| | doc 노드 | tag 노드 |
|---|---|---|
| 모양 | 원/타원 (기존) | 둥근 사각형 (rx=14, 모서리 반경 6) |
| 크기 | depth 기반 (기존) | docCount log-scale (sqrt(count) * 6 + 30) |
| 색 | depth 기반 (기존) | super-domain palette |
| 레이블 | 안에 (기존) | 안에 + "#" prefix |

**Super-domain palette** (CSS var):

```css
--graph-domain-mobile:   #3b82f6;  /* 파랑 */
--graph-domain-software: #10b981;  /* 초록 */
--graph-domain-hardware: #f59e0b;  /* 주황 */
--graph-domain-telecom:  #ec4899;  /* 분홍 */
```

| 엣지 | 스타일 |
|---|---|
| wiki | 실선, 굵기 1+min(count,5), 70% 불투명, 회색 #94a3b8 (기존) |
| doc_tag | **점선** (stroke-dasharray "2 3"), 굵기 1px, 30% 불투명 |
| tag_cooc | 실선, 굵기 weight/5, 50% 불투명, super-domain 색 *그라디언트* (두 tag 의 색 보간) |

### 2.5 인터랙션 (Cycle 1 = S2 까지)

S2 까지의 인터랙션은 *Home 타일* 만 신규. 그래프 자체는 기존 `/graph` 동작 (S3 부터 확장).

| 화면 | 액션 | 동작 |
|---|---|---|
| Home hero | 타일 클릭 | `/graph?domain=<id>` 이동 |
| Home hero | 타일 hover | 그 super-domain 의 대표 문서 3개 tooltip preview |
| `/graph?domain=X` | (cycle 1 에선 기존 그래프와 동일) | S3 부터 이종 그래프 |

### 2.6 인터랙션 (S3 이후, 본 plan 의 *전체* 흐름)

| 액션 | 동작 |
|---|---|
| doc 좌클릭 | `/docs/<slug>` 이동 (기존) |
| tag 좌클릭 | 그 tag 의 cluster strength + 0.15. 같은 tag doc 들이 그 tag 노드로 끌림 |
| tag 더블클릭 | `/graph?tag=<name>` 으로 그 tag 를 root 로 재진입 |
| 노드 우클릭 | context menu (페이지 / 이 노드를 루트로 / 이 tag 만 보기 / 이 tag 빼기) |
| 노드 hover | focus mode — 1-hop 만 opacity 1.0, 나머지 0.15 (200ms 트랜지션) |
| 빈 곳 클릭 | focus 해제, cluster 토글 초기화 |
| Edge type chip | wiki / doc_tag / tag_cooc 각각 on/off |
| Degree slider | "최소 연결 ≥ N" 으로 노드 filter (opacity transition, simulation 재시작 안 함) |

---

## 3. Data Model & API

### 3.1 신규 코드 — `SUPER_DOMAINS` 상수

위치: `packages/shared/src/super-domains.ts` (FE/BE 공통 import)

```ts
export interface SuperDomain {
  id: string
  label: string
  emoji: string
  tags: string[]
  paletteVar: string
}

export const SUPER_DOMAINS: SuperDomain[] = [
  { id: 'mobile',   label: 'Mobile',   emoji: '📱',
    tags: ['mobile'],                                  paletteVar: '--graph-domain-mobile' },
  { id: 'software', label: 'Software', emoji: '💻',
    tags: ['software', 'programming', 'architecture'], paletteVar: '--graph-domain-software' },
  { id: 'hardware', label: 'Hardware', emoji: '🔧',
    tags: ['semiconductor', 'electronics', 'display'], paletteVar: '--graph-domain-hardware' },
  { id: 'telecom',  label: 'Telecom',  emoji: '📡',
    tags: ['telecom'],                                 paletteVar: '--graph-domain-telecom' },
]

export const NOISE_TAGS = new Set([
  '템플릿', '미팅', 'faq', 'intro', 'sample', 'namu-archive', 'imported-bulk',
])
```

### 3.2 백엔드 — 신규 query (S1)

`apps/api/app/services/links_graph.py` 에 함수 추가:

```python
def domain_subgraph(
    super_domain_id: str,
    *,
    include_tags: bool = True,
    include_tag_cooc: bool = True,
) -> GraphPayload:
    """super-domain 의 하위 tag 가 가진 문서들 + 그 tag 들 + 엣지 3종 반환."""
    domain = SUPER_DOMAINS[super_domain_id]
    tag_names = domain['tags']

    # 1) 그 tag 들이 붙은 doc
    docs = SELECT d.slug, d.title, d.status FROM documents d
           JOIN document_tags dt ON dt.document_id=d.id
           JOIN tags t ON t.id=dt.tag_id
           WHERE t.name = ANY(tag_names) AND d.status='published'

    # 2) wiki link edges (doc 끼리)
    wiki_edges = SELECT source_slug, target_slug, count FROM links
                 WHERE source_slug IN (...) AND target_slug IN (...)

    # 3) doc-tag edges (소속)
    if include_tags:
        doc_tag_edges = SELECT d.slug, t.name FROM ...

    # 4) tag-tag co-occurrence (이 도메인의 tag + 다른 도메인의 tag, weight >= 3)
    if include_tag_cooc:
        tag_cooc_edges = SELECT a.name, b.name, COUNT(*) FROM ...
```

### 3.3 백엔드 — 라우터 확장

`apps/api/app/routers/links.py`:

```python
@router.get("/graph")
async def graph(
    root: str | None = None,
    depth: int = Query(2, ge=1, le=4),
    domain: str | None = None,       # 신규
    include_tags: bool = False,      # 신규 (domain 지정 시 default True)
    include_tag_cooc: bool = True,   # 신규
):
    if domain:
        return domain_subgraph(domain, include_tags=True, include_tag_cooc=include_tag_cooc)
    # 기존 동작 (wiki link 만)
    return wiki_subgraph(root, depth)
```

### 3.4 프론트엔드 — Hero 타일 컴포넌트

위치: `apps/web/src/features/home/components/DomainTiles.tsx`

```tsx
export function DomainTiles() {
  const { data: counts } = useQuery(['domain-counts'], fetchDomainCounts)
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {SUPER_DOMAINS.map((d) => (
        <li key={d.id}>
          <Link to={`/graph?domain=${d.id}`} className="...palette...">
            <span className="text-3xl">{d.emoji}</span>
            <h3>{d.label}</h3>
            <p className="text-xs">{counts?.[d.id] ?? '...'} docs</p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

도메인 카운트 endpoint 신규: `GET /api/v1/domains/counts` → `{ mobile: 86, software: 219, hardware: 109, telecom: 43 }`

### 3.5 프론트엔드 — Home.tsx 통합

```tsx
return (
  <section className="space-y-8">
    <DomainTiles />              {/* 신규 — 최상단 */}
    <SearchHint />               {/* 기존 헤더 자리에 검색 힌트 한 줄 */}
    <RecentSection />            {/* 기존 "최근 추가" — 아래로 demote */}
  </section>
)
```

기존 "최근 업데이트 12건" 은 *제거하지 않고 아래로 이동*. hero 의 역할만 도메인 타일로 교체.

---

## 4. Verification

### 4.1 Cycle 1 (S1+S2) 검증

| # | 검증 항목 | 방법 |
|---|---|---|
| V1 | `SUPER_DOMAINS` 상수 FE/BE 공유 import 동작 | pnpm typecheck + apptainer exec python import |
| V2 | `GET /api/v1/domains/counts` 응답 = `{mobile:86, software:219, hardware:109, telecom:43}` | curl |
| V3 | `GET /api/v1/links/graph?domain=mobile&include_tags=1` 노드/엣지 count > 0 | curl + jq |
| V4 | Home 에 4 타일 렌더, 카운트 표시 | 브라우저 수동 + vitest snapshot |
| V5 | 타일 클릭 → `/graph?domain=mobile` 라우팅 | vitest user event |
| V6 | 기존 `/api/v1/links/graph?root=android&depth=2` backward compat | vitest + curl |
| V7 | 모바일 (lg 미만) 에서 타일 2 columns | brower (Chrome devtools) |
| V8 | NOISE_TAGS 차단 — `templates` 가 어떤 endpoint 에도 안 나옴 | curl + grep |

### 4.2 S3 이후 검증 (참고)

| 항목 | 방법 |
|---|---|
| tag 노드 사각형 렌더, super-domain 색 | 시각 (브라우저) |
| 3 종류 엣지 토글 | 시각 + vitest event |
| hover focus | 시각 (200ms 트랜지션) |
| degree slider | 시각 + vitest |
| force cluster strength | 시각 (mobile tag 클릭 → 같은 tag doc 들 모임) |
| 모바일 list fallback | 시각 (Chrome devtools mobile mode) |

---

## 5. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|:---:|---|
| 노이즈 tag 가 검출되지 않은 새 형태로 들어옴 (예: `template-v2`) | M | `NOISE_TAGS` set 외에 *패턴* (`/^template/`, `/^sample/`) 도 차단. 신규 import 후 top tag 리스트 검토 룰 추가 |
| Namu_Archive import 진행 중 — 카운트가 실시간 변동 | M | `/domains/counts` 응답에 `as_of: 2026-05-20T10:30:00Z` 타임스탬프 포함. cache 5분 |
| tag-tag co-occurrence 가 노이즈 tag 까지 포함하면 그래프 폭발 | H | SQL `HAVING COUNT(*) >= 3` + `WHERE t.name NOT IN (NOISE_TAGS)` 양쪽 적용 |
| force simulation 노드 70+ 에서 모바일 GPU 끊김 | M | `sim.stop()` after 3s (Obsidian 식) + alphaDecay 0.05 → 0.08 |
| S3 이후 BE 응답 schema 변경으로 기존 `/graph` client 깨짐 | H | `kind` 필드 *없으면* default `"doc"` 으로 해석 — backward compat 명시 |
| 사용자가 super-domain 매핑 만족 못함 (예: AI 별도 도메인 원함) | L | `SUPER_DOMAINS` 코드 한 곳 — 매핑 변경 5분. 사용자 confirm 후 진행 |
| 모바일에서 graph viewport 안 잡힘 | M | lg breakpoint 미만 = `<DomainTileList />` 라는 별도 list view 컴포넌트 |

---

## 6. Dependencies

- 기존: `d3-force`, `d3-zoom`, `d3-selection`, `@tanstack/react-query`
- 신규: 없음 (vendored 만)
- 백엔드: `asyncpg` 기존 사용

추가 npm/pip 패키지 0.

---

## 7. Acceptance Criteria

### Cycle 1 (S1+S2) — 본 사이클 완료 조건

- [ ] `packages/shared/src/super-domains.ts` 신규, FE/BE 모두 import 가능
- [ ] `GET /api/v1/domains/counts` 신규 endpoint, 4 도메인 카운트 반환
- [ ] `GET /api/v1/links/graph?domain=X` 확장 동작 (BE 만 — FE 는 S3 부터 활용)
- [ ] `apps/web/src/features/home/components/DomainTiles.tsx` 신규
- [ ] Home.tsx 가 DomainTiles 를 hero 자리에 사용
- [ ] 모바일 (sm) 2 columns / desktop (sm+) 4 columns
- [ ] NOISE_TAGS 가 어떤 endpoint 에도 노출 안 됨
- [ ] tsc + vitest 모두 통과
- [ ] 기존 `/graph?root=android` backward compat 유지

### S3–S5 (다음 사이클) — 참고만, 본 plan 의 acceptance 아님

- [ ] tag 노드 사각형 + super-domain 색
- [ ] 3 엣지 종류 토글
- [ ] hover focus / degree slider / soft cluster
- [ ] 모바일 list fallback
- [ ] 우클릭 메뉴 확장

---

## 8. Open Questions

1. 도메인 카운트 cache TTL 5분이 적절한가? Namu_Archive import 중엔 더 짧게 (1분) 가 나을지?
2. 타일 hover preview (3 대표 문서) — degree 상위 vs view count 상위? (view count 데이터 신뢰성 확인 필요)
3. tag 노드 클릭 시 force cluster strength 0.15 가 default — 사용자 조정 가능하게 할지 (UI complexity 늘어남)?
4. Edge type chip — 3개 다 보이는 게 default vs wiki+doc_tag 만 default (tag_cooc 는 power user 전용)?

위 4개는 *S3 시작 전* 사용자에 재확인.
