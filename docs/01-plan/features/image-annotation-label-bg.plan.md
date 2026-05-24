# Image Annotation Label BG — Planning Document

> **Summary**: ImageAnnotation callout 라벨의 `fill="white"` 하드코딩
> (svg-block-audit 의도 예외) 에 사용자 override `bgColor?` 추가. schema +
> render 만 — editor UI는 후속.
>
> **Date**: 2026-05-24

## Executive Summary

| Perspective | Content |
|---|---|
| **Problem** | callout 라벨 흰 배경이 *밝은 이미지* 위에서 묻힘 (예: 흰 배경의 다이어그램). svg-block-audit는 가독성 보장 (사용자 ann.color 무관)을 우선해 흰색 유지로 결정했으나, 사용자 override 옵션 없어 일부 케이스 처리 못함. |
| **Solution** | callout schema에 `bgColor?: string` 추가 (optional). 미지정 시 default `white` 유지 (기존 동작 보존). render는 `ann.bgColor ?? 'white'`. editor UI는 후속 사이클 — 현재 사용자는 raw JSON 편집으로 설정. |
| **Function/UX Effect** | 사용자가 callout bgColor를 설정한 경우 그 색 사용. 밝은 이미지 위 다크 callout 가능. 기존 callout 영향 0. |
| **Core Value** | "의도 예외에 *escape hatch* 추가" — svg-block-audit의 견고한 default 유지 + 드문 케이스 사용자가 직접 해결. |

## Decisions

| # | 결정 | 값 |
|---|---|---|
| 1 | schema 위치 | callout variant `color` 옆 |
| 2 | optional | yes (default white 보존) |
| 3 | editor UI | out-of-scope — 후속 사이클 |
| 4 | 테스트 | 2 (default white + bgColor override) |
| 5 | matchRate | 90% |

## Acceptance Criteria

1. **C1**: callout schema에 `bgColor?: string` optional
2. **C2**: render에서 `ann.bgColor ?? 'white'` 분기
3. **C3**: 기존 callout (bgColor 없음) 영향 0
4. **C4**: 테스트 2 (default + override)
5. **C5**: 회귀 0
6. **C6**: lat 갱신 (의도 예외 + escape hatch 명시)
7. **C7**: 사이클 보고서 + archive

## Estimate

| 작업 | 시간 |
|---|---|
| schema + schema:gen | 5분 |
| render 1줄 | 2분 |
| 테스트 2 + lat 갱신 | 10분 |
| commit + archive | 5분 |
| **합계** | **~25분** |
