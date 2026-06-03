# LLM viewer guide — reading & answering from DocumentJSON

> **Audience**: external LLMs (Claude / GPT / etc) that *read* an
> MXWhitePaper white paper to produce summaries, Q&A, or decision support.
> For *authoring* guidance, see `llm-input-rules.md`, `llm-widgets-via-api.md`,
> and `llm-document-formats.md`.

The document representation (DocumentJSON v1.0) is a tree of 37 block
types. Several of them lose information when flattened to plain text —
tables are cells, charts are data, pivots are computations. This document
defines **the rules for unpacking each block into a human-readable form**
and which identifiers to use when citing or referencing.

---

## 0. Quick recap (5 things the LLM must remember)

1. **The block id is the canonical identifier.** When citing in human-
   readable form, do NOT use ordinal labels like "block N" — use the
   8-character ULID prefix (`01HEX2ZX…`) or the section number (`§1.2`).
   The reference must be *reproducible* within the document.
2. **Reading order = `sections[].blocks[]` order.** The tree carries a
   hierarchy at the section level, but blocks within a single section
   are a *vertical flow*.
3. **Numbers / tables / charts / pivots** must be read **as data** and
   summarized in human words. "Revenue this quarter +12%" is correct;
   "data in table row 5" is wrong.
4. **Hidden meta** (`block.meta.note='page-break-before'`, `slideBreak`,
   etc.) is *presentational* and must not appear in summaries. Ignore.
5. **Permission markings** — blocks may carry `block.meta?.confidentiality`.
   If you see a `restricted` / `internal` marking, reflect it as-is in
   the answer; the LLM must not silently strip it.

---

## 1. Document skeleton

```text
{
  "schema_version": "1.0",
  "id":             "<ULID>",
  "slug":           "<slug>",
  "title":          "<document title>",
  "metadata":       { division, owners, tags, confidentiality, ... },
  "sections":       [ { id, number, level, title, blocks: [...], children?: [...] } ]
}
```

When reading:

- If `metadata.confidentiality` is `restricted`, state it *at the top of
  the answer*. It affects whether the response may be shared externally.
- `sections[].number` (`"1"`, `"1.1"`, `"1.1.1"`) is the official label
  shown to users. Cite as `§1.2`.
- `sections[].children?`, if present, is a nested section — traverse the
  tree.

---

## 2. Per-block human-readable summarization rules

| block | how to summarize |
|---|---|
| `paragraph` | `text` verbatim. Preserve inline link / cite / glossary-ref meaning |
| `heading-4` | sub-heading — fold into the following paragraph's label when citing |
| `list` | each `items[]` entry verbatim. Preserve `depth` indentation so the tree structure survives |
| `quote` | `"<quote> — <cite>"` form. If no cite, quote only |
| `code` | code MUST be cited *as-is*. No edits, no summarization (meaning breaks) |
| `math` | LaTeX as-is. An interpretive line ("this equation expresses …") is OK |
| `image` | use `alt` or `caption` text inline. If neither, "[image]" |
| `callout` | `"(warn/info/tip/danger) <title>: <text>"` — the variant carries tone, preserve it |
| `table` | **header + first N rows (max 5) cited, then "(M rows total)".** The header gives the data its meaning |
| `kpi-cards` | `"<label>: <value> (<delta> <trend>)"`, one per line |
| `chart` | `title` + chart type + x-axis label + series names + *per-series max/min/trend*. Do NOT dump raw numbers (noise) |
| `gantt` | task list — `"<name>: <start>~<end> (progress <progress>%)"` |
| `flow` | mermaid: cite the *DSL verbatim* (reproducible). excalidraw: `"[Excalidraw diagram]"` + state the user must view it in an external tool |
| `org-chart` | flatten with indentation. `root → children → grandchildren` |
| `gallery` | `"N images. <first caption>, …"` |
| `iframe` / `video` / `file` / `pdf` | external resources — cite `title` or URL only. The LLM must NOT fetch the contents |
| `doc-link-card` | cite the `slug` as a *document reference*. `"→ [docs/<slug>]"` |
| `glossary-ref` | `term` only. If the definition is needed, look it up via a tool call |
| `bibliography` | cite as-is (each entry's `text` + optional `url`) |
| `figure-index` | auto-generated — do NOT surface it in the answer (meta info) |
| `spacer` | ignore |
| `columns` / `tabs` / `accordion` | containers — unfold inner blocks at the *same depth* |
| `form` / `quiz` / `calculator` | interactive — `"<title> has N questions / items / inputs"` only. Do NOT guess answers/input results |
| `data-source` | live data — note `endpoint` inline. The actual values shift by call time |
| `dashboard-embed` | external dashboard — note provider + panelId. No screenshot |
| `pdf` / `whiteboard` / `image-annotation` | visuals — extract caption / annotation `label` only |
| `paragraph.meta.note === 'page-break-before'` | page break — ignore |
| `pivot-table` ★ | **dedicated chapter §3** |
| `slicer` ★ | **dedicated chapter §4** |
| `spreadsheet` | flatten `cells[]` numeric/text only. Cite `formula` *verbatim*, then attach the computed (resolved) value as well |

---

## 3. Reading PivotTable ★

A pivot table cannot be reduced to plain table citation — its meaning is
*cross-tabulation*. Summarize in this order:

1. **Topic line** — what `block.rows` × `block.cols` × `block.values`
   aggregates. Example: "Revenue sum by department × quarter (3 depts,
   4 quarters)".
