# Home Hero 재설계 + 이종 지식그래프 Planning Document

> **Summary**: Home 의 hero 가 단순 "최근 추가 12건" 이라 임팩트가 없다. 3737 문서 +
> 5098 doc-tag + (link 회복 후) 수천 wiki link 라는 데이터 자산을 *지식의 영역 지도*
> 로 보여주는 hero 로 교체한다. 4개 super-domain 타일 → 클릭 시 *이종(heterogeneous)
> 지식그래프* (doc + tag 노드, 3 종류 엣지) 로 확장. 거미줄은 보편 3 기법
> (focus+context / degree filter / soft cluster) 으로 정리한다.
>
> **Project**: MX White Paper
> **Feature**: home-knowledge-hero
> **Version**: 0.3.0
> **Date**: 2026-05-20 (v0.3 — 성능/UX 보강 3건 + Trend 섹션 추가)
> **Status**: Draft

## Changelog
- v0.3 (2026-05-20): 성능/UX 평가 라운드 반영
  - 보강 1 — BE 인덱스 사전 확인 (`document_tags`, `links`) — acceptance 필수
  - 보강 2 — 타일 hover 시 `/links/graph?domain=X` prefetch (체감 1초 → 즉시)
  - 보강 3 — Hero 옆 한 줄 안내 "상위 50 + 도메인 태그" (사용자 기대 정렬)
  - in-degree materialized view 또는 cache 컬럼 도입
  - **신규**: Trend 섹션 (도메인별 7일 문서 증가 sparkline, TTL 15분)
- v0.2 (2026-05-20): 점검 라운드 반영
  - C2 — doc-tag edge default OFF + tag 클릭 시만 on-demand 표시 (그래프 폭발 방지)
  - C3 — `/api/v1/domains/counts` → `/api/v1/home/hero` 로 명칭/응답 schema 보강 (top_docs 포함)
  - I1 — V2 검증 기준 하드코드 → 범위 (`mobile ≥ 50` 등) 로 완화 (import 진행 중 변동성 대응)
  - I5 — S2 tile click = `/graph?domain=X` (BE 확장 S2 에 합류), FE 는 Cycle 1 에서 tag 노드 무시
  - 추가 default 확정: cluster 0.15 / chip wiki+doc_tag ON, tag_cooc OFF / i18n ko+en / 빈 도메인 hidden / cache TTL 5분 / top_docs 기준 = in-degree 상위 / domain+root 동시 적용

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
9. **doc-tag edge default OFF + tag 클릭 시만 on-demand 표시** (v0.2 신규 — C2 대응). 200+ doc 도메인에서 600+ 점선 폭발 차단
10. **Edge chip default**: `wiki` ON, `doc_tag` ON (tag 클릭 시에만 그려짐), `tag_cooc` **OFF** — power user 가 토글로 켬
11. **Cluster strength default = 0.15** (link 우선, cluster 는 2차 정렬). 슬라이더 UI 는 polish 단계 (S5) 에 검토
12. **Hero i18n**: ko/en 두 언어. `home.domain.<id>` key 로 기존 i18n 인프라 사용
13. **빈 도메인 표시**: count 0 인 타일은 *숨김*. 타일 개수 동적 1–4
14. **`/api/v1/home/hero` 캐시 = TTL 5분, p95 목표 < 200ms** (Q1+N4 통합)
15. **대표 문서 (top_docs) 선정 기준 = in-degree 상위 3개** (Q2). namu-archive import 직후 view 카운트 미흡 — degree 가 의미 있는 신호
16. **`/graph?domain=X&root=Y` 동시 지정 = 동시 적용** (I4). 그 도메인의 tag 가진 doc 들 중에서 root 의 BFS depth 검색 — 가장 강력
17. **(v0.3) BE 인덱스 사전 확인** — S1 첫 작업으로 `EXPLAIN ANALYZE` 실행. 인덱스 미존재 시 `CREATE INDEX` 먼저:
    - `idx_document_tags_tag_id ON document_tags(tag_id)` — super-domain → doc 조회
    - `idx_document_tags_doc_id ON document_tags(document_id)` — doc → tag 역조회
    - `idx_links_source_slug ON links(source_slug)` — wiki edge 조회
    - `idx_links_target_slug ON links(target_slug)` — in-degree 계산
