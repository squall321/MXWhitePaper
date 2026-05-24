# Image Annotation BG Editor — Planning Document

> **Summary**: image-annotation-label-bg 사이클이 schema + render 만 처리하고
> editor UI 는 후속으로 미룬 부분. callout 도구 선택 시 toolbar 에 bgColor swatch
> 3개 (default 흰색 / 다크 / 강조 노랑) 추가.
>
> **Date**: 2026-05-24

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | image-annotation-label-bg 사이클로 callout `bgColor?` schema + render 분기 추가했지만 editor UI 부재 → 사용자가 raw JSON 편집해야 함 = 사실상 비활성 기능. |
| **Solution** | ImageAnnotationBlockEditor toolbar에 callout 도구 선택 시만 보이는 `<CalloutBgSwatch>` 3개 추가. default(흰색) / `#111827`(다크) / `#fef3c7`(강조 노랑). `buildCallout` 시그니처에 optional bgColor 4번째 인자 추가, undefined 시 schema에 키 자체 미저장 (default 보존). |
| **Function/UX Effect** | callout 도구 선택 시 toolbar에 `bg:` 라벨 + 3 swatch 노출. 사용자 클릭으로 다음 callout 부터 bgColor 적용. default(흰색)는 dashed border로 시각적 구분. |
| **Core Value** | "schema 활성화 — 실제 사용 가능 기능으로" — 후속 미룸 정책의 실제 닫기. 사용자가 밝은 이미지 위 callout 가독성 직접 해결 가능. |

## Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | swatch 노출 조건 | `tool === 'callout'` 일 때만 (다른 도구 일 때 toolbar 노이즈 0) |
| 2 | swatch 3개 | default(undefined → 흰색) / `#111827`(다크) / `#fef3c7`(amber-100, 강조) |
| 3 | default swatch 시각 구분 | dashed border (다른 활성 색 = solid border) |
| 4 | state 위치 | ImageAnnotationBlockEditor 내부 `calloutBgColor` useState (undefined default) |
| 5 | buildCallout 시그니처 | optional 4번째 인자 `bgColor?` — 호환 보장 |
| 6 | undefined → schema | `...(bgColor ? { bgColor } : {})` spread — 키 자체 미저장 |
| 7 | data attribute | `data-callout-bg={value ?? 'default'}` 테스트/E2E 용 |
| 8 | matchRate | 90% |

## AC

1. callout 도구 활성화 시 toolbar에 bgColor swatch 그룹 노출
2. 그 외 도구 (arrow/rect/textbox/select) 일 때는 안 보임
3. swatch 클릭으로 `calloutBgColor` state 갱신
4. 새 callout 생성 시 state 가 buildCallout에 전달
5. undefined 시 schema에 bgColor 키 미저장 (default 보존)
6. 명시 색 시 schema에 bgColor 저장
7. 단위 테스트 — buildCallout 호환 + bgColor 저장 (2)
8. lat documents.md 갱신 (image-annotation-bg-editor 사이클 명시)
9. 회귀 0
10. 사이클 보고서 + archive

## Estimate

| 작업 | 시간 |
|---|---|
| buildCallout 시그니처 확장 + 호출처 + state | 10분 |
| toolbar swatch UI (CalloutBgSwatch 컴포넌트) | 15분 |
| 단위 테스트 2 신설 | 5분 |
| typecheck + vitest | 5분 |
| lat 갱신 + commit + archive | 10분 |
| **합계** | **~45분** |
