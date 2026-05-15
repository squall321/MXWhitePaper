# Design — widget-phase3-autodetect

> Plan: [widget-phase3-autodetect.plan.md](../../01-plan/features/widget-phase3-autodetect.plan.md)

## 1. Architecture

### 1.1 두 번째 post-pass

```
_build_sections() (docx_import 또는 pptx_import)
  │
  ▼
apply_widget_markers()         # Phase 1/2 — 마커 인식
  │
  ▼
apply_widget_autodetect()      # Phase 3 — 마커 없는 패턴 자동 인식 [NEW]
  │
  ▼
DocumentJSON + summary
```

### 1.2 dispatcher 패턴

```python
# widget_markers.py 끝에 추가

# Each auto-detector: (block, blocks_after, summary) -> (widget, n_consumed) | None
# Signature mirrors marker converters' multi-target form.
AutoDetectorFn = Callable[
    [dict[str, Any], list[dict[str, Any]], _SummaryLike],
    ConverterResult | None,
]

WIDGET_AUTODETECTORS: list[tuple[str, AutoDetectorFn]] = [
    ("callout", _autodetect_callout),
    ("kpi-cards", _autodetect_kpi_cards),
    ("gallery", _autodetect_gallery),
    ("gantt", _autodetect_gantt),
]
# 순서가 중요: callout (가장 strict) → kpi-cards → gantt → gallery (마지막,
# image 연속 3+ 라 다른 휴리스틱과 충돌 적음). gantt 가 kpi-cards 앞이면 좋으나
# 헤더가 다른 게 강한 신호라 무관.

def apply_widget_autodetect(
    sections: list[dict[str, Any]],
    summary: _SummaryLike,
) -> None:
    """Recursive walk + in-place rewrite. Called AFTER apply_widget_markers."""
    for sec in sections:
        _autodetect_rewrite(sec.get("blocks") or [], summary)
        subs = sec.get("subsections") or []
        if subs:
            apply_widget_autodetect(subs, summary)


def _autodetect_rewrite(blocks, summary):
    if not blocks:
        return
    out = []
    i = 0
    while i < len(blocks):
        block = blocks[i]
        # Skip blocks that are already widget-typed (post-marker output)
        # OR are plain block types that auto-detectors don't target.
        result = None
        for name, fn in WIDGET_AUTODETECTORS:
            r = fn(block, blocks[i + 1:], summary)
            if r is not None:
                result = r
                break
        if result is None:
            out.append(block)
            i += 1
            continue
        widget, n_consumed = result
        if n_consumed < 1:
            out.append(block)
            i += 1
            continue
        out.append(widget)
        i += n_consumed   # Note: n_consumed includes the *first* block (not +1
                          # like marker version, because there's no marker to skip)
    blocks.clear()
    blocks.extend(out)
```

**핵심**: auto-detector signature 는 `(block, blocks_after, summary)` — marker-version 의 `targets` 가 *마커 후 블록들* 이었던 반면, autodetect 는 `block` 자체가 검사 대상 + `blocks_after` 가 lookahead. `n_consumed >= 1` 이며 1 = block 만 변환, 2 = block + blocks_after[0] 같이 소비.

### 1.3 G1 — `_autodetect_callout` + 인프라

**Signature**: `_autodetect_callout(block, blocks_after, summary) -> tuple[dict, int] | None`

**Detect rule**:
1. `block["type"] == "table"`.
2. **1×1 표** — `len(rows) == 1` AND `len(rows[0]) == 1` AND `len(headers) <= 1`. 또는 cells 모드면 `len(cells) == 1`.
3. **색 또는 알림 이모지 신호 *둘 중 하나* 이상**:
   - 셀 0-0 의 `bg` 필드가 HEX 색 (callout 같은 visual).
   - 셀 텍스트 첫 어떤 토큰이 `⚠️ / ❗ / ℹ️ / 💡 / 🚨 / ✅` 같은 알림 이모지.
   - 또는 셀 텍스트가 `[정보]` / `[주의]` / `[경고]` / `[위험]` / `[팁]` 같은 명시적 라벨.

**Variant 추론** (bg 색 또는 이모지/라벨에서):
- `⚠️` 또는 `[주의]` 또는 `[경고]` 또는 bg 색의 R-G-B 가 `R > G+30 AND R > B+30` 이면 → **warn**
- `🚨` 또는 `[위험]` 또는 bg 색의 R > 200 AND R-G > 50 → **danger**
- `💡` 또는 `[팁]` → **tip**
- 그 외 → **info**

**Emit**: CalloutBlock 형태로 변환. `meta.auto_detected = True`. summary.warnings 에 "auto-detected callout from single-cell table".

**Return**: `({"type":"callout","id":_new_id(),"variant":<v>,"text":<cell_text>,"meta":{...}}, 1)`.

**False positive 회피**: 1×1 표 라도 신호 (색/이모지/라벨) 없으면 None.

### 1.4 G2 — `_autodetect_kpi_cards`

**Detect rule** (`_convert_kpi_cards` 와 동일 헤더 매칭):
1. `block["type"] == "table"`.
2. headers 가 `label` + `value` (lowercase 매칭) 포함, optional `delta` / `trend`.
3. rows 1~4개.

