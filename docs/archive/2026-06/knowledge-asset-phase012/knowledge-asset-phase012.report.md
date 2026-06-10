# knowledge-asset-phase012 완료 리포트

> PDCA cycle 완료: 2026-06-10 · commit `6da474a` · match rate 100%

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| 문제 | 지식 자산이 write-only — 가이드 4종이 schema 대비 9일+ 드리프트 (G2~L 신기능 0건 커버), archive 80 reports 검색 불가, lat 링크 무결성 미보증, lite 바이너리 query 가 전 릴리즈에서 crash |
| 해결 | "사람 기억 → 기계 보증" 전환: 문서 일괄 동기화 + coverage/lat 검사기 신설 + archive RAG 화 + bm25 빌드 베이크 |
| 기능/UX 효과 | 외부 LLM 이 slicer/timeline/compute/source-ref 를 가이드로 학습 가능, `mxwp-rules query "왜 PUA"` 가 의사결정 기록을 찾음, 바이너리 query 직행 첫 동작 |
| 핵심 가치 | 신규 block 추가 시 문서 누락이 **pre-commit fail** — 드리프트 재발 구조적 차단 |

## 산출물

| Phase | 내용 | 검증 |
| --- | --- | --- |
| 로드맵 | `docs/knowledge-asset-roadmap.md` — 인벤토리×소비자 맵, 6 phases | Phase 3/5/6 잔여 |
| 0 문서동기화 | input-rules +103줄 (§3.14-15 신설), system-prompt 205→237, viewer-guide ko/en §2+§4, widgets-via-api §3.24-26 | coverage_check 38×2 ✓ |
| 1 검사기 | `rag/coverage_check.py` (pre-commit 연결), `rag/lat_link_check.py` | 커밋 시 실작동 확인, lat 313 refs 0 broken |
| 2 archive RAG | chunker 에 `docs/archive/*/_INDEX.md` glob (+97 chunks, 총 267) | rag tests 25 passed, bm25 top-hit 적중 |
| 4 바이너리 | bm25 사전생성+베이크 (rules/mcp), 4종 재빌드, tarball 122.3MB | 컨테이너 query smoke OK |

## 발견·수정된 기존 버그

1. **bm25 미베이크 (HIGH)**: lite 의 기본 backend 가 bm25 인데 build.py datas 에 없어
   `mxwp-rules query` 직행 (README 첫 예시) 이 모든 릴리즈에서 FileNotFoundError crash.
   `_MEIPASS` 는 휘발이라 사후 index 도 불가 — 빌드 시 `_ensure_bm25_index()` 로 해결.
2. **lat 깨진 링크 4건**: chartBoxplot.ts(→EChartsView#computeBoxStats), test_html_render(→export),
   services/retention(→retention_runner), 예정-파일 위키링크 표기.
3. **widgets-via-api drift 3건**: `options.footer`(→top-level footer 객체), `data.categories`(→labels),
   24자 예시 ULID 2종 (→26자).

## 핵심 인사이트

- **hash 검사 ≠ 의미 검사**: RAG `--check` 는 파일 단위라 "schema 에 block 추가됐는데
  가이드에 섹션 없음" 을 못 잡는다. coverage matrix 가 그 보완 — 검사 대상을 *schema 가
  스스로 선언* (Block union) 하게 해서 검사기 자체의 드리프트도 차단.
- **검사기의 가치는 첫 실행에서 입증**: lat 휴리스틱 추정 96건 → 정밀 resolver 실측 4건.
  도구 없이는 "96건 의심" 이라는 노이즈만 있었다.
- **archive 는 INDEX 만 chunk**: report 본문 전체는 노이즈. 월별 _INDEX 의 행 단위
  요약이 RAG 밀도에 적정 — glob 추적이라 새 월 디렉토리 자동 포함.
- **바이너리 smoke 는 진짜 워크플로우로**: `--version` sanity 는 통과해도 query 는
  crash 였다. README 의 첫 사용 예시를 smoke 로 쓰는 것이 옳다.

## 잔여 (로드맵 상 예정)

- Phase 3: glossary 오프라인 dump chunk
- Phase 5: in-app 지식 검색 (수요 확인 후)
- Phase 6: lat 자동 갱신 보조
- lat_link_check 의 symbol warning 3건 (heading-slug 앵커 — fail 아님, 개선 여지)
