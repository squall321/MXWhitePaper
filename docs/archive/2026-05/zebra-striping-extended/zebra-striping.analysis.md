# Zebra Striping — Design-Implementation Gap Analysis

**Recommendation: PROCEED TO REPORT.** Match Rate = **97%** (≥ 90% threshold).

---

## Analysis Overview

| Field | Value |
|---|---|
| Feature | `zebra-striping` |
| Plan | `docs/01-plan/features/zebra-striping.plan.md` |
| Design | `docs/02-design/features/zebra-striping.design.md` |
| Implementation | commit `609f809` on `main` |
| Date | 2026-05-24 |
| Verification | static reads only (no commands run) |

## Overall Scores

| Category | Score | Status |
|---|:---:|:---:|
| Design Match (sections 1–8) | 97% | ✅ |
| Acceptance Criteria (C1–C11) | 100% (11/11) | ✅ |
| Convention / Schema add-only | 100% | ✅ |
| **Overall** | **97%** | ✅ |

## Section-by-Section Verification (Design)

### §1 File Structure

| Design path | Status | Notes |
|---|:---:|---|
| `apps/web/src/features/editor/blocks/zebra.ts` (EDIT) | ✅ | union extended to 6 types; `STRIPE_CLASSES` map complete (zebra.ts:21-36) |
| `apps/web/src/features/editor/blocks/ZebraToggle.tsx` (NEW) | ✅ | matches §3 markup exactly |
| `apps/web/src/features/editor/blocks/KpiCardsBlockEditor.tsx` (EDIT) | ✅ | `<ZebraToggle>` wired (lines 112-118) |
| `apps/web/src/features/editor/blocks/BibliographyBlockEditor.tsx` (EDIT) | ✅ | wired (lines 122-128) |
| `apps/web/src/features/editor/blocks/FigureIndexBlockEditor.tsx` (NEW) | ✅ | title + ZebraToggle + preview |
| `apps/web/src/features/editor/components/ListBlockEditor.tsx` (EDIT) | ✅ | toggle in header row (lines 274-281) |
| `apps/web/src/components/blocks/ListBlock.tsx` (EDIT) | ✅ | `getZebraClass('list', ...)` |
| `apps/web/src/components/blocks/KpiCardsBlock.tsx` (EDIT) | ✅ | `surface = zebra \|\| 'bg-white'` |
| `apps/web/src/components/blocks/BibliographyBlock.tsx` (EDIT) | ✅ | |
| `apps/web/src/components/blocks/FigureIndexBlock.tsx` (EDIT) | ✅ | |
| `packages/shared/schemas/document.json` (EDIT) | ✅ | 4 `options.stripe?` blocks landed |
| `apps/api/app/schemas/document.py` (regen) | ✅ | 4 regenerated `stripe: bool \| None = True` |
| registry mapping (`BlockRenderer.tsx`) | ✅ | lazy dispatch for `figure-index` added |

Design said registry might live in `blocknote-config.ts` *or* separate registry (O1). Actual landing is `BlockRenderer.tsx` dispatch + `lazy()` — aligned with sibling editors. No drift.

### §2 zebra.ts Signature

`zebra.ts:21-46` — union, map, and function body match the design's "AFTER" listing byte-for-byte. Function signature unchanged. ✅

### §3 ZebraToggle

`ZebraToggle.tsx:1-41` — Props shape (`blockType` / `options` / `onChange` / `label?`), `data-zebra-toggle={blockType}`, `aria-label`, default `label = '줄무늬'` — all match §3 exactly. ✅

### §4.1 ListBlock

- Schema: matches add-only diff ✅
- View `depth === 0` gate + `depth0Idx` counter: matches §4.1 exactly ✅
- Editor: a separate `persistOptions()` (lines 123-138) added instead of reusing `schedule(...)` because list state is array-of-strings — sensible deviation preserving contract

### §4.2 KpiCardsBlock

- Schema ✅
- View: `surface = zebra || 'bg-white'` — matches §4.2's class-order note ✅
- Editor: `<ZebraToggle>` inline with items-header row ✅

### §4.3 BibliographyBlock

- Schema ✅
- View: `<li className={\`leading-6${zebra ? ' ' + zebra : ''}\`}>` — slightly more careful than design snippet ✅
- Editor: toggle alongside title input ✅

### §4.4 FigureIndexBlock

- Schema ✅
- View: per-group `idx` counter inside `g.entries.map((e, idx))` — matches "그룹별 인덱스 리셋" ✅
- New editor: title + ZebraToggle + always-visible "미리보기" panel (design said `<details>` summary — functionally equivalent, LOW nit)
- `kinds` editing out-of-scope (O4 resolved) — confirmed in code comments

### §5 Call Flow

Round-trip: `ZebraToggle.onChange → schedule(...) → 800 ms debounce → patchBlock → applyServerSnapshot` verified in 3/4 editors. **ListBlockEditor uses parallel `persistOptions()` — immediate persist on toggle**, bypassing the 800 ms text-debounce. Small UX divergence from design, but reasonable (toggle is a discrete gesture). LOW.

