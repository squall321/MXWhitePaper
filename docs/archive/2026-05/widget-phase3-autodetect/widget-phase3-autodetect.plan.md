# Plan — widget-phase3-autodetect

> Cycle Y. 마커 없는 docx/pptx 본문에서 *컨텐츠 모양만으로* 위젯 자동 추론.
> 5종: callout / kpi-cards / gallery / columns / gantt.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | 외부 LLM 이나 사람이 작성한 docx/pptx 가 마커 (`Widget: <type>`) 없이도 위젯스러운 컨텐츠 (색 박스, 큰 숫자 KPI 표, 연속 이미지 etc.) 를 담고 있을 때 import 가 일반 paragraph/table/image 로만 인식 → 시각 가치 손실. |
| **Solution** | `apply_widget_markers` 직후 새 post-pass `apply_widget_autodetect` 추가. **마커 없는 블록만 검사** (Cycle X 의 마커 처리는 보존). 5종 패턴 인식: 단일 셀 + 배경색 표 → callout; label/value 헤더 표 → kpi-cards; 연속 N 이미지 → gallery; 연속 N "simple" 블록 → columns; Task/Start/End 헤더 표 → gantt. |
| **Function UX Effect** | LLM 산출 docx/pptx 가 마커 없어도 위젯 복원. import summary 의 warning 에 "auto-detected" 표시로 사용자 확인 가능. |
| **Core Value** | 위젯 인식 = 마커 의존 (precise) ∪ 자동 인식 (recall). Recall 향상. |

## Scope

### IN — 5 자동 인식

1. **callout**: 단일 행 단일 셀 표 (1×1) 이고 셀에 `bg` 또는 셀 텍스트의 첫 문자가 `⚠️ / ❗ / ℹ️ / 💡 / 🚨` 같은 알림 이모지 → callout 으로 추론. variant 추론: 색에서 (적/주황 → danger/warn, 노/초 → tip, 파/회 → info).
2. **kpi-cards**: 헤더가 *label* / *value* 만 또는 그 두 컬럼 + *delta* / *trend* (Phase 1 의 import-side `_convert_kpi_cards` 와 동일 헤더 매칭) 인 표. 행이 1~4개. **마커 있을 때 이미 잡힘 → 이 자동 인식은 마커 없는 경우만 발동.**
3. **gallery**: 연속 3개 이상 ImageBlock. **마커 있을 때 이미 잡힘 → 마커 없는 경우만.**
4. **columns**: 패턴이 까다로움 — docx 의 "section column" 또는 width-equal table 의 N(2-4) 칸. 보수적으로 처리: **현재 사이클 IN 에서 제외**. (자동 인식 false positive 가 너무 클 위험.)
5. **gantt**: 헤더가 `name`/`task` + `start` + `end` (Korean alias 포함) 인 표. **마커 있을 때 chart 와 모호** → 마커 없는 경우만 자동 인식, 그리고 schema 의 `Heading 4` `시작`/`종료` 라벨 명시적일 때만.

### OUT (이번 사이클)

- **columns 자동 인식**: false positive 위험 (어떤 2칸 표든 columns 로 잡힐 수 있음). 별도 사이클 또는 신호 더 명확할 때까지 보류.
- 마커 있는 케이스는 처리 안 함 (Cycle X 가 이미 처리).
- false positive 발견 시 사용자가 수동 revert 하는 UX — FE 작업이라 별도.

### 발동 조건 룰

- **마커 처리 *후* 발동** (`apply_widget_markers` → `apply_widget_autodetect` 순).
- 자동 인식 시 summary.warnings 에 informative line 추가: `"auto-detected: callout from single-cell color table (block id <ulid>)"` 같은 형태.
- 정보 손실 0 룰: 변환할 수 없으면 그냥 통과 (원본 블록 보존).
- 자동 인식된 블록은 `meta.auto_detected = true` 필드 추가 — FE 가 시각적으로 "자동 변환됨" 표시 가능. (추가 시도 — schema 허용 여부 확인 후.)

## Success Criteria

1. `apply_widget_autodetect(sections, summary)` 함수 추가, `docx_import` / `pptx_import` 에서 `apply_widget_markers` 직후 호출.
2. 4 자동 인식 (callout / kpi-cards / gallery / gantt) 작동:
   - 단일-셀 색 표 → callout
   - label/value 헤더 표 → kpi-cards
   - 연속 3+ 이미지 → gallery
   - Task/Start/End 헤더 표 → gantt
3. 각 인식기에 단위 테스트 + docx 라운드트립 통합 테스트.
4. **마커 있는 케이스 회귀 0** — Cycle X 의 13 round-trip 테스트 그대로 통과.
5. **false positive 가드 테스트**: 평범한 표/이미지/paragraph 가 위젯으로 잘못 변환되지 않음 (가드 테스트 4-6개).
6. 전체 pytest 회귀 0. typecheck 0. openapi drift 0.
7. lat 갱신.

## Work Split — 4 Generator + 1 Verifier

| Agent | 담당 | 영역 |
|---|---|---|
| G1 | `_autodetect_callout` (단일-셀 색 표) + `apply_widget_autodetect` 인프라 (post-pass walk + dispatcher list + warning 패턴) + docx_import / pptx_import 후크 연결 | widget_markers.py + docx_import.py + pptx_import.py |
| G2 | `_autodetect_kpi_cards` (label/value 헤더 표) | widget_markers.py |
| G3 | `_autodetect_gallery` (연속 3+ 이미지) | widget_markers.py |
| G4 | `_autodetect_gantt` (Task/Start/End 헤더 표) | widget_markers.py |
| V1 | 통합 read-only 감사 + false-positive 가드 검토 | read-only |

G1 이 인프라 + callout 합쳐서 첫 단계. G1 완료 후 G2/G3/G4 병렬 (모두 widget_markers.py 추가만, dispatcher 등록 별도).

## Risks

| Risk | Mitigation |
|---|---|
| 자동 인식이 false positive — 평범한 표/이미지를 위젯으로 변환 | (a) 각 인식기에 강한 신호 요구 (callout 은 색 OR 알림 이모지 *둘 다* 검사 등). (b) 가드 테스트 명시적 추가. (c) `meta.auto_detected = true` 필드로 FE 가 사용자에게 표시 가능. |
| 마커 처리와 자동 인식 충돌 | apply_widget_autodetect 가 *마커 있던 위젯 블록은 건드리지 않음* — `block.get("type") in {위젯 타입들}` 검사로 skip |
| Phase 1 의 마커 callout 과 Phase 3 의 자동 callout 출처 구분 안 됨 | `meta.auto_detected` 로 구분. summary.warnings 에도 명시. |
| 표/이미지의 dtype 정확성 — Phase 3 가 잘못 잡으면 사용자 surprise | summary.warnings 에 "auto-detected: <type> from <evidence>" 형태로 모두 기록 → import response 의 summary 에 노출 |

## Cycle Boundaries

archive: `docs/archive/2026-05/widget-phase3-autodetect/`. 후속:
- Cycle Z (web cell 인-편집)
- columns 자동 인식 (별도 사이클, 신호 더 명확할 때)
- FE 의 "자동 인식됨" 표시 UI
