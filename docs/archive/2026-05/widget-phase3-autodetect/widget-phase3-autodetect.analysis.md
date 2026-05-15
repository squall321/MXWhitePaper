# Gap Analysis — widget-phase3-autodetect

> Plan: [widget-phase3-autodetect.plan.md](../01-plan/features/widget-phase3-autodetect.plan.md)
> Design: [widget-phase3-autodetect.design.md](../02-design/features/widget-phase3-autodetect.design.md)
> Cycle date: 2026-05-15

## Match Rate: **100%** (4/4 자동 인식 + 918 passed)

## 1. Success Criteria

| 기준 | 결과 |
|---|:---:|
| `apply_widget_autodetect` 함수 + docx/pptx import 후크 | ✅ |
| 4 자동 인식 (callout / kpi-cards / gallery / gantt) | ✅ (columns 는 plan OUT 명시 — false positive 위험) |
| 단위 + 통합 테스트 | ✅ 36 신규 |
| 마커 있는 케이스 회귀 0 | ✅ Cycle X 의 13 round-trip 모두 통과 |
| False-positive 가드 | ✅ 9개 가드 테스트 (plain 1×1 / 5+행 / chart-style / 2-img 등) |
| 전체 pytest 회귀 0 | ✅ 918 passed, 1 skipped |
| typecheck / openapi drift | ✅ 0 / 0 |
| lat 갱신 | ✅ docs/lat/imports.md 에 Phase 3 섹션 추가 |

## 2. 자동 인식 4종 작동 매트릭스

| 인식기 | 트리거 신호 | False positive 가드 |
|---|---|---|
| `_autodetect_callout` | 1×1 표 + (배경색 OR 알림 이모지 ⚠️🚨ℹ️💡✅ OR 라벨 `[주의]` 등) | 신호 없으면 None |
| `_autodetect_kpi_cards` | 헤더 `label`+`value` (옵션 `delta`/`trend`), 1-4행 | 5+행 / 헤더 누락 → None |
| `_autodetect_gantt` | 헤더 `name|task|작업|이름` + `start|시작` + `end|종료` | chart-style 헤더 (`Month/Revenue`) → None |
| `_autodetect_gallery` | 연속 3개 이상 ImageBlock | 2-img 또는 단일 → None |

## 3. 에이전트 분할

| Agent | 영역 | 결과 |
|---|---|:---:|
| G1 | 인프라 (`apply_widget_autodetect`, `_autodetect_rewrite`, dispatcher) + `_autodetect_callout` + docx/pptx import 후크 | ✅ 14 tests |
| G2 | `_autodetect_kpi_cards` + `_strip_markdown_emphasis` 모듈-레벨 리팩토링 | ✅ 7 tests |
| G3 | `_autodetect_gallery` | ✅ 7 tests |
| G4 | `_autodetect_gantt` | ✅ 8 tests |
| V1 | Sonnet 통합 read-only 감사 (8 영역) | ✅ BLOCKING 0 |

G2/G3/G4 가 동시 발사 — 같은 파일에 각자 다른 함수 추가, dispatcher 등록은 메인이 일괄.

## 4. 핵심 의사 결정

### 4.1 `meta.auto_detected` 불가 — `summary.warnings` 가 유일한 audit 채널

G1 이 schema 의 `BlockMeta` 에 `additionalProperties: false` 가 있음을 발견 → `meta.auto_detected = True` 사용 불가. 모든 4 인식기가 `summary.warnings` 에 informative line 추가:
- `"auto-detected callout (variant=warn) from single-cell table"`
- `"auto-detected kpi-cards from N-row table with label/value headers (N=2)"`
- `"auto-detected gantt from 3-task table with name/start/end headers"`
- `"auto-detected gallery from 4 consecutive images"`

FE 가 import response 의 summary.warnings 를 사용자에게 노출하면 "자동 변환됨" 표시 가능.

### 4.2 `_strip_markdown_emphasis` 모듈-레벨 리팩토링 (G2 가 발견)

docx round-trip 시 텍스트가 `**...**` markdown bold 로 wrap 됨. G1 이 callout 의 emoji prefix 검출을 위해 인라인 처리하던 것을 G2 가 모듈 레벨로 빼서 kpi-cards / gantt / gallery (해당없음) 가 헤더 매칭에서 재사용. 5가지 emphasis 패턴 처리: `***x***`, `**x**`, `__x__`, `*x*`, `_x_`.

### 4.3 dispatcher 순서 — 충돌 없음

`callout` (1×1 표) / `kpi-cards` (label+value 헤더 표) / `gantt` (name+start+end 헤더 표) / `gallery` (image) — 입력 type 또는 헤더 구성이 다 다름. 첫 매치에서 stop 하지만 사실상 단일 트리거 → 순서 무관.

### 4.4 dispatcher walk 의 `i += n_consumed` (off-by-one 회피)

마커 버전 `_rewrite_blocks` 가 `i += 1 + n_consumed` (1 = 마커 paragraph 소비). autodetect 는 마커가 없으므로 `i += n_consumed`. V1 가 명시적 확인.

## 5. 발견된 부수 정보 — 미래 작업 후보

- **columns autodetect 보류 결정 검증됨**: V1 도 동의. 어떤 2칸 표든 columns 로 잘못 잡힐 위험. 별도 사이클에서 더 강한 신호 (예: docx 의 multi-column section break) 확보 후 진행.
- **G4 가 발견**: `_GANTT_START_HEADERS` 에 `시작일`/`종료일` 누락 (Phase 2 의 `_convert_gantt` 의 set 그대로 재사용). 본 사이클 scope 밖이라 미수정 — 별도 small follow-up.

## 6. 최종 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **100%** |
| 전체 pytest | **918 passed, 1 skipped** (Cycle X 의 image-annotation skip 유지) |
| 신규 테스트 | 36 (callout 14 + kpi 7 + gallery 7 + gantt 8) |
| 변경 파일 | 4 (widget_markers.py + docx_import.py + pptx_import.py + lat) + 1 신규 테스트 |
| 신규 LOC | ~450 (인프라 + 4 인식기 + 헬퍼 + 36 테스트) |
| Generator | 4 (G1-G4, Opus) |
| Verifier | 1 (V1, Sonnet, BLOCKING 0) |
| Verifier minor | 1 (stale 주석 — fix-up 완료) |
