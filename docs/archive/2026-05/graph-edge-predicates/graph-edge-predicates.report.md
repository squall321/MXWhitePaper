# graph-edge-predicates — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | 그래프에 술어 엣지 (subject, predicate, object) DB + API |
| **Completion** | 2026-05-22 (100%) |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | 그래프 엣지가 단순 "참조" 만 — 의미 (predicate) 없음 |
| Solution | `doc_triples` 테이블 + 5 endpoint (list/create/delete/extract/extract-bulk) + LLM mock provider |
| Function/UX | graph 가 술어 라벨 갖는 의미 엣지 처리 가능 |
| Core Value | 의미 그래프 인프라 기초 (FE 표시는 graph-triple-fe 에서) |

## 구현 위치
- `apps/api/alembic/versions/0047_doc_triples.py`
- `apps/api/app/routers/triples.py` (307줄)
- `apps/api/app/services/triple_extractor.py` (289줄) — LLM provider 인터페이스 + mock
- 기존 `links_graph` 에 `include_triples=true` 옵션 통합

## 테스트
- `test_triples_crud.py`, `test_triples_extract.py`, `test_links_graph_triples.py`

## Commit
- `71ecea5 feat(graph): doc_triples — 의미 엣지`

## 후속
- 없음 (FE 는 graph-triple-fe 가 별도 완료)
