# Widget Integrity Pass 3 — Design Document

> **Plan**: [[../../01-plan/features/widget-integrity-pass-3.plan.md]]
> **Date**: 2026-05-19
> **Status**: Draft

cleanup 사이클이라 2분할 (C1 BE + C2 FE) + sync. pass-1·2 와 동일한 방법론 축소 적용.

---

## 1. C1 — Schema + BE

### 소유 파일
- `packages/shared/schemas/document.json`
- `apps/api/app/schemas/document.py` (자동 regen — pydantic discriminator 추가 시 수동 가능성)
- `apps/api/app/services/docx_export.py`
- (필요 시) BE 신규 테스트 파일

### 작업

#### N1 (schema 부분) — SpacerBlock xl 추가
`document.json` L1245 근처:
```diff
- "size": { "enum": ["sm", "md", "lg"], "default": "md" },
+ "size": { "enum": ["sm", "md", "lg", "xl"], "default": "md", "description": "sm=16px, md=32px(default), lg=64px, xl=128px" },
```

description 도 갱신. regen 으로 TS/pydantic 자동 동기.

#### N2 — list check style round-trip 안정화
`docx_export.py` 의 `_b_list` 분기 (~L283-) 분석:
- 현재: `prefix = "☐ "` 가 paragraph run 으로 emit
- import 쪽 (`docx_import.py`)이 `☐ ` prefix 를 보고 다시 `style:"check"` 로 복원하는가? Design 단계에서 확인. 안전하면 변경 없음 + 회귀 테스트만 추가.

회귀 테스트 (`test_docx_roundtrip.py` 또는 신규 `test_list_check_roundtrip.py`):
```python
def test_list_check_roundtrip():
    block = {"type": "list", "id": ..., "style": "check", "items": ["task A", "task B"]}
    docx_bytes = export(...)
    reimported = import_(docx_bytes)
    assert reimported["blocks"][0]["style"] == "check"
    assert reimported["blocks"][0]["items"] == ["task A", "task B"]  # ☐ prefix 미포함
```

손실 발견되면 dead code 가 아닌 *fix* 로 분기 추가.

#### N3 — image width fallback 정리
`docx_export.py:866-887` 의 `_b_image`:
- 현재 (pass-1 B1 결과): `meta = block.get("meta")` 에서 width 시도하는 fallback 이 남아있을 가능성. schema 가 `block.width` 만이라 dead code.
- 변경: `width_enum = block.get("width")` 만 사용. `meta` 쪽 시도 제거.

회귀 테스트는 pass-1 의 image width 테스트 그대로 사용 (이미 통과 중).

#### N5 — IframeBlock pydantic 직렬화 경고
`schemas/document.py:659` 의 `IframeBlock(RootModel[IframeBlock1 | IframeBlock2])`:
- 경고 원인: union serializer 가 discriminator 없이 left-to-right fallback
- 옵션:
  1. `Annotated[IframeBlock1 | IframeBlock2, Field(discriminator="?")]` — 두 helper class 가 *공통 discriminator field* 없음 → 부적합
  2. `model_serializer` 커스텀 — 복잡
  3. **`filterwarnings`** 로 무시 — pass-2 가 이미 정확 경고 명시. 가장 실용적
- 결정: **#3 채택**. `pyproject.toml` 또는 `conftest.py` 에 `filterwarnings = ["ignore::pydantic.warnings.PydanticSerializationUnexpectedValue"]`. 라이브러리 한계라 코드 변경 부담 ↑.

### 테스트
```bash
apptainer exec instance://mxwp_api bash -lc 'cd /workspace/apps/api && python -m pytest tests/test_schema_widget_pass1.py tests/test_schema_widget_pass2.py tests/test_docx_export.py tests/test_docx_roundtrip.py -v --maxfail=5'
```

신규: spacer xl validate (1), list check roundtrip (1).

---

## 2. C2 — FE Editor + INDEX

### 소유 파일
- `apps/web/src/features/editor/blocks/SpacerBlockEditor.tsx` (수정)
- `apps/web/src/features/editor/blocks/FormBlockEditor.tsx` (혹은 유사 이름) — N4
- `apps/web/src/features/editor/blocks/QuizBlockEditor.tsx` — N4
- `apps/web/src/features/editor/blocks/__tests__/*.test.tsx` (회귀)
- `docs/archive/2026-05/_INDEX.md` (N6)

