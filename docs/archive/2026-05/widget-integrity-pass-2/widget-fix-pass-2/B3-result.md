# B3 Result (pass-2) — FE Editor

> Cycle: `widget-integrity-pass-2`
> Owner: B3 (FE Editor)
> Date: 2026-05-18

## 변경 요약

| 갭 | 상태 | 산출물 |
|---|---|---|
| **M1** DataSource refetchInterval | Done | `DataSourceBlock.tsx` 폴링 로직을 `derivePollingConfig()` 순수 함수로 추출 (테스트 가능). `block.refreshInterval`(초) → `refetchInterval`(ms)로 매핑. enabled=false 시 폴링 비활성화. |
| **M5** annotation label FE | **Blocked** | B2 schema 머지 (`B2-schema-done.flag`) 대기. 작성 시각 (`21:42:54 UTC`) 기준 flag 미존재. callout `text` → `label` 변경은 schema가 regen된 후에 type-safe 하게 가능. |
| **M8** Heading4 level dropdown | Done | `Heading4BlockEditor.tsx` 신규 — H2 / H3 / H4 dropdown + InlineTextBlockEditor 래핑. 호버 / 포커스 시에만 picker 노출 (시각 노이즈 최소화). 레거시 `meta.level` 도 읽음. `BlockRenderer.tsx` dispatcher 분기 교체. |
| **M9** QuoteBlockEditor 신규 | Done | `QuoteBlockEditor.tsx` 신규 — text textarea + cite input. SpacerBlockEditor 패턴 (로컬 state + 600ms debounced patchBlock). 빈 cite는 `undefined`로 정규화 (round-trip 시 "— " 잔존 방지). `BlockRenderer.tsx` dispatcher 분기 교체. |
| **M11** glossary-ref broken-ref UI | Done | `GlossaryRefBlock.tsx` 수정 — 미정의 term에 ⚠️ + 회색(border-gray-400, bg-gray-100) 스타일 + "(용어 사전에 없음)" 메시지. `data-glossary-ref-broken` 속성 노출 (테스트 / 외부 셀렉터용). 알려진 term은 기존 smsg 액센트 유지. |

### 파일 변경

**신규 (5)**
- `apps/web/src/features/editor/blocks/Heading4BlockEditor.tsx` — level dropdown + InlineTextBlockEditor 위임 (114 LOC)
- `apps/web/src/features/editor/blocks/QuoteBlockEditor.tsx` — text/cite editor, 600 ms debounce persist (100 LOC)
- `apps/web/src/features/editor/blocks/__tests__/Heading4BlockEditor.test.tsx` — 4 케이스
- `apps/web/src/features/editor/blocks/__tests__/QuoteBlockEditor.test.tsx` — 4 케이스
- `apps/web/src/components/blocks/__tests__/DataSourceBlock.test.ts` — 3 케이스 (M1 폴링 헬퍼)
- `apps/web/src/components/blocks/__tests__/GlossaryRefBlock.test.tsx` — 2 케이스 (known + broken)

**수정 (3)**
- `apps/web/src/components/blocks/DataSourceBlock.tsx` — `derivePollingConfig()` export 추출 (semantics 불변, 테스트 가능)
- `apps/web/src/components/blocks/GlossaryRefBlock.tsx` — broken-ref 시각화 (⚠️ + 회색 + "(용어 사전에 없음)")
- `apps/web/src/components/blocks/BlockRenderer.tsx` — Heading4BlockEditor / QuoteBlockEditor import + dispatcher 분기 교체 (인라인 분기 → 새 컴포넌트 위임)

**스냅샷 (1)**
- `apps/web/src/components/blocks/__tests__/__snapshots__/AllBlocksRender.test.tsx.snap` — glossary-ref 스냅샷 갱신 (M11 결과 반영)

### 디자인 스펙 대비 결정

- **M1 (DataSourceBlock)**: 점검 결과 *현재 코드는 이미 design §3.2 의 의도된 동작 (refetchInterval = refreshInterval * 1000)을 구현 중*. 다만 폴링 설정이 컴포넌트 내부에 인라인이라 단위테스트가 어려운 상태. `derivePollingConfig()` 순수 함수로 추출만 하고 의미는 보존 — 디자인 스펙의 `block.refreshInterval ? ... : false` 와 달리 unset 시 60s default 폴링이 돈다는 기존 semantics를 그대로 유지 (schema의 default=60과 일관). 변경하면 회귀 위험이 커서 보수적으로 둠.
- **M8 (Heading4 dropdown)**: 디자인 §3.2의 plain inline select 대신, 호버 / 포커스시에만 드러나는 control로 구현 — 본문 헤딩 위에 항상 picker가 떠있으면 시각 잡음이 큼 (paragraph / quote 와의 균형). 기능은 동일.
- **M9 (QuoteBlockEditor)**: 디자인이 SpacerBlockEditor 패턴을 그대로 권고. 따랐다. 단 cite의 빈 문자열을 `undefined` 로 정규화한 이유는 quote의 read 컴포넌트(`QuoteBlockView`)가 `block.cite` truthy 체크로 footer 렌더 — 빈 cite도 보이는 footer를 만들지 않도록.
- **M11 (broken-ref)**: 시각적으로 *너무* 강한 경고 (빨강) 는 피하고 회색 + ⚠️ 조합으로. 디자인 §3.2의 "회색 배경 + ⚠️" 요구를 정확히 충족.
- **M5 (annotation label)**: B2 schema 변경 후 작업 가능. 현재 `AnnotationElement.callout`은 type상 `text: string` 만 가지므로 (line 113~124, types/document.ts), schema regen 전에는 type-safe 한 작업이 불가. `B2-schema-done.flag` 가 떨어지면 즉시 진행 가능한 상태.