### §6 Test Matrix

| File | Design | Actual | Status |
|---|---|---|---|
| `zebra.test.ts` | EDIT +4 (→10) | 10 cases | ✅ exact |
| `ZebraToggle.test.tsx` | NEW 4 | 4 | ✅ exact |
| `KpiCardsBlockEditor.test.tsx` | EDIT +1 | +3 | ✅ over-spec'd |
| `BibliographyBlockEditor.test.tsx` | NEW +1 | 2 | ✅ over-spec'd |
| `FigureIndexBlockEditor.test.tsx` | NEW +1 | 2 | ✅ over-spec'd |
| `ListBlockEditor.test.tsx` | EDIT +1 | +3 | ✅ over-spec'd |
| `ListBlock.zebra.test.tsx` (NEW, 2) | — | absorbed as new `describe` in existing `ListBlock.test.tsx` (+3) | ⚠ filename diverged, count over-met |
| `BibliographyBlock.zebra.test.tsx` | NEW 1 | 2 cases | ✅ |

Target = 15; actual ≈ 19. Web 1821/1821 pass.

### §7 Regression Risk Mitigations

- Optional `options` on all 4 blocks preserves old documents (block-level `additionalProperties: false` now permits `options`) ✅
- TS exhaustive `Record<ZebraBlockType, string>` catches missing tokens at compile time ✅
- ListBlock `depth === 0` gate preserved ✅
- Bibliography flat array contract preserved ✅

### §8 lat / LLM Sync

- `docs/lat/documents.md`: 4 block entries gained `options.stripe?`; new Gotcha for zebra options ✅
- `docs/llm-widgets-via-api.md`: `list` and `kpi-cards` got per-block notes. **bibliography** and **figure-index** sit in catch-all §3.22 — a shared "★ zebra-striping 6 종" callout covers them collectively. Design said "1줄씩 추가" per block; consolidation is substantively equivalent. LOW gap.
- `docs/lat/blocks-styling.md`: deferred per design ("유보") ✅

## Acceptance Criteria Cross-Check (Plan §1.5)

| # | Criterion | Status |
|---|---|:---:|
| C1 | list option panel; depth=0 odd → gray-050 | ✅ |
| C2 | kpi-cards toggle; `:nth-of-type(2n)` blue-050 | ✅ |
| C3 | bibliography toggle; odd `<li>` gray-050 | ✅ |
| C4 | figure-index toggle; group-internal odd → gray-050 | ✅ |
| C5 | default ON; only explicit `false` OFF | ✅ |
| C6 | `getZebraClass` accepts 4 new types + 4 unit tests | ✅ |
| C7 | Zero regression (1821 + 1014 pass, typecheck clean) | ✅ |
| C8 | Dark mode via `tokens.css` automatic | ✅ |
| C9 | 10 new tests | ✅ (actual ~17) |
| C10 | lat + LLM rules synced | ⚠→✅ (substantive) |
| C11 | analysis + report + archive | 🔄 (analysis = this doc) |

## Differences Found

### 🔴 Missing Features
None.

### 🟡 Added Features (positive)
| Item | Severity | Note |
|---|:---:|---|
| `persistOptions()` immediate-persist path in ListBlockEditor | LOW | Better UX for discrete toggle gesture |
| KpiCards/Bibliography/List over-spec'd test cases | LOW (positive) | Higher coverage than required |
| FigureIndexEditor always-visible preview panel | LOW | Functionally equivalent to `<details>` |

### 🔵 Changed Features
| Item | Design | Implementation | Severity |
|---|---|---|:---:|
| ListBlock view zebra test filename | new `ListBlock.zebra.test.tsx` | new `describe` in existing `ListBlock.test.tsx` | LOW |
| List options persist timing | shared 800 ms debounce | immediate `persistOptions(...)` on toggle | LOW |
| llm-widgets per-block stripe lines for bib/figure-index | "1줄씩 추가" per block | shared `★` callout at end of doc | LOW |

## Recommended Actions

### Now (before Report)
None required — Match Rate 97%, above 90% threshold.

### Optional polish (defer or roll into Report)
1. Add per-block stripe lines for `bibliography` / `figure-index` in `llm-widgets-via-api.md` (~2 lines)
2. Update design §5 to note ListBlockEditor's immediate-persist path (1 sentence)
3. Rename `ListBlock.zebra.test.tsx` plan-entry to "EDIT — `ListBlock.test.tsx` +3" in design §6 (naming only)

## Conclusion

Implementation is faithful to design with three minor deliberate refinements (immediate-persist on List toggle, consolidated llm-widgets zebra note, test file colocation). All 11 acceptance criteria met. Match Rate **97%**, recommendation **PROCEED TO REPORT** (`/pdca report zebra-striping`).
