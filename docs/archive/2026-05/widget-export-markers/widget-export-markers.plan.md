# Plan — widget-export-markers

> Cycle X. Export 측 위젯 → docx/pptx/html/md 변환 시 `Widget: <type>`
> 마커 텍스트 라인을 위젯 자리 위에 prepend. round-trip 시 import 측이
> 마커 + 다음 블록 (또는 자연-fall-back 평탄화 결과) 을 다시 위젯으로 복원.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | round-trip 시 위젯 정보 손실. docx export 가 iframe/video/file/pdf/whiteboard 같은 비표현 위젯을 단순 텍스트/링크/이미지로 평탄화 → import 가 그게 위젯이었는지 모름. Phase 1/2 의 *import 자동 인식* 만으로는 부족. |
| **Solution** | docx/pptx/html/md 의 12 선별 위젯 `_b_<type>` 진입점에 `Widget: <type> (variant)` 마커 단락 prepend. import 측은 이미 Phase 1/2 에서 마커 인식 가능 → round-trip lossless. callout/kpi-cards/gallery/columns 4종은 자동 인식이 잡아주므로 마커 emit 생략. |
| **Function UX Effect** | docx 라운드트립 (docx → MX → docx) 가 iframe/video/file/pdf/chart/gantt/flow/org-chart/image-annotation/whiteboard/tabs/accordion/doc-link-card/glossary-ref 까지 lossless. roundtrip CLI 의 `--verify-toc` 와 비슷한 신뢰도. |
| **Core Value** | "동일 위젯 정의가 docx → MX → docx 왕복 후에도 동일" 보장. roundtrip 의 결정타. |

## Scope

### IN — 12 위젯 export 마커 emit

마커 *필수* (docx/pptx 가 표현 못 함):
- `iframe`, `video`, `file`, `pdf`, `whiteboard`, `image-annotation`
- `flow`, `chart`, `gantt`, `org-chart`

마커 *식별용* (docx/pptx 가 표현 가능하지만 import 가 무엇인지 식별 못 함):
- `tabs`, `accordion`, `doc-link-card`, `glossary-ref`

> doc-link-card / glossary-ref 는 marker 텍스트가 schema type 이 아니라
> import 측 dispatcher key (`doc-link`, `glossary`) 를 써야 import 가 인식.

### OUT — 마커 생략

자동 인식 (Phase 3 가 잡음 또는 이미 잡힘):
- `callout` — 색 paragraph 패턴
- `kpi-cards` — label/value 헤더 표
- `gallery` — 연속 image 자동
- `columns` — Phase 3 자동 인식

### 영향 받지 않는 위젯
- Phase 1 의 `callout`, `kpi-cards` 는 *마커 emit 안 함*. import 가 표/색 paragraph 로 인식.
- `paragraph`, `heading-4`, `list`, `quote`, `code`, `math`, `table`, `image`, `figure-index`, `spacer` 등 일반 블록은 위젯 아님.

## 구현 패턴

### Helper — `_widget_marker_text(block) -> str | None`

위젯 종류 + variant 를 보고 마커 텍스트를 만드는 단일 helper. 4 렌더러가 공유.

```python
# apps/api/app/services/widget_markers.py 에 emit_marker_text() 추가
_EXPORT_MARKER_TYPES = {
    "iframe", "video", "file", "pdf", "whiteboard", "image-annotation",
    "flow", "chart", "gantt", "org-chart",
    "tabs", "accordion", "doc-link-card", "glossary-ref",
}

# schema type → marker dispatcher key (역방향 매핑)
_SCHEMA_TYPE_TO_MARKER = {
    "doc-link-card": "doc-link",
    "glossary-ref": "glossary",
    # 나머지는 자기 자신
}

def emit_marker_text(block: dict[str, Any]) -> str | None:
    t = block.get("type")
    if t not in _EXPORT_MARKER_TYPES:
        return None
    marker_type = _SCHEMA_TYPE_TO_MARKER.get(t, t)
    # variant 추론: chart 는 chartType, callout 은 variant, 그 외 없음
    variant = None
    if t == "chart":
        variant = block.get("chartType")
    elif t == "gallery":
        variant = block.get("layout") if block.get("layout") != "grid" else None
    # … (위젯별 variant 매핑)
    if variant:
        return f"Widget: {marker_type} ({variant})"
    return f"Widget: {marker_type}"
```

