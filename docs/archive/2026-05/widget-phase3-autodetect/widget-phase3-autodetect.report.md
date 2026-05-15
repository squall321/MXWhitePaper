# Report — widget-phase3-autodetect

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Feature** | widget-phase3-autodetect |
| **Started → Completed** | 2026-05-15 (단일 세션, ~1.5h) |
| **Match Rate** | **100%** |
| **Problem** | 외부 LLM 산출 또는 사람이 작성한 docx/pptx 가 마커 (`Widget: <type>`) 없이도 위젯스러운 컨텐츠 (색 박스, KPI 표, 연속 이미지 등) 를 담고 있을 때 import 가 일반 paragraph/table/image 로만 인식 → 시각 가치 손실. |
| **Solution** | `apply_widget_markers` 직후 `apply_widget_autodetect` 새 post-pass 추가. 4 자동 인식: 단일-셀 색 표 → callout / label+value 표 → kpi-cards / name+start+end 표 → gantt / 연속 3+ 이미지 → gallery. 마커 처리된 블록은 type 검사로 자연 skip. |
| **Function UX Effect** | LLM 산출 docx/pptx 가 마커 없어도 위젯 복원. summary.warnings 에 audit 트레일. 사람이 docx 에 색칠한 박스도 callout 으로 복원. |
| **Core Value** | 위젯 인식 = 마커 (precise) ∪ 자동 (recall). Cycle X+Y 합쳐서 import 의 위젯 처리는 precise + recall 둘 다 충족. |

## 1. 결과 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **100%** |
| 전체 pytest | **918 passed, 1 skipped** |
| 신규 테스트 | **36** (4 인식기 × 평균 9개) |
| 회귀 | **0** |
| Web typecheck | exit 0 |
| OpenAPI drift | 0 |
| 변경 파일 | 4 + 1 신규 테스트 |
| 신규 LOC | ~450 |

## 2. 작업 분할 결과

### Generator — 4 Agent (Opus)

| Agent | 담당 | LOC | Tests |
|---|---|:---:|:---:|
| G1 | 인프라 (`apply_widget_autodetect`, dispatcher) + `_autodetect_callout` + import 후크 | ~200 | 14 |
| G2 | `_autodetect_kpi_cards` + `_strip_markdown_emphasis` 모듈-레벨 리팩토링 | ~80 | 7 |
| G3 | `_autodetect_gallery` (multi-block 패턴) | ~60 | 7 |
| G4 | `_autodetect_gantt` | ~80 | 8 |

G1 이 인프라를 깔고, 그 뒤 G2/G3/G4 동시 발사. 같은 파일에 각자 다른 함수 추가 → 충돌 0.

### Verifier — 1 Agent (Sonnet)

V1 이 8 영역 검증: dispatcher / walk / schema / false-positive 가드 / 마커 interaction / audit / markdown unwrap / regression. **BLOCKING 0건**, minor 1건 (stale 주석 — fix-up 완료).

## 3. 핵심 의사 결정

### 3.1 `meta.auto_detected` 사용 불가 → `summary.warnings` 가 audit 채널

`BlockMeta` schema 가 `additionalProperties: false` 라 임의 필드 추가 불가. 4 인식기 모두 `summary.warnings` 에 한 줄씩 informative log 추가. FE 가 import response 의 summary.warnings 표시하면 사용자가 "자동 변환됨" 알 수 있음.

### 3.2 4 인식기 모두 *strict signal* 요구 — false positive 회피

- callout: 색 OR 이모지 OR 라벨 *중 하나 이상* 필요. 평범한 1×1 표는 변환 안 함.
- kpi-cards: `label` + `value` 헤더 *정확* 매칭 + 행 1-4. 그 외는 None.
- gantt: `name`+`start`+`end` 헤더 정확 매칭. chart-style (`Month/Revenue/Profit`) 은 None.
- gallery: 3+ 연속 이미지. 2개는 충분히 모호하므로 None.

V1 도 9개 false-positive 가드 테스트 모두 통과 확인.

### 3.3 dispatcher 순서 ≠ priority

callout (1×1 표) / kpi-cards (특정 헤더 표) / gantt (다른 특정 헤더 표) / gallery (image) — 입력 type 또는 헤더가 다 달라서 첫 매치에서 stop 하지만 실질적으로 단일 트리거. 순서 변경해도 동작 동일.

### 3.4 `_strip_markdown_emphasis` — round-trip 호환

docx round-trip 후 텍스트가 `**x**` 같은 markdown bold 로 wrap. G2 가 G1 의 인라인 unwrap 을 모듈-레벨 helper 로 빼서 callout / kpi-cards / gantt 가 공유.

## 4. 변경 파일

| 파일 | 변경 |
|---|---|
| `apps/api/app/services/widget_markers.py` | Phase 3 섹션 추가 (`apply_widget_autodetect` + 4 인식기 + 헬퍼) |
| `apps/api/app/services/docx_import.py` | `apply_widget_markers` 호출 직후 `apply_widget_autodetect` 호출 |
| `apps/api/app/services/pptx_import.py` | 동일 |
| `apps/api/tests/test_widget_autodetect.py` (NEW) | 36 테스트 |
| `docs/lat/imports.md` | Widget auto-detect post-pass 섹션 추가 |

## 5. 학습

- **마커 처리와 자동 인식의 자연 분리**: 마커 처리 후 블록은 이미 위젯 타입 → 자동 인식기의 `type == "table"` / `"image"` 검사로 자연 skip. 명시적 충돌 회피 코드 불필요.
- **strict signal 가드의 가치**: 자동 인식의 핵심 위험은 false positive (평범 컨텐츠를 위젯으로 변환). 강한 신호 요구 (callout 의 색/이모지/라벨, kpi 의 정확 헤더 매칭) 가 결정적. 만약 약한 신호로 했으면 사용자 콘텐츠 손상 위험.
- **dispatcher 시그니처 차이가 walk math 결정**: 마커 버전 `i += 1 + n_consumed` (마커 1 추가) vs 자동 인식 `i += n_consumed` (마커 없음). V1 가 off-by-one 명시적 검증 — 도그마 없이 측정으로 정당화.

## 6. 다음 사이클

- **Cycle Z (Web 셀 인-편집)**: mixed-cells 의 paragraph/image/list 인-셀 풀 편집. 본 사이클과 무관 (web 작업).
- **Follow-up small**: columns 자동 인식 (별도 사이클, 더 강한 신호 확보 후), `_GANTT_START_HEADERS` 에 `시작일/종료일` 추가 (G4 가 발견), image-annotation round-trip (image_resolver 인프라).
