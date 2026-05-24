---
template: report
version: 1.0
feature: image-annotation-bg-editor
date: 2026-05-24
---

# Image Annotation BG Editor — Completion Report

> Match Rate: 100% / Duration: ~35분 (예상 45분, ⌀ 22% 효율)

## Value Delivered

| Perspective | Content |
|---|---|
| **Problem** | image-annotation-label-bg 사이클이 schema + render 만 처리하고 editor UI 부재 → 사용자가 raw JSON 편집해야 bgColor 설정 가능 = 사실상 비활성. |
| **Solution** | ImageAnnotationBlockEditor toolbar에 callout 도구 활성화 시만 보이는 `<CalloutBgSwatch>` 3개 추가. default(흰색) / 다크 / 강조 노랑. `buildCallout` 시그니처에 optional 4번째 인자 bgColor 추가. undefined 시 schema 키 미저장 (default 보존). |
| **Function/UX Effect** | callout 도구 선택 시 toolbar에 `bg:` 라벨 + 3 swatch 노출. 사용자 클릭으로 다음 callout부터 bgColor 적용. default(흰색)는 dashed border 시각적 구분. 다른 도구 시 노이즈 0. |
| **Core Value** | "schema → render → UI 3단계 완성" — *후속 미룸* 정책의 실제 닫기. 사용자가 밝은 이미지 위 callout 가독성 직접 해결 가능. |

## What was Built

- `ImageAnnotationBlockEditor.tsx`:
  - `calloutBgColor` useState (undefined default)
  - `buildCallout(pos, text, color, bgColor?)` 시그니처 확장
  - toolbar에 callout 도구 시만 보이는 swatch 그룹 (3 swatch)
  - `<CalloutBgSwatch>` 헬퍼 컴포넌트 (default dashed border 구분)
  - `data-callout-bg` attribute (테스트 anchor)
- 단위 테스트 2 신설 (호환 + bgColor 저장)
- `docs/lat/documents.md` ImageAnnotation entry 갱신 (3단계 완성 명시)

## Not Built (yagni)

| 항목 | 사유 |
|---|---|
| color picker (임의 hex) | 3 preset이 충분 (요청 시 추후) |
| 기존 callout 편집 시 bgColor 변경 | 본 사이클은 *새 callout 생성*만. 기존 편집은 select 도구 + 별도 패널 필요 |
| textbox에도 bgColor | textbox는 이미 다른 background 처리. yagni |
| i18n 라벨 ('bg:', '기본 (흰색)', etc.) | 한국어 직접 명시 — i18n 키 추가는 별도 |

## Open Items

| # | 항목 |
|---|---|
| 1 | 기존 callout 편집 시 bgColor 변경 UI (select 도구 + floating panel) |
| 2 | 임의 color picker (`<input type="color">`) |
| 3 | i18n 키 추가 (`editor.ia.bgGroup`, `editor.ia.bgDefault` 등) |
| 4 | E2E spec 추가 (callout 생성 + bgColor 클릭 → schema 저장 검증) |

## Status

- ✅ All phases done
- ⏳ Archive
- 🎯 chart-recharts-palette + image-annotation-bg-editor 두 사이클 완료. Whiteboard escape hatch는 사용자 요청 시
