# form-validation-cycle4 — Completion Report

## Executive Summary

| Perspective | Content |
|---|---|
| **Feature** | FormQuestion data validation Phase 1 — schema-driven min/max/length/pattern 검증 (BE + FE 대칭) |
| **Completion** | 2026-05-29 |
| **Match Rate** | **100%** |
| **Tests** | +11 pytest (BE) + +13 vitest (FE), 회귀 0 |
| **Regression** | 0건 |

### Value Delivered

| Perspective | Outcome |
|---|---|
| **Problem** | Form/Quiz 의 question 에 *형식 검증* 이 없었다. number/text 필드에 잘못된 값이 들어와도 BE 가 그대로 저장. FE 도 사용자 입력 즉시 오류를 알려주지 못해 제출 후 실패 메시지로만 확인 가능. workflow audit 우선순위 매트릭스의 마지막 미해소 항목. |
| **Solution** | schema 에 5 optional 키 add-only (`min` / `max` / `minLength` / `maxLength` / `pattern`) → BE `forms.py` `_validate_answer` 헬퍼 3종으로 분기 검증 → FE `FormBlock` `validateAnswers` + `compilePattern` 으로 동일 룰 미러링 → `FormBlockEditor` 에서 question type 별 conditional input 으로 룰 입력 UX. |
| **Function/UX Effect** | Question 작성자가 "0~100 사이 숫자만" / "최소 10자" / "이메일 정규식" 같은 룰을 GUI 로 지정. 사용자는 입력 즉시 인라인 에러, 제출 시 BE 가 동일 룰로 재검증해 우회 방지. |
| **Core Value** | *데이터 무결성* — Form 응답을 후속 분석/리포트에 그대로 쓸 수 있게 된다. BE/FE 대칭은 보안 (FE 우회 차단) + UX (즉시 피드백) 동시 충족. |

## 세부 변경

### Schema (add-only)

- `packages/shared/schemas/document.json` — FormQuestion 에 5 optional 추가
  - `min?: number` / `max?: number` — number/range 타입용
  - `minLength?: number` / `maxLength?: number` — text/textarea 용
  - `pattern?: string` — 정규식 (ReDoS 가드: 200자 cap + compile fail graceful)
- `apps/api/app/schemas/document.py` — pydantic 모델 동기화
- `apps/web/src/types/document.ts` — TS 타입 동기화

### BE — apps/api/app/routers/forms.py

- `_validate_answer_number(value, question)` — min/max 범위 + 숫자형 강제
- `_validate_answer_text(value, question)` — minLength/maxLength + 문자열 강제
- `_validate_answer_pattern(value, question)` — re.compile try/except, 200자 cap 초과 시 skip
- `submit_form_response` 분기에서 위 3종을 question.type 별 호출
- 실패 시 `400 Bad Request` envelope `{ field, code, message }`

### FE — apps/web/src/components/blocks/FormBlock.tsx

- `validateAnswers(form, answers)` pure — BE 와 동일 룰 미러
- `compilePattern(src)` — BE 와 동일 가드 (200자 cap, try/catch, 실패 시 null)
- submit 핸들러가 invalid 시 인라인 에러 표시 + 서버 호출 차단

### FE — apps/web/src/features/editor/blocks/FormBlockEditor.tsx

- question type 별 conditional input 그리드
  - number/range → min / max
  - text/textarea → minLength / maxLength + pattern
  - 그 외 type → 룰 입력 미노출 (UI 잡음 방지)
- pattern 입력 시 invalid regex 라이브 미리 검증 (200자 cap 메시지 포함)

### Docs

- `docs/lat/documents.md` — FormQuestion 검증 룰 + `_validate_answer*` 헬퍼 시그니처 + ReDoS 가드 정책 명시

## 구현 위치

| Layer | File | Δ |
|---|---|---|
| Schema | `packages/shared/schemas/document.json` | +7/-1 |
| Schema | `apps/api/app/schemas/document.py` | +20 |
| Schema | `apps/web/src/types/document.ts` | +20 |
| BE | `apps/api/app/routers/forms.py` | +73 |
| BE 테스트 | `apps/api/tests/test_form_validation.py` (신규) | +102 |
| FE | `apps/web/src/components/blocks/FormBlock.tsx` | +39 |
| FE | `apps/web/src/features/editor/blocks/FormBlockEditor.tsx` | +63 |
| FE 테스트 | `apps/web/src/components/blocks/__tests__/FormBlock.test.tsx` | +77 |
| FE 테스트 | `apps/web/src/features/editor/blocks/__tests__/FormBlockEditor.test.tsx` | +58 |
| Docs | `docs/lat/documents.md` | +10 |

## 테스트

| 단계 | 결과 |
|---|---|
| typecheck (web) | clean |
| api pytest | +11 신규 (`test_form_validation.py`), 회귀 0 |
| web vitest | +13 신규 (FormBlock 7 + FormBlockEditor 6), 회귀 0 |

## 후속

- Cycle 5 — Form 응답 export (CSV + JSON) 위젯 export 매트릭스 (Cycle 3) 통합
- Quiz 의 grading 로직과 validation 룰 cross-check (현재 분리)
- pattern 라이브러리화 — email/URL/phone 프리셋 dropdown (현재 raw regex 입력만)
- workflow audit 우선순위 매트릭스 종료 — 이번 사이클이 마지막 항목