### 4 렌더러 변경 패턴

각 `_b_<widget>(block, ctx)` 함수의 *맨 처음*:

```python
def _b_chart(block, ctx):
    marker = emit_marker_text(block)
    if marker:
        ctx.body.add_paragraph(marker)  # docx
        # or _add_text(slide, marker)   # pptx
        # or out.append(f'<p>{marker}</p>')  # html
        # or lines.append(marker)            # md
    # … 기존 chart 렌더 그대로
```

### Round-trip 자동 검증

`_b_chart` 가 마커 emit 후 평소대로 표/이미지 도 emit. import 측 `_convert_chart` 는 marker + 표 패턴을 보고 ChartBlock 복원 → round-trip lossless.

## Success Criteria

1. 12 위젯 모두 docx/pptx/html/md export 시 마커 prepend.
2. `emit_marker_text(block)` helper 가 widget_markers.py 에 추가, 4 렌더러가 import 해서 사용.
3. round-trip 테스트: 각 12 위젯에 대해 *export → import* 사이클 후 schema type / 핵심 field 동일.
4. callout/kpi-cards/gallery/columns 는 마커 emit 안 함 (회귀 가드).
5. 전체 pytest 회귀 0.
6. typecheck / openapi drift 0.
7. lat/export.md 의 위젯별 변환 표에 "marker prepend" 컬럼 추가.

## Work Split — 4 Generator + 1 Verifier

분할 단위는 **렌더러별** (4) + 검증 (1):

| Agent | 담당 | 변경 |
|---|---|---|
| G1 | `emit_marker_text` helper + docx_export 의 12 `_b_<type>` 함수 | widget_markers.py + docx_export.py |
| G2 | pptx_export 의 12 `_b_<type>` 함수 | pptx_export.py |
| G3 | html_renderer + markdown_export 의 12 `_b_<type>` 함수 | html_renderer.py + markdown_export.py |
| G4 | round-trip 통합 테스트 (12 위젯 × export → import → schema 확인) | tests/test_widget_export_markers_roundtrip.py (new file) |
| V1 | 통합 검증 (4 렌더러 일관성 + round-trip 누락 위젯 + lat 갱신) | read-only |

G1 은 helper 도 같이 만드므로 *가장 먼저* 완료해야 G2/G3 가 그 helper import. 직렬 1단계 (G1) + 병렬 2단계 (G2+G3+G4).

## Risks

| Risk | Mitigation |
|---|---|
| 4 렌더러의 `_b_<type>` 함수 이름이 다를 수 있음 | G1 이 docx_export 처리하면서 함수 이름 패턴 보고할 것. G2/G3 가 받음. |
| html_renderer 가 div/span 마커를 paragraph 로 인식 못 할 수 있음 | html 마커는 `<!-- Widget: ... -->` HTML 코멘트로 emit (import 측이 무시) — round-trip 시 html → import 경로는 없으므로 무해 |
| chart 의 variant (chartType) 가 schema 와 다를 가능성 | helper 가 schema enum (`bar`/`line`/...) 만 emit, 그 외는 생략 |
| 마커가 *body 텍스트로 보임* | 의도된 결과 — 사용자가 docx 열어보면 "Widget: chart (bar)" 가 보임. 한 줄이라 무해. 추후 hidden 스타일로 마킹할 수 있음 (별도 사이클) |
| Phase 1 위젯 (callout/kpi-cards) 에 실수로 마커 emit | helper 의 `_EXPORT_MARKER_TYPES` 화이트리스트로 강제 |

## Cycle Boundaries

archive: `docs/archive/2026-05/widget-export-markers/`. 후속:
- Cycle Y (Phase 3 자동 인식)
- Cycle Z (web 셀 인-편집)
- Hidden marker style (별도, low priority)
