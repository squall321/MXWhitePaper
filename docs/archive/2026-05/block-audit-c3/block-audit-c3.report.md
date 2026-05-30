# block-audit-c3 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Block audit Cycle 3 — M 2 (Spacer/Spreadsheet 3종 export dispatcher) |
| **Completion** | 2026-05-30 |
| **Status** | 2/2 gap 해소 |
| **Match Rate** | 100% |
| **Commit** | `f976f3d` |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Spacer / Spreadsheet 블록은 docx export 만 핸들러가 있고 html/md/pptx 3종 renderer 가 dispatcher 무등록 — export 시 silently 누락 |
| Solution | 3 renderer 모두에 `_b_spacer` + `_b_spreadsheet` 핸들러 신설 + dispatcher 등록. Sparse cell-ref map (`A1`,`B2`,…) → 평탄화 → native table 위임 |
| UX | docx 외 export 형식에서도 시각 간격 (spacer) 과 표 (spreadsheet) 가 정확히 보존됨 |
| Core Value | "export 매트릭스 균등화" 완성 — 4 export 형식에서 30+ 블록 타입 핸들러 보유율 동일 |

## 세부 변경 (2 gap)

### SPC-02 — Spacer 3종 export

| Format | Output |
|---|---|
| HTML | `<div class="b-spacer" style="height: Npx">` (sm=16 / md=32 / lg=64 / xl=128) |
| Markdown | `<!-- spacer:{size} -->` HTML comment (round-trip 보존용 marker) |
| PPTX | empty paragraphs (1 / 2 / 3 / 4 — size 비례) in body frame |
| (docx 기존) | 1/2/4 empty paragraphs |

### SPR-02 — Spreadsheet 3종 export

3 renderer 모두 동일 데이터 흐름:

1. sparse `cells: {A1, B2, ...}` 또는 dict shape (`{value, formula}`) 수용
2. `rows`/`cols` 미지정 시 cell key 에서 max 추론
3. 평탄화된 `headers[] + rows[][]` 의사 table 로 변환
4. native `_b_table` (또는 md/pptx 대응) 위임
5. `dict` 셀이면 `value` 우선 (formula 결과 surface)
6. 정적 스냅샷 — 사이트 자체 React 컴포넌트의 formula 재계산과는 분리

| Format | Output |
|---|---|
| HTML | `<div class="b-spreadsheet">` + title `⊞ {name}` + 평탄화 table |
| Markdown | title + GFM table |
| PPTX | title + 본문 frame native table |

## 구현 위치

- BE renderers:
  - `apps/api/app/services/html_renderer.py` — `_b_spacer`, `_b_spreadsheet`, `_SPACER_PX` 상수, dispatcher 2 entry
  - `apps/api/app/services/markdown_export.py` — 동일 (md 분기)
  - `apps/api/app/services/pptx_export.py` — 동일 (pptx 분기)

## lat 갱신

- `docs/lat/export.md` — spacer / spreadsheet 행 갱신:
  - spacer: "4 export 모두 핸들러 존재" + 형식별 emit 표기
  - spreadsheet: "이전엔 docx 만" → "4 export 모두" + sparse map 평탄화 컨벤션 명문화

## 검증

- 신규 export 테스트 6 케이스:
  - `tests/test_html_export.py` — spacer + spreadsheet
  - `tests/test_markdown_export.py` — spacer + spreadsheet
  - `tests/test_pptx_export.py` — spacer + spreadsheet
- schema:validate 16/16 sample 통과
- typecheck clean
- 회귀 0 — docx export 는 기존 핸들러 그대로

## 후속 / 시리즈 종료

- block-audit C1 (XS 11) + C2 (S 8) + C3 (M 2) = 누적 21 갭 모두 해소
- 30+ block 전수 audit 결과의 모든 잔여 항목 close
- 다음 사이클은 신규 위젯/기능 또는 다른 트랙