### 작업

#### N1 (FE) — SpacerBlockEditor xl 옵션
B2 schema 완료 후 dropdown 에 xl 추가:
```diff
  <option value="sm">sm (16px)</option>
  <option value="md">md (32px) - default</option>
  <option value="lg">lg (64px)</option>
+ <option value="xl">xl (128px)</option>
```

테스트 갱신: pass-1 의 SpacerBlockEditor.test.tsx 의 dropdown options 검증 (4개로).

#### N4 — form/quiz 기본값 학습
신규 헬퍼 `apps/web/src/features/editor/utils/blockDefaults.ts`:
```ts
const KEY = (blockType: string) => `mxwp-block-defaults-${blockType}`

export function rememberFieldDefaults<T>(blockType: string, partial: Partial<T>): void {
  try {
    const existing = JSON.parse(localStorage.getItem(KEY(blockType)) ?? '{}')
    localStorage.setItem(KEY(blockType), JSON.stringify({ ...existing, ...partial }))
  } catch { /* ignore */ }
}

export function loadFieldDefaults<T>(blockType: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY(blockType)) ?? '{}') }
  } catch { return fallback }
}
```

FormBlockEditor 의 "필드 추가" 핸들러:
- 추가 시: `loadFieldDefaults('form-field', { kind: 'text', required: false })` 로 초기화
- 수정 시: 마지막 변경된 `kind`/`required` 만 `rememberFieldDefaults`

QuizBlockEditor 도 동일 (마지막 `type` (single/multi) 기억).

#### N6 — INDEX.md markdownlint MD060 fix
`docs/archive/2026-05/_INDEX.md` 전체 재포맷:
- 모든 `|---|` → `| --- |` (spaced)
- 모든 `| col |` → `| col |` (pipe-space-content-space-pipe)

수동 패치 1회.

### 테스트
```bash
cd /home/koopark/claude/MXWhitePaper/apps/web && pnpm test
```

신규: spacer xl 옵션 (1), blockDefaults helper (2), form 필드 기본값 (1), quiz 기본값 (1).

---

## 3. Sync (직렬, C1+C2 후)

### 작업
- `docs/lat/documents.md`: spacer xl, image width 단일 출처 명시
- `docs/llm-input-rules.md` + dist 복제: 동기
- RAG re-chunk
- 통합 회귀 (pass-2 와 동일 패턴)
- `docs/03-analysis/widget-fix-pass-3/summary.md`

---

## 4. Acceptance — Design 완료 조건

- [x] N1~N6 정확한 파일·라인 명시
- [x] 의존성 (C1 schema → C2 N1 dropdown, 나머지 무관)
- [x] 충돌 회피 (파일 단독 소유)
- [x] N5 결정 (filterwarnings 채택)
- [x] N2 결정 (분석 후 fix 또는 회귀 테스트만)

---

## 5. 위험

| # | 위험 | 대응 |
|---|---|---|
| R1 | N2 list check round-trip 손실 발견되면 fix 필요 → 시간 ↑ | Design 단계에서 import 코드 미리 확인 |
| R2 | N5 filterwarnings 가 *진짜* 다른 경고도 숨김 | 정확한 경고 클래스만 명시 (PydanticSerializationUnexpectedValue) |
| R3 | N4 localStorage 가 SSR 환경에서 fail | try/catch 로 무시 (헬퍼에 이미 포함) |
| R4 | spacer xl 추가로 기존 문서 default 깨짐 | default 는 md 그대로, 새 옵션만 추가라 호환 |

---

## 6. 에이전트 prompt 뼈대

이번엔 2분할이라 *에이전트 안 띄우고 직접 작업*도 충분 (각 ~1.5시간). 단, 사용자 요청 시 4분할 패턴 그대로 적용 가능.

권장: C1·C2 를 **직접 순차 작업** + N6 INDEX 는 한 줄로 처리. 에이전트 출발 오버헤드보다 빠름. 단 N4 (form/quiz) 가 예상보다 크면 그 부분만 에이전트 분리.
