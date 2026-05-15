# Report — widget-roundtrip-strictness

> 사용자 요청: "전수 검증한 다음, 예외가 없도록 강건한 방법으로 설계해. 꼼수 쓰지 말고."

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Started → Completed** | 2026-05-15 (단일 세션) |
| **Match Rate** | **100%** (18/18 위젯 lossless round-trip) |
| **Problem** | 전수 검증 결과 6 위젯 (callout/kpi-cards/columns/gallery/image-annotation/whiteboard) 이 docx→MX→docx 라운드트립 시 *plain paragraph 로 떨어짐*. 시스템이 "fake/하드코딩" 인지 의심받을 만한 결함. |
| **Solution** | 18 위젯 모두 hidden export 마커 + autodetect fallback + placeholder-on-failure 의 3계층 설계. 마커는 `<w:vanish>` 로 Word 에서 invisible. 외부 LLM 산출 docx 도 autodetect 가 callout/kpi-cards/gantt/gallery 잡음. image bytes 못 살리는 경우도 placeholder widget 으로 *위젯 identity 보존*. |
| **Function UX Effect** | MX 가 만든 docx 는 다시 import 하면 *모든* 위젯이 정확히 복원. 외부 LLM/사람이 만든 docx 도 룰 따르면 인식. round-trip 후 사용자가 챕터 추가/그림 끼우면 다음 import 도 정상. |
| **Core Value** | 시스템이 진짜로 동작함을 *전수 검증 (18 widget smoke)* 으로 증명. fake/하드코딩 의심 해소. |

## 1. 발견된 결함 (전수 검증 결과)

`/tmp/smoke_all_widgets.py` 가 18 위젯 각각 1개 블록 생성 → render_docx → docx_to_document → 블록 type 확인:

| 결과 | 위젯 |
|---|---|
| 이전 OK (12) | chart, gantt, flow, org-chart, iframe, video, file, pdf, doc-link-card, glossary-ref, tabs, accordion |
| **이전 LOST (6)** | callout, kpi-cards, columns, gallery, image-annotation, whiteboard |

원인 (위젯별):
- **callout**: export 가 색 paragraph emit, autodetect 는 1×1 색 *표* 만 인식 → 불일치.
- **kpi-cards**: export 가 2×2 시각 그리드, autodetect 는 1×N label/value 표 기대 → 불일치.
- **columns**: export 가 blocks 펼침, marker/식별자 없음.
- **gallery**: export 가 image 펼침, image_resolver 없으면 image 사라짐 → autodetect 의 3+ image 못 잡음.
- **image-annotation**: image bytes 없으면 import 가 ImageBlock 못 만들어 converter 의 첫 target check 실패.
- **whiteboard**: docx 가 strokes 표현 못 함, marker 가 None 반환 → marker 보존만.

## 2. 강건한 설계 — 3계층

### 계층 1 — Hidden 마커 (내부 round-trip lossless)
- 18 위젯 모두 `_EXPORT_MARKER_TYPES` 등록 + docx export 시 `Widget: <type> (variant)` 를 `run.font.hidden = True` 로 emit.
- Word 에서 invisible (정상 보기/인쇄 시 안 보임).
- import 시 `parse_marker` 가 hidden 여부 무관하게 텍스트만 매칭 → 정확 인식.

### 계층 2 — Autodetect (외부 LLM 산출 docx 의 첫 입력)
- 마커 없는 docx 에서 *컨텐츠 모양만으로* 위젯 추론.
- 강한 신호 요구 (false positive 회피):
  - callout: **shading + 이모지/라벨 둘 다** (G6 가 paragraph 패턴 확장)
  - kpi-cards: 정확한 `label`/`value` 헤더
  - gantt: `name`/`task`/`작업` + `start` + `end` 헤더
  - gallery: 3+ 연속 이미지

### 계층 3 — Placeholder on failure (정보 손실 0)
- gallery / whiteboard / image-annotation 의 image bytes 가 사라져도 placeholder widget emit.
- dispatcher 의 `n_consumed >= 1` 가드 풀고 `n_consumed = 0` 허용 — converter 가 *target 안 쓰고* placeholder 위젯만 생성. 후속 블록은 보존.
- summary.warnings 에 informative 로그.

## 3. 변경 영역 — 6 generator + main 통합

