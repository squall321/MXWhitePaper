# graph-triple-fe — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | graph-edge-predicates 의 FE — 술어 엣지 표시 + 수동 입력 + admin 일괄 추출 |
| **Completion** | 2026-05-22 (100%) |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | DB+API 만 있고 사용자가 그래프에서 술어 엣지를 못 봄 |
| Solution | KnowledgeGraph 에 술어 라벨 + 색상 + 점선(llm)/실선(manual) 분기, 그래프 우클릭 "엣지 추가" dialog, AdminDashboard 일괄 추출 버튼 |
| Function/UX | 그래프 시각화로 의미 엣지 인지 + 수동 입력 가능 |
| Core Value | 의미 그래프 사용자 인지/조작 완성 |

## 구현 위치
- `apps/web/src/features/graph/triplesApi.ts` (74줄) — fetchTriples/createTriple/deleteTriple/extractBulk
- `KnowledgeGraph.tsx` 에서 kind="triple" 엣지 렌더 (predicate 라벨)
- Graph.tsx / GraphAll.tsx / DepGraph.tsx 에 "🔗 triple 표시" 토글
- AdminDashboard 에 "triple 추출" 버튼 (bulk extract)

## 테스트
- `triplesApi.test.ts`

## Commit
- `d3d9d61 feat(graph): triple 엣지 FE — 술어 표시 + 우클릭 추가 + admin 추출 + 실 LLM`

## 후속
- 없음
