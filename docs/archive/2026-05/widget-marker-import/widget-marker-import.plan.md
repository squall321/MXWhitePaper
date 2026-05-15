# Plan — Widget marker import (Phase 1)

## Executive Summary

| 관점 | 한 줄 요약 |
| --- | --- |
| **Problem** | docx/pptx → DocumentJSON import 시 paragraph/table/list 외 14 종 위젯 (callout, kpi-cards, chart, …) 이 평탄화돼 모두 사라짐. LLM 이 사내 표준 위젯을 docx 로 출력할 방법 없음. |
| **Solution** | "직전 단락이 `Widget: <type>` 또는 `위젯: <type>` 마커면 다음 블록을 해당 위젯으로 변환" 통일 룰 도입. Phase 1 은 인프라 + 2 위젯 (callout, kpi-cards) POC. |
| **Function / UX 효과** | LLM 이 `Widget: callout (warn)` + 단락만 출력해도 import 후 진짜 callout 블록이 됨. 한 번 인프라가 깔리면 후속 위젯은 converter 추가만으로 확장. |
| **Core Value** | "LLM → docx → MX" 파이프라인의 완성. 사내 표준 위젯을 LLM 만으로 생성 가능. |

## 목표 / 비목표

### 목표 (이 PR 의 scope)

- docx_import 에 **마커 디텍터** 추가 — 정규식 `^(Widget|위젯):\s*([a-z-]+)(?:\s*\(([^)]+)\))?\s*$` (case-insensitive).
- 디텍터가 마커 단락을 소비하고 다음 1 개 블록을 변환 함수에 넘김.
- 위젯 변환 디스패처 — `WIDGET_CONVERTERS: dict[str, callable]`.
- **Phase 1 위젯 2 종**:
  - `callout` — 다음 단락을 `CalloutBlock` 으로. variant 는 마커 괄호 (info/warn/danger/tip).
  - `kpi-cards` — 다음 표를 `KpiCardsBlock` 으로. 1 행 헤더 (label/value/delta/trend) + 데이터 행.
- pptx_import 측에도 동일 디텍터 (슬라이드 단위 텍스트 시퀀스 walk).
- 미지원 위젯 타입 (`chart`, `gantt` 등) 은 마커는 소비하되 다음 블록은 그대로 emit + warning 추가 — 후속 Phase 의 hook 자리 확보.
- 회귀: 마커 단락이 없는 모든 기존 문서 100% 동일하게 import.

### 비목표

- Phase 2-3 위젯 (chart, gantt, flow, org-chart, tabs, accordion, gallery, …) — 별도 PR.
- **자동 패턴 인식** (마커 없이 콘텐츠 모양만으로 위젯 추론) — future work.
- export 측 마커 emit — 굳이 안 함. 이미 native 위젯 → docx 렌더가 있음.
- FE 위젯 UI — BE 만.

## 변경 영향 범위

| 파일 | 변경 | 위험도 |
| --- | --- | --- |
| `apps/api/app/services/docx_import.py` | 마커 디텍터 + 디스패처 + 2 변환 함수 | 중 — 본문 walk 흐름에 hook |
| `apps/api/app/services/pptx_import.py` | 동일 | 중 |
| `apps/api/app/services/widget_markers.py` (신규) | 디텍터 정규식 + 디스패처 + 변환 함수 모음 (importer 양쪽에서 공유) | 하 |
| `apps/api/tests/test_widget_markers.py` (신규) | 단위 + import 회귀 | — |
| `docs/lat/imports.md` | 마커 룰 섹션 추가 | 하 |
| `docs/llm-document-formats.md` | "현재 미구현 청사진" → "Phase 1: callout + kpi-cards 구현됨" 마킹 | 하 |

## 핵심 설계

### 1. 마커 정규식

```python
WIDGET_MARKER_RE = re.compile(
    r"^\s*(?:Widget|위젯)\s*:\s*([a-z][a-z0-9-]*)\s*(?:\(\s*([^)]+?)\s*\))?\s*$",
    re.IGNORECASE,
)
# Match groups: (widget_type, variant_or_args)
# Examples that match:
#   "Widget: callout (warn)"        -> ("callout", "warn")
#   "위젯: kpi-cards"               -> ("kpi-cards", None)
#   "Widget: chart (bar)"           -> ("chart", "bar")
```

### 2. 디스패처

```python
WIDGET_CONVERTERS = {
    "callout": _convert_callout,    # Phase 1
    "kpi-cards": _convert_kpi_cards,  # Phase 1
    # Phase 2 hooks (현재는 placeholder):
    "chart": None,
    "gantt": None,
    "flow": None,
    # ...
}
```

`None` 인 위젯은 디텍터가 마커 단락만 소비하고 다음 블록은 그대로 두면서 warning 추가. 사용자에게 "이 위젯은 아직 미지원" 시그널.

