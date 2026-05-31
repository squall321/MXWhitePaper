# flow-excalidraw-viewer — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | D1 — FlowBlock Excalidraw 엔진 읽기 전용 렌더러 |
| **Completion** | 2026-05-30 |
| **Match Rate** | 100% (FLOW-01 Sprint-7 갭 해소) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Excalidraw 엔진 FlowBlock 은 viewer 가 raw JSON `<pre>` 덤프로 떨어졌고, editor 는 silent 하게 mermaid 로 재작성하던 갭 (FLOW-01 + FLOW-02 의 연결 마무리). 미수입 데이터 시각화 불완전 |
| Solution | `@excalidraw/excalidraw` 의 헤드리스 `exportToSvg` lazy chunk 로 분리, FlowBlock viewer 에 `ExcalidrawFlow` 컴포넌트 추가. mermaid 패턴 미러 — lazy load + theme 반응 + WidgetExportMenu (PNG/SVG) |
| Function/UX | Excalidraw scene JSON 정상 SVG 렌더. dark 모드는 `appState.theme='dark' + exportWithDarkMode` 자동 토글. width/height 제거로 컨테이너 폭 추종. parse / shape 두 단계 에러 그레이스풀 메시지 |
| Core Value | FlowBlock 의 두 엔진 모두 동등 — 이제 mermaid 와 excalidraw 어느 쪽이든 viewer 정상. block audit C5 FLOW-01 (defer-L) 트랙 회수 |

## 변경

### 1) viewer 컴포넌트 — `apps/web/src/components/blocks/FlowBlock.tsx`

- `parseExcalidrawScene` 순수 helper export (parse / shape / null primitive 검증)
- `loadExcalidraw()` lazy chunk loader (mermaid 패턴 일관)
- `ExcalidrawFlow` 컴포넌트 — useEffect 에서 helper → lazy import → `exportToSvg`
- SVG width/height 제거 + `style="max-width:100%;height:auto"`
- dark 모드: `appState.theme` + `exportWithDarkMode`
- 에러 분기: parse 실패 (raw JSON.parse 메시지) vs shape 실패 (`__SHAPE__` 센티넬 → 로컬라이즈)
- 기존 MermaidFlow 의 한국어 하드코딩도 같이 i18n 화 (block.flow.mermaidError / rendering)

### 2) 의존성 — `apps/web/package.json`

- `@excalidraw/excalidraw ^0.18.1` 신규 (dynamic import 만 사용 → 메인 번들 영향 0)

### 3) chunk 분리 — `apps/web/vite.config.ts`

- `manualChunks` 에 `@excalidraw/excalidraw` + `roughjs` → `excalidraw` chunk
- 결과: vendor 7.6 MB → 3.9 MB, `excalidraw` 3.7 MB 별도 lazy chunk (excalidraw 미사용 사용자 영향 0)

### 4) i18n — 4 신규 키 (ko/en)

- `block.flow.mermaidError` — 'Mermaid 렌더 실패: {err}'
- `block.flow.excalidrawError` — 'Excalidraw 렌더 실패: {err}'
- `block.flow.excalidrawShape` — '잘못된 Excalidraw scene — `elements` 배열이 필요합니다.'
- `block.flow.rendering` — 'flow 렌더링 중…'

### 5) lat — `docs/lat/documents.md`

- FlowBlock 항목 갱신: 두 엔진 모두 정적 SVG / lazy chunk / dark 토글 명세 / FLOW-02 read-only editor 참조

### 6) 테스트

- `FlowBlock.excalidraw.test.tsx` 신규 6 단위 (valid scene / parse 오류 / shape 오류 / array 아님 / primitive / appState files 옵션)
- `AllBlocksRender.test.tsx` 에 `flow-excalidraw` fixture 추가 + snapshot

## 검증

- typecheck: clean
- vitest: **2388 / 2388** (+6 신규 + 1 fixture)
- vite build: 통과, excalidraw chunk 3.7 MB 별도 lazy 로 분리 — 메인 path 영향 0
- mermaid snapshot 도 i18n 갱신 반영 (의도)

## 작업 방식

- excalidraw package 4 MB → 풀 Excalidraw 캔버스가 아니라 헤드리스 `exportToSvg` 만 사용 → 안전
- mermaid 패턴 그대로 미러 (lazy + theme + 에러 fallback) → 정합성
- helper 분리 → SSR-only 테스트 환경에서 검증 가능 (repo 컨벤션 — no @testing-library/react)

## 후속

- FlowBlockEditor "Excalidraw 새로 만들기" insert UX — 별도 사이클 (현재는 import / API direct 진입만 지원). 본 사이클은 viewer 정상 작동만 보장
- exportToSvg 가 외부 font 인라이닝 시도 → 일부 환경에서 font 요청 실패할 수 있음. 발견 시 `skipInliningFonts: true` 옵션 검토
- 다음 D2: viewer i18n 일괄
