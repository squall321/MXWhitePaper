# knowledge-asset-phase356 완료 리포트

> PDCA cycle 완료: 2026-06-10 · commit `542adcb` · match rate 100% · 로드맵 전 Phase 종결

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| 문제 | 로드맵 잔여 3 Phase — glossary 가 DB 전용이라 CI/바이너리에 0회 탑재, 시스템 지식(lat/가이드/archive)이 in-app 검색 불가, lat 갱신 룰이 사람 기억 의존 |
| 해결 | glossary dump fallback + Meilisearch knowledge 인덱스 (346 docs) + lat [[ref]] 역인덱스 advisory |
| 기능/UX 효과 | ⌘K 팔레트에 "시스템 지식" 탭, standalone 바이너리가 glossary 용어 질의 가능, 커밋 시 영향받는 lat 문서 자동 안내 |
| 핵심 가치 | 지식 자산 로드맵 6 Phase 전체 완료 — 수립 당일 종결, 성공 지표 6/6 달성 |

## 산출물

| Phase | 내용 | 검증 |
| --- | --- | --- |
| 3 glossary | `chunker --dump-glossary` + `make glossary-dump` → glossary.json (16 terms, TRACKED_SOURCES). DB→dump→skip 3단 fallback | 호스트(DB 없음)에서 "glossary (dump): 16", 총 285 chunks, --check 0 |
| 5 BE | `knowledge_indexer.py` — lat/docs H2 단위 + archive INDEX 행 = 346 docs (lat 127/doc 84/guide 53/archive 82). GET /search/knowledge + POST reindex(admin) | pytest 4 신규 + 기존 search 28 회귀 0, live meili 질의 적중 |
| 5 FE | ⌘K CommandPalette "시스템 지식" 탭 — kind 뱃지 4색, Highlight sanitize, doc_path 모노 비클릭, BASE_URL 패턴 | tsc clean, vitest 2519/2519 |
| 6 advisory | `lat_impact.py` — lat_link_check 의 resolver import 재사용, 역인덱스 164 파일. pre-commit 끝 non-blocking 블록 | docx_import.py 입력 → imports lat 안내, 항상 exit 0 |
| anchor | lat_link_check 에 .md heading-slug 매칭 (GitHub-style slugify, 한글 보존) | 315 refs **0 broken 0 warnings** |
| 재빌드 | 바이너리 4종 + tarball 122.4MB (285 chunks + glossary + bm25 베이크) | standalone `query "용어 정의"` → glossary:general:etag top-hit |

## 핵심 설계 결정

- **knowledge 인덱스는 RAG chunker 와 별개 파이프라인**: RAG (외부 LLM 용, 800자 chunk,
  lock 보증) 와 in-app 검색 (사람 용, H2 섹션 단위, meili highlight) 은 소비자가 달라
  분할. archive 행 파서만 패턴 공유 (import 는 안 함 — toolkit 패키지 경계 유지).
- **FE 는 별도 페이지가 아니라 ⌘K 팔레트 탭**: 기존 검색 UX 의 진입점이 팔레트라
  (전용 /search 페이지 없음) 그 TabBtn 패턴에 편승 — surface 최소.
- **advisory 는 의도적으로 non-blocking**: lat 영향 추정은 오탐 가능 — fail 시키면
  guard 피로로 무력화된다. 안내만 하고 판단은 사람.
- **인증은 기존 /search 와 동일 (get_current_user)**: dev 환경의 no-token admin
  fallback 으로 dev 에선 200 — prod 에선 401. 신규 surface 에 새 정책을 만들지 않음.

## 발견/유의

- pre-commit OpenAPI drift guard 가 신규 endpoint 를 정확히 잡음 (make openapi-dump 로 해소,
  233 paths) — 기존 guard 체계가 신규 작업에도 작동함을 확인.
- knowledge reindex 는 수동 (admin POST) — docs 가 자주 바뀌면 lifespan ticker 후보 (Phase 7+).

## 잔여

- 없음 — 로드맵 6 Phase 전체 종결. 신규 개선은 roadmap 문서에 Phase 7+ 로 추가.
