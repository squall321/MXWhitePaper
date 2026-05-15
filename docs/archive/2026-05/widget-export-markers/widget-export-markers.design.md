# Design — widget-export-markers

> Plan: [widget-export-markers.plan.md](../../01-plan/features/widget-export-markers.plan.md)

## 1. Architecture

### 1.1 단일 진실 — `emit_marker_text(block)` in widget_markers.py

```python
# apps/api/app/services/widget_markers.py 에 추가

_EXPORT_MARKER_TYPES: frozenset[str] = frozenset({
    # 마커 필수 (docx/pptx 표현 한계)
    "iframe", "video", "file", "pdf", "whiteboard", "image-annotation",
    "flow", "chart", "gantt", "org-chart",
    # 마커 식별용 (자연 표현 후 다시 인식 불가)
    "tabs", "accordion", "doc-link-card", "glossary-ref",
})

# schema type → import-side dispatcher key (역방향 매핑)
_SCHEMA_TO_MARKER_KEY: dict[str, str] = {
    "doc-link-card": "doc-link",
    "glossary-ref": "glossary",
}

def emit_marker_text(block: dict[str, Any]) -> str | None:
    """Return ``"Widget: <type> (variant)"`` string for the 12 widget
    types that need export-side marker prepending; ``None`` for everything
    else (paragraphs, tables, callouts, kpi-cards, gallery, columns…).

    Variant rules:
      * chart  → block["chartType"]  (e.g. "bar", "line")
      * gallery (NOT emitted; opt-out)
      * iframe (no variant)
      * everything else: no variant
    """
    t = block.get("type")
    if t not in _EXPORT_MARKER_TYPES:
        return None
    marker_key = _SCHEMA_TO_MARKER_KEY.get(t, t)

    variant: str | None = None
    if t == "chart":
        ct = block.get("chartType")
        if isinstance(ct, str) and ct in _ALLOWED_CHART_TYPES:
            variant = ct
    # (다른 위젯의 variant 추론은 필요시 추가)

    if variant:
        return f"Widget: {marker_key} ({variant})"
    return f"Widget: {marker_key}"
```

### 1.2 4 렌더러 적용 패턴

각 `_b_<widget>` 의 첫 줄에 marker emit. 렌더러마다 emit 방식 다름:

| 렌더러 | Emit 방법 | 비고 |
|---|---|---|
| **docx_export** | `ctx.body.add_paragraph(text)` 또는 동등 — 본문 단락 추가 | python-docx 의 paragraph 가 import 측 paragraph 로 round-trip |
| **pptx_export** | 슬라이드의 본문 text frame 에 한 줄 추가 | python-pptx 의 placeholder text → import 측이 paragraph 로 인식 |
| **html_renderer** | `<!-- Widget: <type> -->` HTML 코멘트 | 사용자 가시성 0; round-trip 입력이 html 이 아니므로 import 측 동작 무관 |
| **markdown_export** | 새 라인에 `Widget: <type>` (그냥 plain text 한 줄) | md round-trip 시 paragraph 로 인식 |

## 2. Generator agent 시방서

### G1 — `emit_marker_text` + docx_export 12 위젯

**입력**: widget_markers.py 의 plain text emit, docx_export.py 의 12 `_b_<type>` 함수.

**작업**:
1. `widget_markers.py` 에 `_EXPORT_MARKER_TYPES`, `_SCHEMA_TO_MARKER_KEY`, `emit_marker_text` 추가. 모듈 export 에 `emit_marker_text` 노출.
2. `docx_export.py` 의 import 에 `from app.services.widget_markers import emit_marker_text` 추가.
3. docx_export.py 에서 12 위젯의 `_b_<type>` 함수 찾기 (`grep -n "def _b_" docx_export.py` 로 매핑). 각각 함수 첫 줄 (또는 `if not block:` 가드 후) 에 다음 추가:
   ```python
   marker = emit_marker_text(block)
   if marker:
       ctx.body.add_paragraph(marker)
   ```
   `ctx.body` 가 정확한 이름이 아닐 가능성 — docx_export 의 다른 `_b_<type>` 함수가 paragraph 를 어떻게 추가하는지 보고 동일 패턴 사용.
4. 12 위젯이 모두 dispatcher 의 `_BLOCK_DISPATCHERS` 에 등록돼 있는지 확인. 누락된 위젯이 있으면 (예: doc-link-card/glossary-ref) plan 에 알림.
5. test 추가: `tests/test_widget_export_markers.py` (new file) — 각 위젯 1줄짜리 sanity 테스트 (docx export 시 마커 paragraph 가 본문에 들어가는지).
6. **회귀 가드**: callout / kpi-cards / gallery / columns / paragraph / heading-4 등에 *마커 emit 안 되는* 것 확인하는 테스트 1개.

