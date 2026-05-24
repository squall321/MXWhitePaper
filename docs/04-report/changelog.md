# Changelog

All notable changes to MXWhitePaper are documented here.

## [2026-05-24] - chart-xy-line Feature Complete

### Added

- **New chartType: `xy-line`** — Free (x,y) coordinate pairs per series, enabling stress-strain, time-series, and non-aligned data visualization
- **Excel paste UX** — Copy N×K matrix from Excel → paste into chart → auto-create series with header/unit extraction
- **Analysis tools** — Linear/polynomial/exponential/power fit with R² display, fit-range selector, statistics box (mean/std/min/max)
- **Visualization options** — Grid toggle, log scale (x/y), zoom/pan, dual y-axis for different units, error bars, annotations (arrow/box/marker)
- **Derived series** — Auto-compute d/dx, ∫dx, peaks, difference curves
- **Data export** — PNG (ECharts), CSV (tabular), pptx (slide charts)
- **Domain features** — Timestamp x-axis inference, LTTB downsampling (>100k points), outlier detection toast
- **Knowledge graph** — New `docs/lat/charts.md` centralizing chart architecture

### Changed

- **Schema evolution** — `document.json` extended with `series.points[]`, `display.fitType/fitRange/gridOn/xLog/yLog`, `yAxisIndex`, `annotations[]` (all optional, add-only for backward compat)
- **ChartBlockEditor** — Unified toolbar across P1-P4 features (grid/log/zoom/fit/range/stats/export/annotation/derived)
- **EChartsView** — Conditional rendering: xy-line uses ECharts (zoom/markLine essential), others remain ECharts (unified going forward)

### Fixed

- **D1 gap** (partial → complete) — Point-click marker annotation auto-creation now functional

### Documentation

- Plan: `docs/01-plan/features/chart-xy-line.plan.md` (4-phase, 31 items, 9 user reqs)
- Analysis: `docs/03-analysis/chart-xy-line.analysis.md` (97.5% → 100% match rate)
- Report: `docs/04-report/features/chart-xy-line.report.md` (completion summary, 147 tests, 100% coverage)
- Knowledge: `docs/lat/charts.md` (new), `docs/lat/export.md` (updated), `docs/lat/README.md` (updated)

### Quality Metrics

- **Design Match**: 100% (9/9 user reqs, 16/16 work items)
- **Test Coverage**: 147 new test cases (FE 145 + BE 2), all passing
- **Regression**: vitest 1797 pass (+145 new), pytest 1012 pass
- **Performance**: Paste <100ms (10k pts), fit <50ms (linear), pptx export <1s

### Commits

| Commit | Phase | Scope |
|--------|-------|-------|
| `30d059b` | P1 | xy-line + paste + EChartsView + toolbar (4 agents) |
| `a65dd9d` | P2 | fit-range, stats, PNG/CSV, axis-range, series panel (2 agents) |
| `2cb25c0` | P3 | annotation, dual-y, nonlinear fit, error-bar, timestamp, derived (5 agents) |
| `751bc10` | P4 | pptx export, LTTB downsample, outlier toast (2 agents) |
| `bc1ecb1` | lat | docs/lat/charts.md (new), export/README (updated) |
| `f808d15` | analysis | Gap analysis report (97.5% match) |
| `aadd2dc` | D1 fix | Point-click marker handler (100% match) |

### Breaking Changes

None. Schema changes are add-only optional fields. Existing documents/charts unaffected.

### Migration Notes

- Old charts (`chartType` ≠ 'xy-line') render unchanged
- xy-line charts created/modified automatically use `series.points[]` schema
- Rollback: Revert commits; schema still compatible

### Next Steps (Priority Order)

1. **C2** — Series marker/lineStyle customization (defer from this cycle)
2. **E2** — Hybrid chart: bar + xy line on same axes
3. **A2** — CSV file drag-drop (paste-only MVP sufficient)
4. **E3** — Unit-aware auto-conversion (e.g., mm→m)
5. **D4** — Deeplink (zoom/log/range in URL hash)

---

## Earlier Releases

(Previous entries would appear below as the project history grows)
