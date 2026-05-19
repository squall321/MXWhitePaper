# B2 Result (pass-2) — Schema

> Owner: B2 (schema)
> Date: 2026-05-18
> Plan: ../../01-plan/features/widget-integrity-pass-2.plan.md
> Design: ../../02-design/features/widget-integrity-pass-2.design.md §2

## 변경 요약

| 갭 | 상태 | 비고 |
| --- | --- | --- |
| M2 iframe src/html XOR | DONE | `document.json` 에 `oneOf` 추가. datamodel-codegen 이 `oneOf` 의 `not: required` 부분을 떨어뜨리므로 `generate-py.py` 후처리로 `IframeBlock1`/`IframeBlock2` 양쪽에 `@model_validator(mode='after')` 주입 — 양쪽 모두 set 인 입력을 거부. neither 는 codegen 의 required 분리로 자동 거부. |
| M4 video autoplay/controls/loop | DONE | 세 boolean 필드 optional 로 추가. 기본값 `autoplay=false`, `controls=true`, `loop=false` (Plan 결정 6 일치). 기존 video 문서 (옵션 없음) 는 그대로 통과. |
| M5 annotation label 통일 | DONE (schema 부분) | callout `text` → `label` 로 rename, required 갱신. arrow/rect 는 이미 `label`. *legacy 마이그레이션* (read-side `text` → `label`) 은 design 분담대로 B1 (document_service `_normalise_image_annotation_labels`) 소유 — schema 만 변경. |
| M11 glossary-ref `definition` 확인 | DONE (No-op) | `GlossaryRefBlock` 의 schema·pydantic 양쪽 모두 `definition` 필드 미존재 확인. *schema 작업 없음*. docx_export 의 `block.get("definition")` dead code 제거는 B1 소유. |

## 영향받은 파일

- `packages/shared/schemas/document.json` — M2/M4/M5 본체 (소유)
- `packages/shared/codegen/generate-py.py` — iframe XOR validator 자동 주입 후처리 (소유)
- `packages/shared/samples/14-image-annotation.json` — 골든 샘플의 callout
  `text`→`label` 동기화 (M5 schema rename 의 직접 연관 파일이라 함께 정리)
- `apps/api/app/schemas/document.py` — 자동 regen + 주입된 validator (자동 출력)
- `apps/web/src/types/document.ts` — 자동 regen (자동 출력)
- `apps/api/tests/test_schema_widget_pass2.py` — 신규 테스트 7건 (소유, 신규)

다른 에이전트 소유 파일은 *수정하지 않음*.

> 주의 — sample 14 는 pre-pass-2 시점에 이미 `image_id` (snake_case) 잔존
> 으로 `pnpm schema:validate` 에서 실패하고 있었음 (working tree 가 이미
> `imageId` 로 schema 를 옮겼지만 sample 은 미동기). 본 사이클에서는 *내가
> 직접 변경한 callout 부분만* 따라잡았고, image_id snake_case 잔존은 별도
> 작업. 즉 `1/16` sample-validate 실패는 본 변경으로 발생/악화된 것이 *아님*
> (pre-pass-2 동일 `1/16` 실패 확인).

## Flag

`docs/03-analysis/widget-fix-pass-2/B2-schema-done.flag` 생성 — B1/B3 진입 가능.

## 테스트 결과

```
$ apptainer exec instance://mxwp_api bash -lc \
    'cd /workspace/apps/api && python -m pytest \
     tests/test_schema_widget_pass1.py tests/test_schema_widget_pass2.py -v'

tests/test_schema_widget_pass1.py ....                                   [ 36%]
tests/test_schema_widget_pass2.py .......                                [100%]
============================== 11 passed in 0.37s ==============================
```

- pass-1 schema 회귀: PASSED (4/4)
- pass-2 신규: PASSED (7/7) — design §2.4 케이스 전부 충족
  - iframe src+html → 거부
  - iframe neither → 거부
  - iframe src only → OK
  - iframe html only → OK
  - video autoplay/controls/loop → OK
  - video legacy (옵션 없음) → OK
  - annotation callout `label` + arrow/rect `label` → OK