**Emit**: Phase 1 의 `_convert_kpi_cards` 와 동일한 형태. `meta.auto_detected = True`.

**False positive 회피**: 헤더 정확 매칭 (`name`/`amount` 같은 비슷한 표는 잡히지 않게).

**중요**: `_convert_kpi_cards` 가 마커 있을 때 이미 작동 → autodetect 는 마커 *없을 때만* 발동. 마커 처리 후 호출되므로 자연스럽게 마커 처리된 블록은 이미 `type: "kpi-cards"` 라 autodetect 의 `block["type"] == "table"` 검사에서 skip.

### 1.5 G3 — `_autodetect_gallery`

**Detect rule**:
1. `block["type"] == "image"`.
2. `blocks_after[0]`, `blocks_after[1]` 도 모두 `image` → 즉 연속 3개 이상.

**Emit**: GalleryBlock (Phase 1/2 의 `_convert_gallery` 형태). `meta.auto_detected = True`. `n_consumed` = 연속 image 개수.

**False positive 회피**: 2개 이하의 연속 image 는 일반 image 로 둠 (gallery 의 의미는 "여러 장 묶음" — 2개는 모호).

### 1.6 G4 — `_autodetect_gantt`

**Detect rule** (`_convert_gantt` 와 거의 동일):
1. `block["type"] == "table"`.
2. 헤더에 `name|task|작업|이름` + `start|시작` + `end|종료` 필수.
3. rows 1+개.

**Emit**: Phase 2 의 `_convert_gantt` 와 동일 형태. `meta.auto_detected = True`.

**False positive 회피**: 헤더 정확 매칭. `chart` 의 표 (label + values) 와 헤더가 명확히 달라야 함.

**Chart 와 충돌**: chart 의 표는 `label, series1, series2` 라 첫 컬럼이 label. gantt 는 `name, start, end`. 헤더 단어가 다르므로 자연 분리.

## 2. Generator agent 시방서

### 2.1 G1 — 인프라 + callout

**파일 수정**:
- `apps/api/app/services/widget_markers.py`: `apply_widget_autodetect`, `_autodetect_rewrite`, `_autodetect_callout`, `WIDGET_AUTODETECTORS` 추가. 시그니처는 위 §1.2 에 명시.
- `apps/api/app/services/docx_import.py`: `apply_widget_markers` 호출 직후에 `apply_widget_autodetect(sections, summary)` 추가.
- `apps/api/app/services/pptx_import.py`: 동일.

**테스트**:
- `apps/api/tests/test_widget_autodetect.py` (NEW): 
  - callout 단위 5개: 색 표 → warn/danger/tip/info, 이모지, 라벨, 부정 케이스 (평범 표).
  - docx 라운드트립 1개.

**제약**: G2/G3/G4 의 영역 함수 (kpi/gallery/gantt) 만지지 말 것.

### 2.2 G2 — kpi-cards autodetect

**파일 수정**: `widget_markers.py` 에 `_autodetect_kpi_cards` 추가. dispatcher 등록은 메인 thread 가.

**테스트**: 단위 4-5개 (마커 없을 때 인식, 마커 있으면 skip, label/value 누락 표는 None, 5+행 표는 None).

### 2.3 G3 — gallery autodetect

**파일 수정**: `widget_markers.py` 에 `_autodetect_gallery` 추가.

**테스트**: 단위 4-5개 (연속 3+ image, 2 image 는 None, image + paragraph + image 는 None, 변환된 gallery 의 items 매칭).

### 2.4 G4 — gantt autodetect

**파일 수정**: `widget_markers.py` 에 `_autodetect_gantt` 추가.

**테스트**: 단위 4-5개 (영문 헤더, 한글 헤더, 누락 컬럼 → None, chart-style 헤더 (label+values) → None).

### 2.5 V1 — Sonnet 검증

**범위**:
- 4 autodetector 함수의 schema 적합성.
- `apply_widget_autodetect` 의 walk + dispatcher 정확성 (off-by-one 없음, 무한루프 가드).
- False-positive 가드: 평범 1행 표, 평범 2-img 시퀀스, 평범 N-col 표가 위젯으로 잘못 변환되지 않음.
- Marker 처리 결과와의 충돌 없음.
- 회귀: Cycle X 의 round-trip 13 + 자체 신규 테스트 모두 통과.

## 3. 메인 thread 책임

1. G1 완료 후 G2/G3/G4 병렬 발사.
2. 메인 통합: G2/G3/G4 의 함수를 `WIDGET_AUTODETECTORS` 리스트에 등록.
3. 전체 pytest 회귀 확인.
4. V1 발사.
5. V1 finding 처리.
6. analysis / report / archive / commit / push.

## 4. Definition of Done

- `apply_widget_autodetect` 작동, 4 autodetector 등록.
- 5종 자동 인식 모두 단위 + 통합 테스트 통과.
- False-positive 가드 통과.
- 마커 있는 케이스 회귀 0 (Cycle X 13 round-trip).
- 전체 pytest 회귀 0.
- typecheck / openapi drift 0.
- lat 갱신.
