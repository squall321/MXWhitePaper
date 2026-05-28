# home-knowledge-hero — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Home hero 재설계 — 4 super-domain 타일 + 이종(heterogeneous) 지식그래프 |
| **Completion** | 2026-05-22 (95%, S5 polish 미세 deferred) |
| **Match Rate** | 95% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Home hero 가 단순 "최근 추가 12건" — 데이터 자산 (3737 docs + 5098 tags + 수천 link) 묻혀있음 |
| Solution | 4 super-domain 타일 + 클릭 시 이종 그래프 (doc+tag 노드, 3 엣지 종류) + focus+context / degree filter / soft cluster |
| Function/UX | 사용자가 영역 지도로 지식 자산 파악, 클릭 한 번에 그래프 탐색 |
| Core Value | "지식의 영역 지도" — 데이터 자산을 시각으로 접근 가능 |

## 구현 위치
- `apps/web/src/features/home/components/DomainTiles.tsx` (140줄)
- `Sparkline.tsx`, `TodayHero.tsx`
- `apps/api/app/routers/links_graph.py` 확장 — `domain` + `include_tags` 옵션
- `apps/api/alembic/versions/0046_knowledge_hero_indexes.py` — indegree 컬럼 + 인덱스 5개
- KnowledgeGraph: tag 사각형 노드, 3 엣지 (wiki/doc_tag/tag_cooc), force cluster

## Sprint 분할
- S1+S2 BE+타일 (2026-05-21, `abee0a7`)
- S3 이종 그래프 시각 (2026-05-22, `6201631`)
- S4 focus + degree slider + soft cluster (`405339a`)
- S5 우클릭 메뉴 + 모바일 list fallback + 성능 튜닝 (`e54bd5b`)

## 후속 (deferred — 5%)
- edge chip UI 슬라이더 polish (구체적 갭 없음 — LOW cleanup 사이클에서 skip)
