# flow-excalidraw-editor — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | E1 — Sprint-7 Excalidraw 인라인 편집기 (FlowBlockEditor) |
| **Completion** | 2026-05-31 |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | D1 에서 Excalidraw 엔진 viewer 만 정상화 — editor 는 amber notice ("이 블록은 read-only") 로 표시되어 사용자가 인라인 편집 불가. import 또는 API direct 경로로만 진입 가능했음 |
| Solution | `FlowExcalidrawEditor` 컴포넌트 신설 — `React.lazy()` 로 `<Excalidraw>` 캔버스 컴포넌트 + index.css 동적 import. onChange 800 ms debounce → `patchBlock({engine:'excalidraw', source: serialiseScene(scene)})`. parse 실패 시 빈 캔버스 fallback + recovery banner ("초기화" 버튼) |
| Function/UX | 사용자가 FlowBlock 의 두 엔진 (mermaid / excalidraw) 어느 쪽이든 인라인 편집 가능. dark 모드 자동 동기화 (theme prop). 저장 상태 표시 (저장 중… / N시 N분 N초에 저장됨). FLOW-02 의 데이터 손실 가드 (engine 자동 재작성 금지) 유지 |
| Core Value | FlowBlock 의 두 엔진이 viewer + editor 모두 동등 — Sprint-7 의 핵심 작업 완료. 외부 LLM 산출 excalidraw 데이터 + 사용자 인라인 편집 양쪽 지원 |

## 변경

### 1) 신규 컴포넌트 — `apps/web/src/features/editor/blocks/FlowExcalidrawEditor.tsx`

- `React.lazy()` 로 `@excalidraw/excalidraw` 의 `Excalidraw` named export +
  `index.css` 동적 import → lazy chunk `excalidraw` (~3.7 MB) 재활용
  (D1 의 viewer 와 같은 chunk, Rollup dedupe)
- initialData 에 `block.source` 파싱 결과 주입 (`parseExcalidrawScene` 재사용)
- onChange 에서 `{elements, appState, files}` 수집 → 800 ms debounce →
  `serialiseScene` → `patchBlock`. engine 명시적 `'excalidraw'` 보존 (FLOW-02)
- 다른 탭에서 같은 블록 편집 시 `savedOnceRef` 가 false 인 동안만
  initial 재반영 (로컬 사용자가 시작하기 전에만 외부 변경 흡수)
- parse 실패 → `parseError` state + recovery banner ("초기화" 버튼 → 빈 캔버스
  로 즉시 patch). 사용자가 그리기 전까지 서버 source 는 그대로 유지
- 다크 모드: `useResolvedTheme` → `theme` prop. light/dark 자동
- 저장 상태: "저장 중…" / "{time}에 저장됨" / 충돌 시 i18n 메시지
- UIOptions: saveFileToDisk / loadScene / toggleTheme 비활성 (in-editor 일관성)
- `serialiseScene` export — 단위 테스트용 (parse↔serialise round-trip)

### 2) `FlowBlockEditor.tsx`

- `FlowExcalidrawReadonly` (D1 의 amber placeholder) 제거
- `engine === 'excalidraw'` 분기 → `<FlowExcalidrawEditor>` 마운트

### 3) i18n — 6 신규 키 ko/en

- `editor.flow.excalidrawLoading` — 'Excalidraw 에디터를 불러오는 중…'
- `editor.flow.excalidrawLoadFailed` — load 실패 메시지
- `editor.flow.excalidrawParseError` — 손상 데이터 복구 안내
- `editor.flow.excalidrawReset` — '빈 캔버스로 초기화'
- `editor.flow.excalidrawSavedAt {time}` — '{time}에 저장됨'
- `editor.flow.excalidrawSaving` — '저장 중…'

기존 `editor.flow.excalidrawReadonly` 는 fallback 용으로 유지 (engine 값이
'mermaid'/'excalidraw' 외 알 수 없는 enum 으로 들어올 미래 경우 대비, 현재는 미사용).

### 4) lat — `docs/lat/documents.md`

- FlowBlock 항목 갱신: 두 engine 모두 viewer + editor 분기 명세,
  Sprint-7 editor 동작 (lazy mount + 800 ms debounce + parse 실패 fallback +
  dark 동기화)

### 5) 테스트 — `FlowExcalidrawEditor.test.ts` 4 신규

- `serialiseScene` 의 envelope (type/version/source/elements/appState/files)
- `parseExcalidrawScene` ↔ `serialiseScene` round-trip
- appState/files 미명시 시 기본값 `{}`
- 동일 scene 반복 호출 시 동일 출력 (debounce dedupe 키로 안전)

SSR-only 테스트 패턴 — Excalidraw 캔버스 마운트는 DOM 필요, 별도 e2e 사이클로 defer.

## 검증

- typecheck: clean
- vitest: **2402 / 2402** (+4 신규)
- vite build: 통과. excalidraw chunk 3.7 MB 그대로 lazy 분리, block-flow chunk
  에 FlowExcalidrawEditor 모듈만 포함 (캔버스 lib 은 lazy chunk)
- vendor / main bundle 영향 0

## 작업 방식

- D1 의 viewer 측 `parseExcalidrawScene` pure helper 재사용 → editor 가 동일
  검증 로직을 거치므로 viewer/editor 일관성
- D1 의 `excalidraw` chunk 와 동일한 lib 사용 → Rollup dedupe (편집/뷰 모두
  같은 lazy chunk 한 번 로딩)
- pure helper `serialiseScene` 분리 → SSR-only 테스트로 검증 가능

## Defer / 후속

- 캔버스 실제 동작 검증 (Excalidraw 컴포넌트 마운트 + 도구 사용 + 저장) 은
  Playwright E2E 사이클로 defer
- libraryReturnUrl / UIOptions.canvasActions 확장 (export 도구 활성화 등) 은
  사용자 피드백 후 단계적
- Excalidraw scene 안의 외부 image binary (`files`) 가 큰 경우 (>5 MB)
  patchBlock payload 캡 검토 — 현재는 캡 없음

## 다음 단계

- 다음 큰 트랙은 사용자 결정에 위임 — LLM 위젯 가이드 보강 / Pivot Sprint 5+ /
  새 트랙 등