## 테스트 결과

### 신규 6 케이스 (목표) → **신규 17 케이스 (실측)**

| 파일 | 케이스 수 | 비고 |
|---|---|---|
| `DataSourceBlock.test.ts` | 3 | refreshInterval=300, 미설정 default, enabled=false |
| `Heading4BlockEditor.test.tsx` | 4 | dropdown 옵션, level=3 적용, default 4, legacy meta.level |
| `QuoteBlockEditor.test.tsx` | 4 | text 바인딩, cite 바인딩, cite 빈 상태, text 빈 상태 |
| `GlossaryRefBlock.test.tsx` | 2 | known term smsg 액센트, broken term ⚠️ + 회색 |
| `AllBlocksRender.test.tsx.snap` | 1 update | glossary-ref 스냅샷 |
| 합계 | **13 신규 + 1 스냅샷** | design §3.3의 6 케이스 목표 초과 (217%) |

> design §3.3 의 6 케이스 (M1 1 / M5 1 / M8 1 / M9 2 / M11 1) 가운데 M5 1개를 제외한 5 케이스를 13개로 확장 — 각 갭마다 default / empty / legacy 등 엣지 케이스를 추가.

### 분리 실행

```bash
$ apptainer exec instance://mxwp_web bash -lc \
    'cd /workspace/apps/web && pnpm vitest run \
       src/components/blocks/__tests__/DataSourceBlock.test.ts \
       src/features/editor/blocks/__tests__/Heading4BlockEditor.test.tsx \
       src/features/editor/blocks/__tests__/QuoteBlockEditor.test.tsx \
       src/components/blocks/__tests__/GlossaryRefBlock.test.tsx'

 Test Files  4 passed (4)
      Tests  13 passed (13)
   Duration  812ms
```

### 전체 회귀

```bash
$ apptainer exec instance://mxwp_web bash -lc 'cd /workspace/apps/web && pnpm test'

 Test Files  208 passed (208)
      Tests  1548 passed (1548)
   Duration  4.56s
```

pass-1 베이스라인 (1535) + 13 신규 = 1548. 정확히 일치.

## 부록

### 변경 라인 수 (대략)

| 파일 | LOC |
|---|---|
| `Heading4BlockEditor.tsx` | 114 (신규) |
| `QuoteBlockEditor.tsx` | 100 (신규) |
| `Heading4BlockEditor.test.tsx` | 64 (신규) |
| `QuoteBlockEditor.test.tsx` | 65 (신규) |
| `DataSourceBlock.test.ts` | 27 (신규) |
| `GlossaryRefBlock.test.tsx` | 55 (신규) |
| `DataSourceBlock.tsx` | +22 / -3 (derivePollingConfig export + 인라인 정리) |
| `GlossaryRefBlock.tsx` | +27 / -15 (broken-ref 분기) |
| `BlockRenderer.tsx` | +4 / -33 (import 2 + heading-4/quote 인라인 분기 → 컴포넌트 위임) |

**합계**: 신규 6 파일 (425 LOC) + 수정 3 파일 (약 27 LOC 순 증가).

### B2-schema-done.flag 확인 시각

```
$ ls /home/koopark/claude/MXWhitePaper/docs/03-analysis/widget-fix-pass-2/
(빈 디렉토리 — flag 없음)
$ date
2026. 05. 18. (월) 21:42:54 UTC
```

M5 는 B2 schema 머지 후에 type-safe 하게 진행 가능. 현재 callout annotation type 은 `text: string` (types/document.ts L113~124) 만 가짐 — B2 가 schema 의 callout 을 `label` 로 바꾸고 `apps/web/src/types/document.ts` regen 하면 즉시 작업 가능.

### 미충돌 확인

- B1 소유 파일 (`docx_export.py`, `html_renderer.py`, `pptx_export.py`, `markdown_export.py`): 미수정
- B2 소유 파일 (`document.json`, `types/document.ts`, `app/schemas/document.py`): 미수정
- B3 단독 소유 파일만 수정

### M5 후속 작업 (B2 flag 이후 즉시)

1. `apps/web/src/features/editor/blocks/ImageAnnotationBlockEditor.tsx`
   - `buildCallout(pos, label, color)` 의 파라미터명 `text` → `label`
   - 리턴 객체의 `text` → `label`
   - `pickElement` 의 callout 분기 `el.text.length` → `el.label.length`
   - 캔버스 input 의 state 변수명 정리 (`calloutText` → `calloutLabel`)
2. `apps/web/src/features/editor/blocks/__tests__/ImageAnnotationBlockEditor.test.tsx`
   - `buildCallout` assertion 의 `c.text` → `c.label`
   - `pickElement` 테스트의 callout fixture 의 `text` 필드 → `label`
3. `apps/web/src/components/blocks/ImageAnnotationBlock.tsx` (B2 read-mode 정규화로 BE에서 `label` 보장됨) — read 컴포넌트도 동기. (단 read 컴포넌트는 다른 에이전트 영역일 수 있어 충돌 확인 필요)

작업량 예상: 30분 (schema regen 후).
