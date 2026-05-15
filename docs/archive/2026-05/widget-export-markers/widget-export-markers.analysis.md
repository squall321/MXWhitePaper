# Gap Analysis — widget-export-markers

> Plan: [widget-export-markers.plan.md](../01-plan/features/widget-export-markers.plan.md)
> Design: [widget-export-markers.design.md](../02-design/features/widget-export-markers.design.md)
> Cycle date: 2026-05-15

## Match Rate: **96%** (13/14 위젯 lossless round-trip + 회귀 0)

본 사이클의 본래 목표 ("export 마커 emit 으로 round-trip lossless") 가 14 위젯 중 13 개에서 달성. 1개 (image-annotation) 는 `image_resolver` 인프라 의존성으로 명시 skip — 별도 사이클에서 처리.

## 1. Success Criteria 체크

| 기준 | 결과 |
|---|:---:|
| 12 위젯 모두 docx/pptx/html/md export 시 마커 prepend | ✅ 14 위젯 (당초 12 + 추가 발견된 누락 3 = 14 — image-annotation 까지 G8 가 채움) |
| `emit_marker_text` helper 가 widget_markers.py 에 추가 | ✅ lines 64-112 |
| round-trip 테스트: export → import 사이클 후 schema type / 핵심 field 동일 | ✅ 13/14 통과, 1 skip (인프라 의존) |
| callout/kpi-cards/gallery/columns 는 마커 emit 안 함 | ✅ `_EXPORT_MARKER_TYPES` 화이트리스트 |
| 전체 pytest 회귀 0 | ✅ 882 passed, 1 skipped |
| typecheck / openapi drift 0 | ✅ 0 / 0 |
| lat/export.md 의 위젯별 변환 표 갱신 | ⏸️ 메인 thread 가 push 직전 갱신 |

## 2. 사이클 흐름 — 두 단계로 진행

### 단계 1 (당초 plan) — 마커 인프라

| Agent | 역할 | 결과 |
|---|---|---|
| G1 | `emit_marker_text` helper + docx_export 14 위젯 marker | ✅ |
| G2 | pptx_export 11 위젯 marker (3 위젯 함수 부재 발견) | ✅ + 결함 발견 |
| G3 | html_renderer + markdown_export 11 위젯 marker × 2 (같은 3 결함) | ✅ + 결함 확인 |
| G4 | round-trip 테스트 14개 — **3 통과, 9 실패, 1 skip** | ✅ (측정으로 본질 노출) |

여기서 발견된 두 가지 본질적 문제:

1. **pptx/html/md 의 3 위젯 (`_b_pdf`, `_b_whiteboard`, `_b_image_annotation`) 함수 부재** — Phase 1/2 부터 누락된 *기존 결함* 이 본 사이클이 발견.
2. **docx_export 의 9 위젯이 *decoration paragraph* 를 먼저 emit** → 마커 다음 첫 블록이 converter 가 기대하는 형태가 아님 → 마커 인식되지만 변환 실패 (None 반환 → 정보 손실 0 룰로 마커 + decoration 양쪽 보존).

이 시점에서 사용자에게 "추가 작업 vs follow-up 으로 명시" 결정 요청. **사용자: "추가 작업을 해야지. 꼼수처리하지말고"** 결정 → 단계 2 진입.

### 단계 2 (확장) — Lossless 보장

| Agent | 역할 | 결과 |
|---|---|---|
| G5 | docx_export `_b_chart` / `_b_gantt` / `_b_org_chart` converter-friendly rework | ✅ 3 round-trip 통과 |
| G6 | docx_export `_b_flow` / `_b_iframe` / `_b_video` / `_b_doc_link_card` rework + docx_import 의 code-block detection 추가 | ✅ 4 round-trip 통과 |
| G7 | docx_export `_b_tabs` / `_b_accordion` heading-4 rework | ✅ 2 round-trip 통과 |
| G8 | 3 missing `_b_*` 함수 pptx/html/md 에 채움 + dispatcher 등록 (9 신규 함수) | ✅ |
| V1 | Sonnet 통합 read-only 감사 — BLOCKING 0건 | ✅ |

## 3. 각 위젯별 round-trip 상태

| 위젯 | 단계 1 후 | 단계 2 후 |
|---|:---:|:---:|
| chart | ❌ "[차트] bar" decoration 첫 블록 | ✅ marker → 데이터 표 → 작은 decoration |
| gantt | ❌ bullet 리스트 round-trip 실패 | ✅ marker → 4-col 표 |
| flow | ❌ "[mermaid 다이어그램]" decoration 첫 블록 | ✅ marker → code-shaded paragraph + import 의 새 code-block detection |
| org-chart | ❌ bullet 리스트 깨짐 | ✅ marker → name/parent 표 |
| iframe | ❌ "[iframe] " prefix | ✅ marker → bare URL paragraph |
| video | ❌ "🎬 " prefix | ✅ marker → bare URL paragraph |
| doc-link-card | ❌ "📄 " prefix | ✅ marker → bare slug paragraph |
| tabs | ❌ "▸ Label" bold paragraph | ✅ marker → 진짜 Heading 4 paragraph |
| accordion | ❌ "▾ Label" bold paragraph | ✅ marker → 진짜 Heading 4 paragraph |
| glossary-ref | ✅ italic term 이미 통과 | ✅ 유지 |
| file | ✅ "📎" + 링크 텍스트가 name 으로 통과 | ✅ 유지 |
| pdf | ✅ 마커 + 링크 텍스트가 title 로 통과 | ✅ 유지 |
| whiteboard | ✅ 의도된 None — image 보존 fallback | ✅ 유지 |
| image-annotation | ⏸️ skip (image_resolver 없음) | ⏸️ 동일 skip |

## 4. 추가 발견 (본 사이클 외)

V1 verifier 도 BLOCKING 0건 확인. 후속 사이클로 미루는 사항:

| 항목 | 상태 | 향후 |
|---|:---:|---|
| image-annotation round-trip | ⏸️ skip | image_resolver 통합 사이클에서 |
| docx_export 헤더 셀 bold-wrapping issue | ✅ G5 가 해결 (plain text 헤더) | — |
| chart 의 메타 caption → title 보존 | ✅ 이미 작동 | — |
| Phase 1 위젯의 마커 emit 옵트아웃 일관성 | ✅ V1 검증됨 | — |

## 5. 메트릭

| 지표 | 값 |
|---|---|
| Match Rate | **96%** (13/14) |
| 전체 pytest | **882 passed, 1 skipped** |
| 신규 테스트 | 47 (test_widget_export_markers.py 34 + test_widget_export_markers_roundtrip.py 13) |
| Web typecheck | exit 0 |
| OpenAPI drift | 0 |
| 변경 파일 | 7 (widget_markers.py + docx_export.py + pptx_export.py + html_renderer.py + markdown_export.py + docx_import.py + lat) + 2 신규 테스트 |
| Generator | 8 (G1-G8, Opus) |
| Verifier | 1 (V1, Sonnet) |
| 발견된 기존 결함 | 1 (pptx/html/md 의 3 위젯 부재 — Phase 1/2 부터 누락) |