2. **Time grouping** — when a `rows`/`cols` entry is `{field, group}`,
   state the bucket unit (year/quarter/month/…). It means raw dates were
   auto-bucketed.
3. **Measures** — for each `values[i]`:
   - `field` or `expr` (if a calculated field, cite the formula too —
     `revenue - cost`)
   - `agg` (sum/avg/median/…)
   - `showAs` (value/pct_row/pct_col/pct_total/running) — for
     *percentages / running totals*, state the unit in the answer
     (is `30 %` the quarter share or the running total?)
   - if `numberFormat` is present, follow it for human-friendliness
     (`#,##0` ⇒ thousands comma)
4. **calculatedItems** — synthetic items (e.g. "Q1 = Jan+Feb+Mar"). State
   the aggregation formula and, if the meaning differs from the base
   items, *report them separately*. On label collision, show both the
   original and the calculated item.
5. **Filters / Top N** — `filters` with `in`/`top_n`/`bottom_n` must be
   surfaced like "(top 10 only)", "(selected depts: Sales, R&D)" — make
   it clear that *some data was excluded*. Answering as if the LLM saw
   every row is wrong.
6. **boundSlicers** — sibling slicers drive this pivot's filters. The
   slicer state at answer time is unknown to the LLM, so add a single
   meta-note like "results may vary by current active slicer".
7. **Numbers in *significant digits only***. Don't carry `12345.6789`
   verbatim — follow `numberFormat`, or fall back to thousands + 2dp.
8. **Drill-down data only *when asked***. Flattening the whole pivot is
   information-free noise.

### 3.1 Citation format example

```text
The pivot in §1.2 (id 01HEXPIV…):
Revenue sum by department × quarter (raw dates auto-grouped by quarter).
- Sales peaks at 2024-Q3 (200,000), declines after
- Company H1 (calculated item) = 470,000 / H2 = 695,000 — stronger in H2
- Filter: top_n 10 — bottom departments excluded
- Results may vary by current active slicer
```

---

## 4. Reading Slicer ★

`SlicerBlock` is an interactive widget — clicking a chip re-renders the
sibling pivot/chart in the same document. The LLM cannot directly observe
the chip state (the slicer's active set lives in zustand's volatile UI
state).

When answering:

- Add a single meta-note: "This document has a `<field>` slicer; §1.2's
  pivot varies by the currently selected value."
- If a `default` key is present, state "default: A, B".
- If `multiSelect=true`, multi-select is allowed — flag that possibility
  in the answer.
- The slicer itself is NOT an information source — only convey *which
  values are selectable* (the distinct value list).

---

## 5. Citation / reference identifier rules

When the LLM points at a *specific part of this document* in the answer,
use these identifier forms:

| target | identifier form |
|---|---|
| whole document | `docs/<slug>` |
| section | `§<number>` — `section.number` verbatim (`§1`, `§1.2`, `§1.2.1`) |
| block | `[<8-char prefix>]` — first 8 chars of the ULID. Example: `[01HEXPIV]` |
| measure | `pivot:[<8-char>]/values[i]` — `i` is 0-based |
| quote | `quote@§<number>:<8-char>` |
| table row | `table[<8-char>]:row[i]` (0-based) |
| chart series | `chart[<8-char>]:series[name]` |
| external doc link | `→ docs/<slug>` (doc-link-card) |

Pointing at the document via a *guessed Korean label* instead of its
full name introduces ambiguity. The first 8 chars of a ULID are
practically unique within a document (1-in-260-billion collision
probability — ignore it).

---

## 6. Never do this

1. **Guess numbers** — if chart/pivot raw rows aren't visible, answer
   "exact value not accessible". If the LLM stitches nearby tables
   together to estimate, that's hallucination.
2. **Answer as if you know the slicer / data-source state** — both
   vary *at answer time*. Don't drop the clauses "depends on current
   active slicer" / "data at the endpoint call time".
3. **Guess user input results for interactive widgets** (form / quiz /
   calculator).
4. **Guess at author / owner identity**. Cite only what `metadata`
   shows.
5. **Cite hidden marker text** — import-side markers like
   `Widget: chart (bar)` may surface as a paragraph. If
   `block.meta.note === 'hidden'` or `paragraph.text` matches exactly
   the `^Widget: ` pattern, it's NOT human-readable.
6. **figure-index / spacer / page-break paragraph** — meta /
   presentational, NOT body content.

---

## 7. Answer-quality checklist

Self-check *before* responding:

- [ ] Does every number you cited carry a source (`§x.y` or `[<8-char>]`)?
- [ ] Did you state that filters / Top N / slicers caused *some data to
      be excluded*?
- [ ] Did you state the time-grouping unit (year/quarter/month)?
- [ ] Did you summarize charts by *trend / max / min* instead of dumping
      raw values?
- [ ] If `confidentiality` is `restricted`, did you state that at the
      top of the answer?
- [ ] Did you flag that data-source / slicer state — which the LLM has
      not observed — affects the answer?

---

## 8. Related docs

- Authoring guides: `llm-input-rules.md`, `llm-widgets-via-api.md`,
  `llm-document-formats.md`
- Per-widget shape detail: widgets-via-api §3.1 ~ §3.23
- Schema source of truth: `packages/shared/schemas/document.json`
- Toolkit (for external LLMs that produce docx): `dist/llm-docx-toolkit/`