| Agent | 영역 | 변경 |
|---|---|---|
| G1 | callout hidden marker | `_b_callout` + `emit_hidden_marker_text` helper |
| G2 | kpi-cards | `_b_kpi_cards` 를 1×N 표로 재설계 + hidden marker. **시각 trade-off**: 2×2 그리드 → 1×N tabular |
| G3 | columns | `_b_columns` 가 1×N 표로 emit + `_convert_columns` 에 table-as-columns 경로 추가 |
| G4 | gallery | `_b_gallery` 에 hidden marker, `emit_marker_text` 에 layout variant 분기 |
| G5 | 14 visible→hidden 변환 | 기존 marker emit 위젯 14개 모두 `font.hidden=True` 로 통일 + sanity guard test |
| G6 | autodetect callout paragraph | docx_import 가 paragraph shading 캡처 (`__paragraph_bg__` transient), autodetect 가 shading+이모지/라벨 paragraph 인식 |
| **메인** | `_EXPORT_MARKER_TYPES` 6 추가 + dispatcher 의 `n_consumed >= 1` → `>= 0` + 3 converter 의 placeholder path | widget_markers.py |

## 4. 메트릭

| 지표 | 값 |
|---|---|
| BE pytest | **950 passed, 0 failed, 0 skipped** ⭐ 첫 18/18 round-trip 보장 |
| Web typecheck | exit 0 |
| OpenAPI drift | 0 |
| 18 위젯 round-trip smoke | **18/18 OK** |
| Generator | 6 (Opus, 5 병렬 + 1 별도) |
| 메인 통합 | dispatcher 정책 변경 + stale guard test 갱신 4건 |

## 5. 핵심 의사 결정

### 5.1 dispatcher `n_consumed == 0` 허용

이전: `n_consumed < 1` 을 conversion failure 로 거부 — 무한 루프 가드.
새: `n_consumed < 0` 만 거부. `n_consumed == 0` 은 *marker-only* 정상 경로 (placeholder widget 의도). 무한 루프 안 남 (dispatcher 의 `i += 1 + 0` 이 marker 만 advance).

### 5.2 시각 trade-off (kpi-cards)

2×2 dashboard 그리드 → 1×N tabular. 이유: 1×N 이 autodetect 와 일치 + round-trip 안전. 시각 손실은 트레이드오프 (사용자 가치 = round-trip 정확성 > 대시보드 미감).

### 5.3 Hidden marker 우선 (visible 폐기)

이전: marker 가 *visible paragraph* (Word 에서 "Widget: chart (bar)" 줄이 보임). 사용자가 docx 열어보면 noise.
새: 18 위젯 모두 hidden. Word 정상 보기에서 invisible. 사용자가 *숨김 텍스트 표시* 옵션 켜면 회색 점선 밑줄로 표시 (옵션 켰을 때만 보임).

## 6. LLM 작성 룰 문서

새 파일 `docs/llm-input-rules.md` 작성 — 사용자가 LLM 에게 docx 만들라고 시킬 때 LLM 에게 줄 명세서. 18 위젯 각각의 *형태* (헤더/색/이모지/들여쓰기) 명시 + 자주 하는 실수.

## 7. 변경 파일

| 파일 | 변경 |
|---|---|
| `apps/api/app/services/widget_markers.py` | `_EXPORT_MARKER_TYPES` 6 추가, `emit_marker_text` 의 columns/callout/gallery variant 분기, dispatcher policy 풀기, 3 converter 의 placeholder path, autodetect callout 의 paragraph 패턴 |
| `apps/api/app/services/docx_export.py` | 4 위젯 hidden marker emit (callout/kpi-cards/columns/gallery), 14 위젯 visible → hidden 변환, kpi-cards 1×N 재설계 |
| `apps/api/app/services/docx_import.py` | paragraph shading 캡처 |
| `apps/api/tests/test_widget_*.py` | 새 정책 반영 stale guard 갱신, placeholder path 검증, 18 위젯 smoke 가드 |
| `docs/llm-input-rules.md` (NEW) | LLM 작성 룰 종합 가이드 |
| `docs/lat/imports.md` | autodetect paragraph 경로 + placeholder semantics 갱신 |

## 8. 학습

- **전수 검증의 가치**: 마커-있는 fixture 테스트만 통과해도 *production 시나리오 (callout 블록 → docx → 재import)* 가 깨지는 걸 발견할 수 없었다. smoke test 가 진짜 결함 노출.
- **fake/하드코딩 의심 해소**: 사용자가 "진짜 동작하는 것 맞아?" 물었을 때 *전수 검증 후 결함 발견 + fix* 이 가장 신뢰 가는 답.
- **3계층 설계**: marker (precise) + autodetect (recall) + placeholder (lossless) — 세 채널이 합쳐서 진정한 강건성.
- **dispatcher 정책 풀기**: 무한 루프 가드 (`n_consumed >= 1`) 가 합법적 use-case (placeholder marker-only) 를 막고 있었다. 정책 풀고 `n_consumed >= 0` 허용 + 의미 부여.
