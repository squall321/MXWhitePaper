# editor-i18n-finalize — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | D4 — QuizBlockEditor 전체 useT + FormBlock validateAnswers error code refactor |
| **Completion** | 2026-05-31 |
| **Match Rate** | 100% (QUIZ-01 + FormBlock pure 함수 한국어 누수 해소) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | QuizBlockEditor (4 컴포넌트) 가 한국어 literal 30+ 박힘 (audit C5 QUIZ-01 M-effort defer). FormBlock validateAnswers 가 한국어 문자열 직접 반환 — pure 함수라 useT 못 호출하는 구조적 결함 (audit C5 D2 defer) |
| Solution | QuizBlockEditor 4 컴포넌트 (QuizBlockEditor + QuestionRow + CorrectInput + AttemptsModal) useT 도입. FormBlock validateAnswers → FormError discriminated union (10 codes) + formatFormError 헬퍼 분리 — pure 함수는 locale-free, view 가 t() 매핑 |
| Function/UX | EN locale 에서 QuizBlockEditor 의 모든 UI (label/placeholder/aria/columns/empty/loading/headings) 영어 표시. FormBlock 의 11 validation error 모두 영어 표시. 외부 BE error message 도 localized fallback |
| Core Value | block audit C5 의 마지막 defer 항목 2건 해소 — editor + viewer 양쪽 모두 i18n 완전 일관성 |

## 변경

### 1) QuizBlockEditor — useT 도입

`apps/web/src/features/editor/blocks/QuizBlockEditor.tsx`

- `KIND_LABELS` (module-scope ko literal map) → `KIND_LABEL_KEYS` (i18n key map),
  Select 의 option text 에서 `t(KIND_LABEL_KEYS[k])` 호출
- QuizBlockEditor 본체: changeLog / conflictError / title/description
  placeholder / view attempts button / addQuestion button / passingScore
  label / maxAttempts label / shuffle label / showAnswers label
- QuestionRow: drag aria / question placeholder / points aria / delete
  button / options placeholder / correct label / explanation label
- CorrectInput: shortText placeholder / tfYes/tfNo / single pick option
- AttemptsModal: modal title / loading / histogram heading + empty /
  accuracy heading + empty / list heading + empty / 5 table columns /
  anonymous fallback

총 30+ literal → t() 호출. data-default 한국어 (`'새 문제'`, `'옵션 1'`,
`'옵션 2'`) 는 사용자 콘텐츠 데이터로 분류 — 유지.

### 2) FormBlock — error code refactor

`apps/web/src/components/blocks/FormBlock.tsx`

- 신규 `FormError` discriminated union — 10 codes:
  required / invalidEmail / numberOnly / numberMin (+ min) / numberMax
  (+ max) / rating1to5 / dateFormat / minLength (+ minLength) / maxLength
  (+ maxLength) / patternMismatch
- `validateAnswers` 시그니처 변경: `Record<string, string>` →
  `Record<string, FormError>` — pure 함수는 locale-free 유지
- 신규 `formatFormError(t, err)` 헬퍼 — error code 를 localized string
  으로 변환. switch exhaustive (모든 union arm 처리)
- `FormBlockView`: errors state 타입 변경, `update()` 가 error 제거 시
  delete (empty string 대신), Field error prop 에 `formatFormError` 호출
- 추가 한국어 literal 도 같이 i18n: '다시 응답하기' / docUnidentified /
  submitFailed

### 3) i18n — 41 + 12 = 53 신규 키 (ko/en)

- `editor.quiz.*` — 41 키 (kind / placeholders / labels / aria / row /
  correctInput / attempts table 등)
- `block.form.error.*` — 10 키 (validation codes), placeholder {min}
  {max} {minLength} {maxLength}
- `block.form.*` — 추가 button.respondAgain / error.docUnidentified /
  error.submitFailed 3 키

### 4) 테스트 갱신

`apps/web/src/components/blocks/__tests__/FormBlock.test.tsx`

- `.toMatch(/최소/)` 등 한국어 정규식 매칭 → `.toEqual({ code: 'numberMin', min: 18 })`
  등 code 비교 (총 5 케이스)
- 다른 테스트는 `.toBeTruthy()` / `.toEqual({})` 패턴이라 호환

## 검증

- typecheck: clean
- vitest: **2394 / 2394** — useT default ko 라 SSR snapshot 영향 0,
  validateAnswers code 비교 갱신 테스트 통과
- FormBlockView SSR test (한국어 literal 검증 — 폼 제목/설명입니다./제출)
  도 통과 (default ko render)

## 작업 방식

- audit C5 의 QUIZ-01 (M defer) 와 D2 의 FormBlock validateAnswers
  (refactor 필요로 defer) 를 D4 단일 사이클로 묶어 처리
- pure 함수 i18n 패턴 정착 — 다른 pure helper (예: spreadsheet
  formula error) 도 동일 패턴 적용 가능

## 다음 단계

- D5: UX 폴리시 + lat sweep (마지막 사이클)