18. **(v0.3) in-degree cache** — `documents` 테이블에 `indegree integer DEFAULT 0` 컬럼 추가. `update_links_for_document()` 가 갱신할 때 *source 와 target* 양쪽 doc 의 indegree 도 함께 갱신. matview 보다 가벼움 (REFRESH 필요 없음)
19. **(v0.3) 타일 hover prefetch** — react-query 의 `queryClient.prefetchQuery(['graph', domain])` 를 mouseenter 시 호출. 200ms debounce 로 무분별한 prefetch 방지
20. **(v0.3) Hero subtitle 안내** — 타일 우측에 작은 텍스트 "상위 50개 문서 + 도메인 태그를 그래프로 표시. 검색은 ⌘K". 사용자 기대 misalignment 방지
21. **(v0.3) Trend 섹션** — Hero 아래에 7일 문서 증가 sparkline. 각 도메인 타일 *안에* mini sparkline (40×20px) 으로 통합 — 별도 섹션 X. cache TTL 15분

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
| **S1** | 데이터 + 백엔드 | `SUPER_DOMAINS` 상수, BE 인덱스 사전 확인+생성, `indegree` 컬럼 추가, `/links/graph` 확장, `/home/hero` 신규 (trend 7d 포함) | 0.6 일 |
| **S2** | Hero 도메인 타일 + Trend | Home 페이지 4 타일, 타일 안 sparkline (40×20), hover prefetch, 클릭 → `/graph?domain=X`, subtitle 안내 | 0.6 일 |
| **S3** | 그래프 통합 시각 | tag 노드 (사각형), doc-tag 엣지 (점선, 클릭 on-demand), tag-tag 엣지 (무지개) | 반나절 |
| **S4** | cluster + focus + slider | force-cluster, hover focus, degree slider | 반나절 |
| **S5** | polish | 모바일 list fallback, 우클릭 메뉴 확장, 성능 튜닝 | 반나절 |

**Cycle 1 (이번 사이클) = S1 + S2 까지**. 도메인 타일 + 트렌드 sparkline 까지가 *눈에 보이는* 진척. S3 이후는 별도 사이클로 검토.

> **v0.3 변경**: Trend (sparkline) 가 별도 sprint 가 아닌 S2 의 도메인 타일 *안에* 통합됨. 별도 섹션 추가 대신 타일 한 컴포넌트로 끝 — UI 일관성 + 구현 비용 절약.

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

### 3.4 프론트엔드 — Hero 타일 컴포넌트 (v0.3 — Sparkline + prefetch + subtitle)

위치: `apps/web/src/features/home/components/DomainTiles.tsx`

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchHomeHero, fetchGraph } from '@/features/home/api'
import { SUPER_DOMAINS } from '@mx/shared/super-domains'
import { Sparkline } from './Sparkline'
import { useT } from '@/lib/i18n'