**산출**: widget_markers.py 변경 + docx_export.py 변경 + 새 테스트 파일.

**제약**: 다른 렌더러 (pptx/html/md) 만지지 말 것. lat 만지지 말 것 (V1 이 통합).

### G2 — pptx_export 12 위젯

**입력**: pptx_export.py 의 12 `_b_<type>` 함수.

**작업**:
1. `from app.services.widget_markers import emit_marker_text` import 추가.
2. 12 위젯의 `_b_<type>` 함수 각각 첫 줄에 marker emit. pptx 의 paragraph add 패턴 (보통 `_body_text_frame(slide).add_paragraph(text)` 같은 형태) 을 기존 다른 `_b_<type>` 에서 보고 따라할 것.
3. test 추가 (test_widget_export_markers.py 에 append): pptx 측 sanity 3-4개 (chart, iframe, doc-link-card, tabs).

**제약**: widget_markers.py / docx_export.py / html / md 만지지 말 것.

### G3 — html_renderer + markdown_export

**입력**: html_renderer.py + markdown_export.py 의 12 `_b_<type>` 함수.

**작업**:
1. 양쪽 import 에 `emit_marker_text` 추가.
2. **html_renderer.py**: 각 위젯 `_b_<type>` 의 첫 출력으로 `out.append(f'<!-- {marker} -->\\n')` 형태로 HTML 코멘트 추가. (정확한 buffer 이름은 다른 `_b_<type>` 따라할 것.)
3. **markdown_export.py**: 각 위젯 `_b_<type>` 의 첫 출력으로 `lines.append(marker)` 형태로 plain text 한 줄 추가.
4. test 추가 (test_widget_export_markers.py 에 append): html/md sanity 각 2개 (chart 의 코멘트, chart 의 md 마커).

**제약**: widget_markers / docx_export / pptx_export 만지지 말 것.

### G4 — Round-trip 통합 테스트

**입력**: 이미 통합된 export 마커 + 기존 Phase 1/2 import converter.

**작업**:
1. 새 파일 `apps/api/tests/test_widget_export_markers_roundtrip.py` 생성.
2. 각 12 위젯마다 한 테스트: DocumentJSON → render_docx → docx_to_document → 결과에 동일 type 의 위젯 블록이 있는지.
3. iframe/video/file/pdf 의 경우 schema 의 필수 필드 (`src`, `url`, `fileId`, `file_id`) 가 round-trip 후에도 동일한지.
4. 마커 emit 생략 위젯 (callout/kpi-cards) 도 1개씩 round-trip 테스트 (회귀 가드).
5. **G4 는 G1/G2/G3 모두 완료된 후 실행** — 다만 generator 는 동시 발사 (G4 가 자기 테스트 실행은 통합 후).

**제약**: 코드 수정 없음 — 새 테스트 파일만 추가.

### V1 — 통합 verifier (Sonnet)

**작업**:
1. 4 렌더러의 12 위젯 함수에서 marker emit 누락 없는지 grep 으로 일관성 검증.
2. `emit_marker_text` helper 가 정확히 12 type 만 반환, 그 외 None 반환 확인.
3. lat/export.md 가 새 변환 행동 반영하는지 (메인 thread 가 갱신 후 검증).
4. round-trip 테스트 모두 통과하는지.
5. `WIDGET_CONVERTERS` (import 측) 와 `_EXPORT_MARKER_TYPES` (export 측) 의 정합 — `tabs`/`accordion`/`doc-link-card`/`glossary-ref` 등 schema 명과 marker key 분기 정확.

**제약**: read-only.

## 3. 메인 thread 책임 (G 들 완료 후)

1. 통합 — generator patch 검토.
2. lat/export.md 갱신 — "marker prepend" 행동 추가.
3. 전체 pytest 회귀 확인.
4. typecheck / openapi drift 확인.
5. V1 발사.
6. V1 finding 처리.
7. analysis / report / archive / commit / push.

## 4. Definition of Done

- `emit_marker_text` 가 정확히 12 type 만 마커 반환.
- 4 렌더러 × 12 위젯 = 48 emit point 모두 적용.
- 12 위젯 round-trip 테스트 통과 (export → import → schema 동일).
- 회귀 가드 통과 (callout/kpi-cards 마커 안 나옴).
- 전체 pytest 회귀 0.
- web typecheck / openapi drift 0.
- lat/export.md 갱신.