### 3. importer 통합

`_build_sections()` 의 본문 walk 중 paragraph 를 만나면:
1. `WIDGET_MARKER_RE` 매치 시도.
2. 매치 + converter 존재하면: 마커 단락은 emit 하지 않음 (consumed). 다음 블록(들)을 변환 함수에 넘겨 위젯 블록 1 개로 변환 → 그 블록을 emit. 인덱스 advance.
3. 매치 + converter None 이면: 마커 단락은 소비, 다음 블록 그대로 + warning.
4. 미매치: 평소대로 paragraph 처리.

### 4. Callout 변환 (Phase 1)

```python
def _convert_callout(marker_variant: str | None, next_block: dict) -> dict:
    """다음 단락 → CalloutBlock.

    variant: info | warn | danger | tip (default: info)
    """
    if next_block.get("type") != "paragraph":
        # 다음 블록이 단락이 아니면 변환 불가 — 원본 보존 + warning
        return None
    variant = (marker_variant or "info").lower()
    if variant not in {"info", "warn", "danger", "tip"}:
        variant = "info"
    return {
        "type": "callout",
        "id": _new_id(),
        "variant": variant,
        "text": next_block.get("text", ""),
    }
```

### 5. KpiCards 변환 (Phase 1)

```python
def _convert_kpi_cards(_marker_variant, next_block) -> dict:
    """다음 표 → KpiCardsBlock.

    예상 표 헤더: label | value | delta? | trend?
    """
    if next_block.get("type") != "table":
        return None
    headers = next_block.get("headers") or []
    rows = next_block.get("rows") or []
    if not rows:
        return None
    hdr_lower = [h.lower() for h in headers]
    def _col(name: str) -> int | None:
        try:
            return hdr_lower.index(name)
        except ValueError:
            return None
    label_i = _col("label") or 0
    value_i = _col("value") or 1
    delta_i = _col("delta")
    trend_i = _col("trend")
    items = []
    for row in rows[:4]:  # KPI 카드는 최대 4개
        item = {
            "label": row[label_i] if label_i < len(row) else "",
            "value": row[value_i] if value_i < len(row) else "",
        }
        if delta_i is not None and delta_i < len(row):
            item["delta"] = row[delta_i]
        if trend_i is not None and trend_i < len(row):
            item["trend"] = row[trend_i]
        items.append(item)
    return {
        "type": "kpi-cards",
        "id": _new_id(),
        "items": items,
    }
```

## 단계별 진행

1. **`widget_markers.py` 신규** — 정규식 + 디스패처 + callout/kpi-cards 변환 함수.
2. **docx_import 통합** — `_build_sections()` 의 paragraph walk 직후 hook.
3. **pptx_import 통합** — 슬라이드 본문 walk 에서 동일 hook.
4. **테스트** — `test_widget_markers.py` 신규:
   - 마커 정규식 단위 (Korean/English/variants/strip).
   - docx 통합: 단락 "Widget: callout (warn)" + 단락 → CalloutBlock 회수.
   - pptx 통합: 동일.
   - 미지원 위젯 마커: warning 추가됨 + 다음 블록 보존.
   - 마커 없는 paragraph 는 100% 동일 처리.
5. **회귀** — 전체 763 테스트 통과.
6. **lat 동기화** — `imports.md` 에 "Widget marker 룰" 섹션.
7. **llm-document-formats.md 업데이트** — Phase 1 구현 표시 + LLM 가이드 추가.

## 위험

- **본문 walk 흐름 변경**: index advance 가 잘못되면 다음 블록이 두 번 emit 되거나 skip 됨. 단위 테스트로 가드.
- **마커 단락 caption 와 충돌**: caption 휴리스틱이 paragraph 를 미리 잡아 figure 에 묶을 수 있음. caption 매칭 *전에* 마커 매칭 우선.
- **pptx 의 텍스트 단위**: pptx 는 한 슬라이드 안 여러 텍스트 박스 — "직전 단락" 이 어디인지 모호. 동일 슬라이드 안 다음 shape 으로 한정.
- **변환 실패 시 폴백**: converter 가 None 반환하면 마커를 다시 emit (원본 paragraph 로) 해야 정보 손실 없음.

## Success Criteria (Done = 모두 ✅)

- [ ] `widget_markers.py` + 단위 테스트 통과
- [ ] docx import: `Widget: callout (warn)` + 단락 → CalloutBlock 회수
- [ ] docx import: `Widget: kpi-cards` + 4행 표 → KpiCardsBlock 회수
- [ ] pptx import: 동일 두 가지
- [ ] 미지원 위젯 (`Widget: chart`): warning + 다음 블록 보존
- [ ] 마커 없는 본문: 100% 동일 import (기존 763 테스트 회귀 0)
- [ ] lat `imports.md` 갱신
- [ ] `llm-document-formats.md` Phase 1 마킹