기타 회귀 (sample):

```
$ apptainer exec instance://mxwp_api bash -lc \
    'cd /workspace/apps/api && python -m pytest \
     tests/test_widget_export_markers_roundtrip.py tests/test_widget_markers.py -v'

============================== 86 passed in 0.81s ==============================
```

회귀 0.

DB 의존 테스트 (`test_html_export::test_export_html_endpoint_default_namuwiki`)
는 PostgreSQL shared memory issue 로 setup 단계에서 실패 — 본 변경과 무관 (DB
연결 인프라). 환경 이슈로 분류.

## 자동 regen 동기화

```
$ apptainer exec instance://mxwp_web bash -lc 'cd /workspace && pnpm -w schema:gen'
✓ TS types generated → /workspace/apps/web/src/types/document.ts
# (python3 단계는 mxwp_web 컨테이너에 없어서 별도 호출)

$ apptainer exec instance://mxwp_api bash -lc \
    'cd /workspace/packages/shared && python3 codegen/generate-py.py'
✓ Pydantic models generated → /workspace/apps/api/app/schemas/document.py
✓ Block union annotated with discriminator='type'
✓ Enum defaults normalized (36 enum classes scanned)
✓ IframeBlock XOR validator injected (src ↔ html)
```

TS / Pydantic 모두 새 필드 (autoplay/controls/loop) 와 `label` 사용 callout
포함. iframe XOR validator 가 regen 후에도 살아남도록 후처리 스크립트에 패턴
주입 (`generate-py.py:_inject_after_meta`).

## 부록

### 1. JSON Schema diff (요약)

```diff
 IframeBlock:
     properties: { src, html, ... }
+    oneOf: [
+      { required: [src],  not: { required: [html] } },
+      { required: [html], not: { required: [src]  } }
+    ]

 VideoBlock.properties:
+    autoplay: { type: boolean, default: false, ... }
+    controls: { type: boolean, default: true,  ... }
+    loop:     { type: boolean, default: false }

 AnnotationElement (callout variant):
-    required: [..., text,  color]
+    required: [..., label, color]
-    text:  { type: string }
+    label: { type: string, description: "... was `text` pre-pass-2." }
```

### 2. pydantic 후처리 의존 정보 (B4 lat 갱신 참고)

`datamodel-codegen` 은 JSON Schema 의 `oneOf` 를 두 개의 helper 클래스
(`IframeBlock1` = src-branch, `IframeBlock2` = html-branch) 와 `RootModel`
union 으로 풀지만, `not: { required: [...] }` 부분은 *무시한다*. 그래서
순수 codegen 출력만으로는 "both set" 입력이 통과한다.

대응: `packages/shared/codegen/generate-py.py` 가 매 regen 마다 두 helper
클래스에 `@model_validator(mode='after')` 를 주입 — src-branch 는 html 동봉
거부, html-branch 는 src 동봉 거부. Pydantic 의 union 평가에서 양쪽 모두
거부되면 "both set" 입력은 ValidationError 로 거절된다. "neither set" 은
helper 클래스의 required 가 각각 src 또는 html 을 요구해서 자동 거부.

이 후처리 패턴은 `_inject_after_meta()` 헬퍼로 분리해놨고, 향후 다른 oneOf
스키마에도 같은 방식으로 확장 가능.

### 3. 미수행 작업 (다른 에이전트 영역)

- B1: docx_export.py L996 `block.get("definition")` dead code 제거, BE
  `_normalise_image_annotation_labels` (legacy callout `text` → `label`).
- B3: FE `ImageAnnotationBlockEditor` 의 callout text field → label,
  iframe editor 의 XOR UI feedback.
- B4: lat 갱신, llm-input-rules, RAG re-chunk.