export function DomainTiles() {
  const t = useT()
  const { data } = useQuery({ queryKey: ['home-hero'], queryFn: fetchHomeHero, staleTime: 5 * 60_000 })
  const qc = useQueryClient()

  // v0.3: 타일 hover 시 그래프 prefetch (체감 1초 → 즉시).
  // 200ms debounce 는 react-query staleTime 으로 대체 — 같은 키 60s 캐시.
  const prefetchGraph = (domainId: string) => {
    qc.prefetchQuery({
      queryKey: ['graph', { domain: domainId }],
      queryFn: () => fetchGraph({ domain: domainId, include_tags: true }),
      staleTime: 60_000,
    })
  }

  if (!data?.domains) return null

  return (
    <section aria-label={t('home.domain.sectionLabel')}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {data.domains.map((d) => {
          const meta = SUPER_DOMAINS.find((s) => s.id === d.id)!
          const delta = d.doc_count - d.doc_count_7d_ago
          return (
            <Link
              key={d.id}
              to={`/graph?domain=${d.id}`}
              onMouseEnter={() => prefetchGraph(d.id)}
              onFocus={() => prefetchGraph(d.id)}
              className={`tile tile-${d.id}`}
            >
              <header className="flex items-center justify-between">
                <span className="text-3xl" aria-hidden>{meta.emoji}</span>
                {delta > 0 && (
                  <span className="text-xs text-green-600" aria-label={t('home.trend.deltaLabel', { delta })}>
                    ↗ +{delta}
                  </span>
                )}
              </header>
              <h3 className="mt-1 text-sm font-semibold">{t(`home.domain.${d.id}`)}</h3>
              <p className="text-xs text-gray-500">{d.doc_count} docs</p>
              <Sparkline data={d.trend_7d} width={80} height={20}
                ariaLabel={t('home.trend.sparkLabel', { count: d.doc_count })} />
              <ul className="mt-2 space-y-0.5 text-xs">
                {d.top_docs.map((doc) => (
                  <li key={doc.slug} className="truncate">
                    <Link to={`/docs/${encodeURIComponent(doc.slug)}`} onClick={(e) => e.stopPropagation()}>
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Link>
          )
        })}
      </div>
      {/* v0.3 — 사용자 기대 정렬 (보강 3): 그래프 노출 범위 명시 */}
      <p className="mt-2 text-[11px] text-gray-500">{t('home.hero.scopeHint')}</p>
    </section>
  )
}
```

#### Sparkline 컴포넌트 (신규, 의존성 0)

위치: `apps/web/src/features/home/components/Sparkline.tsx`

```tsx
interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  ariaLabel: string
}

export function Sparkline({ data, width = 80, height = 20, ariaLabel }: SparklineProps) {
  if (!data?.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = Math.max(max - min, 1)
  const dx = width / Math.max(data.length - 1, 1)
  const y = (v: number) => height - ((v - min) / range) * height
  const path = data
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * dx).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

- 의존성 0 (d3 안 씀 — sparkline 한 줄이라 직접 계산)
- aria-label 로 스크린리더 접근성
- `currentColor` 사용 → 부모의 도메인 팔레트 색 자동 상속

#### i18n keys (신규)

`apps/web/src/lib/i18n/ko.ts` / `en.ts`:

```ts
// ko
'home.domain.sectionLabel': '도메인별 지식 영역',
'home.domain.mobile': '모바일',
'home.domain.software': '소프트웨어',
'home.domain.hardware': '하드웨어',
'home.domain.telecom': '통신',
'home.trend.sparkLabel': '최근 7일 누적 — 현재 {{count}}건',
'home.trend.deltaLabel': '이번 주 +{{delta}}건',
'home.hero.scopeHint': '그래프는 연결도 상위 50개 문서 + 도메인 태그를 표시합니다. 전체 검색은 ⌘K.',

// en (대응)
'home.domain.sectionLabel': 'Knowledge by Domain',
'home.domain.mobile': 'Mobile',
'home.domain.software': 'Software',
'home.domain.hardware': 'Hardware',
'home.domain.telecom': 'Telecom',
'home.trend.sparkLabel': '7-day cumulative — currently {{count}} docs',
'home.trend.deltaLabel': '+{{delta}} this week',
'home.hero.scopeHint': 'Graph shows top 50 docs by connectivity + domain tags. Full search: ⌘K.',
```

도메인 hero endpoint 신규 (v0.2 명칭 변경): `GET /api/v1/home/hero`

응답 schema (v0.3 — `trend_7d` 추가):
```json
{
  "data": {
    "as_of": "2026-05-20T10:30:00Z",
    "domains": [
      {
        "id": "mobile",
        "doc_count": 86,
        "doc_count_7d_ago": 42,                       // 7일 전 카운트 (델타 계산용)
        "trend_7d": [42, 48, 55, 60, 68, 75, 86],     // 7일치 일별 누적 카운트 (sparkline 데이터)
        "top_docs": [
          { "slug": "안드로이드", "title": "안드로이드", "indegree": 28 },
          { "slug": "갤럭시",   "title": "갤럭시",   "indegree": 21 },
          { "slug": "ios",      "title": "iOS",      "indegree": 17 }
        ]
      },
      { "id": "software", "doc_count": 219, "trend_7d": [...], "top_docs": [...] },
      { "id": "hardware", "doc_count": 109, "trend_7d": [...], "top_docs": [...] },
      { "id": "telecom",  "doc_count": 43,  "trend_7d": [...], "top_docs": [...] }
    ]
  }
}
```

- **빈 도메인 (`doc_count === 0`)** 은 응답에서 *제외* — FE 가 렌더할 도메인만 받음 (I3 default)
- **`as_of`** 는 cache 갱신 시각. import 진행 중 사용자 디버그용
- **`top_docs`** = `indegree` 상위 3개 (v0.3 §18 의 cache 컬럼 사용). links 빈약 시 fallback = `updated_at desc`
- **`trend_7d`** = `array[7]` 일별 *누적 도서 카운트* (오래된 날 → 오늘). 누적이므로 단조 증가. sparkline 이 우상향이면 성장. import 멈추면 평탄
- **`doc_count_7d_ago`** = `trend_7d[0]` 의 alias. FE 에서 "이번 주 +44" 같은 델타 표시용
- **Cache TTL = 5분** (hero 메인), **Trend TTL = 15분** (별도 cache key `home_hero_trend`). hero 응답에 trend 가 포함되므로 *효과적으로* 짧은 TTL 가 적용 — 즉 5분. trend 만 따로 호출하면 15분

### 3.4-b (v0.3) BE 인덱스 + `indegree` 컬럼 + Trend 쿼리

#### Migration (S1 첫 작업)

```sql
-- 1) 인덱스 — EXPLAIN ANALYZE 후 없으면 생성
CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id    ON document_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_doc_id    ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_links_source_slug       ON links(source_slug);
CREATE INDEX IF NOT EXISTS idx_links_target_slug       ON links(target_slug);
CREATE INDEX IF NOT EXISTS idx_documents_created_at    ON documents(created_at);  -- trend 일별 집계용

-- 2) indegree cache 컬럼
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indegree integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_documents_indegree      ON documents(indegree DESC);  -- top_docs 정렬용

-- 3) 초기 백필 (한 번)
UPDATE documents d
SET indegree = (SELECT COUNT(*) FROM links l WHERE l.target_slug = d.slug);
```

#### update_links_for_document() 갱신 (S1)

기존 함수가 source doc 의 links 를 다시 쓸 때, *영향 받는 target doc 들* 의 `indegree` 도 함께 갱신.

```python
def update_links_for_document(slug, body_text):
    old_targets = SELECT target_slug FROM links WHERE source_slug=slug
    new_targets = parse_wiki_links(body_text)

    # 기존 link 제거 + 새 link 삽입
    DELETE FROM links WHERE source_slug=slug
    INSERT INTO links (source_slug, target_slug, count) VALUES ...

    # 영향 받는 모든 target 의 indegree 재계산
    touched = old_targets | new_targets
    UPDATE documents SET indegree = (
      SELECT COUNT(*) FROM links WHERE target_slug = documents.slug
    ) WHERE slug = ANY(touched)
```

#### Trend SQL

```sql
-- 도메인별 7일치 일별 누적 (오래된 날 → 오늘)
WITH days AS (
  SELECT generate_series(
    current_date - interval '6 days',
    current_date,
    interval '1 day'
  )::date AS day
),
domain_docs AS (
  SELECT d.id, d.created_at::date AS created_day, t.name AS tag_name
  FROM documents d
  JOIN document_tags dt ON dt.document_id = d.id
  JOIN tags t            ON t.id = dt.tag_id
  WHERE t.name = ANY(:tag_names)   -- super-domain 의 tag 들
    AND d.status = 'published'
)
SELECT
  d.day,
  COUNT(dd.id) FILTER (WHERE dd.created_day <= d.day) AS cumulative_count
FROM days d
LEFT JOIN domain_docs dd ON true
GROUP BY d.day
ORDER BY d.day;
```

응답에 `trend_7d` 배열로 직렬화. cache TTL 15분 (별도 key).

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
| V2 | `GET /api/v1/home/hero` 응답에 4 domain (mobile/software/hardware/telecom), 각 doc_count >= 30 (import 진행 중 변동 허용), top_docs.length === 3 (또는 doc_count 가 < 3 이면 그 수) | curl + jq |
| V3 | `GET /api/v1/links/graph?domain=mobile&include_tags=1` 노드 (doc+tag) count > 0, 응답 < 300ms | curl + jq + time |
| V4 | Home 에 4 타일 렌더, 카운트 표시 | 브라우저 수동 + vitest snapshot |
| V5 | 타일 클릭 → `/graph?domain=mobile` 라우팅 | vitest user event |
| V6 | 기존 `/api/v1/links/graph?root=android&depth=2` backward compat | vitest + curl |
| V7 | 모바일 (lg 미만) 에서 타일 2 columns | brower (Chrome devtools) |
| V8 | NOISE_TAGS 차단 — `templates` 가 어떤 endpoint 에도 안 나옴 | curl + grep |
| V9 (v0.3) | BE 인덱스 5개 존재 (`idx_document_tags_tag_id` 등) | `\di` in psql |
| V10 (v0.3) | `documents.indegree` 컬럼 + 초기 백필 — `SELECT MAX(indegree) FROM documents > 0` | psql |
| V11 (v0.3) | `/home/hero` 응답에 `trend_7d` (array len=7), `doc_count_7d_ago` 필드 존재 | curl + jq |
| V12 (v0.3) | DomainTiles 의 Sparkline 렌더 (snapshot) + hover 시 `/links/graph?domain=X` 호출 발생 | vitest + msw |
| V13 (v0.3) | `/home/hero` p95 < 200ms (cache hit) / < 500ms (miss) | curl + time, 10회 반복 |

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
| **(v0.2 C1)** 백엔드 쿼리 N+1 / tag_cooc self-join 비용 | H | S1 첫 작업: `EXPLAIN ANALYZE` 로 인덱스 확인 — `document_tags(tag_id)`, `document_tags(document_id)`, `links(source_slug)`, `links(target_slug)`. 없으면 `CREATE INDEX` 먼저. p95 < 200ms 미달 시 cache TTL 단축 또는 응답 축소 |
| **(v0.2 C2)** doc-tag edge 폭발 | H | default OFF + tag 클릭 on-demand (Decisions §9). BE 응답 size 검증: domain=software (219 doc) 일 때 edge ≤ 500 개 |
| **(v0.2 I5)** tag 노드 slug=`"tag:<name>"` 가 기존 `/docs/<slug>` 라우팅에서 404 | M | FE 분기: `kind === 'tag'` 면 좌클릭 = cluster 토글, navigate 안 함. Cycle 1 = tag 노드 무시 (응답 받지만 렌더 안 함), S3 부터 정식 렌더 |
| **(v0.2 I1)** import 진행 중 카운트 변동 | L | V2 검증 = 정확 수치 대신 범위 (≥30). `as_of` 타임스탬프 응답에 포함 |
| **(v0.3) Trend SQL** 의 `generate_series` × tag join 비용 | M | `idx_documents_created_at` + `idx_document_tags_tag_id` 둘 다 있으면 ms 단위. 없으면 seq scan 으로 느려짐 — V9 에서 강제 |
| **(v0.3) sparkline 이 *항상 단조 증가*** (누적이라서) — 평탄해 보일 가능성 | L | 7일 누적 + 도메인별 색으로 시각 분리. 사용자가 "흐름 보임" 우선이라 OK. 향후 *일별 추가 수* (단조 X) 토글 검토 |
| **(v0.3) indegree 갱신 비용** | M | `update_links_for_document()` 가 touched doc 만 갱신 → O(touched). 전체 재계산 X. 다만 import 폭주 시 누적 부하 — 백필 batch 화 (1000개씩) 검토 |

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
- [ ] **(v0.3)** BE 인덱스 5개 (`document_tags(tag_id|document_id)`, `links(source_slug|target_slug)`, `documents(created_at)`) 적용
- [ ] **(v0.3)** `documents.indegree integer` 컬럼 + 초기 백필 + 변경 시 갱신 로직
- [ ] `GET /api/v1/home/hero` 신규 endpoint, 4 도메인 (이상) + 각 `top_docs` 3 + **`trend_7d` array(7) + `doc_count_7d_ago`** 반환, p95 < 200ms
- [ ] `GET /api/v1/links/graph?domain=X&include_tags=1` 확장 동작 (BE 만 — FE 는 Cycle 1 에서 tag 노드 무시)
- [ ] `apps/web/src/features/home/components/DomainTiles.tsx` 신규
- [ ] **(v0.3)** `apps/web/src/features/home/components/Sparkline.tsx` 신규 (의존성 0)
- [ ] **(v0.3)** 타일 hover 시 graph prefetch 동작 (`queryClient.prefetchQuery`)
- [ ] **(v0.3)** Hero subtitle 안내 ("상위 50개 + 도메인 태그") 표시
- [ ] **(v0.3)** i18n keys 7개 (`home.domain.*`, `home.trend.*`, `home.hero.scopeHint`) — ko + en
- [ ] Home.tsx 가 DomainTiles 를 hero 자리에 사용 (기존 RecentSection 은 아래로 demote, 제거 X)
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

## 8. Open Questions — 모두 해소 (v0.2)

| # | 질문 | 결정 | 위치 |
|---|---|---|---|
| Q1 | cache TTL | **5분, p95 < 200ms** | Decisions §14 |
| Q2 | top_docs 선정 | **in-degree 상위 3개** (fallback: updated_at desc) | Decisions §15 |
| Q3 | cluster strength default | **0.15**, 슬라이더는 S5 polish 검토 | Decisions §11 |
| Q4 | edge chip default | `wiki` ON, `doc_tag` ON (tag 클릭 시만 그려짐), `tag_cooc` **OFF** | Decisions §10 |
| Q5 (C2) | doc_tag edge default | **OFF + tag 클릭 on-demand** | Decisions §9 |
| Q6 (I3) | 빈 도메인 표시 | **숨김** (타일 1–4 동적) | Decisions §13 |
| Q7 (I4) | `?domain=X&root=Y` 동시 | **동시 적용** (domain 안에서 root BFS) | Decisions §16 |
| Q8 (N3) | i18n | **ko + en** (`home.domain.<id>` key) | Decisions §12 |

S3 시작 전 재확인할 항목 없음. plan 즉시 실행 가능.
