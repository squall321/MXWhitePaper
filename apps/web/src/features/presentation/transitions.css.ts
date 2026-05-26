/**
 * Presentation transitions + themes — CSS-in-JS module.
 *
 * Exports two pure helpers (used by both Presentation.tsx and PresenterView so
 * the popup window stays visually consistent) plus `TRANSITIONS_CSS`, the
 * stylesheet injected into the page via `<style>{TRANSITIONS_CSS}</style>`.
 *
 * Transitions
 * -----------
 *   - `none`        instant cut (no animation).
 *   - `fade`        200ms opacity in/out.
 *   - `slide-left`  300ms translateX(40px → 0) + opacity.
 *
 * The active slide is rendered with `data-pres-transition="<kind>"`. We key the
 * outer wrapper on the slide index so React unmounts the previous wrapper and
 * mounts the next, which retriggers the CSS animation.
 *
 * Themes
 * ------
 *   - `light`   default white background, dark text (current behaviour).
 *   - `dark`    near-black (#050817) background, white text, Samsung Blue accent.
 *   - `bright`  Samsung Blue (#1428a0) background, white text — for launches.
 *
 * Applied as `data-pres-theme="<kind>"` on the Presentation root.
 *
 * Stagger
 * -------
 *   When stagger is on each block animates with `animation-delay: calc(50ms * var(--idx))`.
 *   `--idx` is set inline by the page (`style={{ '--idx': i }}`).
 *
 * Reduced motion: `@media (prefers-reduced-motion: reduce)` disables every
 * keyframe animation in this module.
 */

import type { SlideTheme, SlideTransition } from '@/features/settings/store'

/**
 * Build the data-attribute object for the Presentation root. Keeping this as
 * a pure helper makes the test in `transitions.test.ts` trivial.
 */
export function themeAttrs(theme: SlideTheme): { 'data-pres-theme': SlideTheme } {
  return { 'data-pres-theme': theme }
}

/**
 * Build the inline style for a block wrapper that participates in stagger.
 * Returns an empty object when stagger is disabled so the caller can spread
 * unconditionally without producing dead CSS variables on the DOM.
 *
 * Index is clamped to a small upper bound (40) so a long deck doesn't end up
 * with multi-second delays.
 */
export function staggerStyle(
  index: number,
  enabled: boolean,
): React.CSSProperties {
  if (!enabled) return {}
  const idx = Math.max(0, Math.min(40, Math.floor(index)))
  return { ['--idx' as never]: idx } as React.CSSProperties
}

/**
 * Class for the per-block wrapper. Splitting this out keeps the JSX terse and
 * gives tests a stable selector.
 */
export function blockWrapperClass(staggerEnabled: boolean): string {
  return staggerEnabled ? 'slide-block-wrap slide-block-wrap--stagger' : 'slide-block-wrap'
}

/**
 * Re-export the validated slide-transition / slide-theme types so callers can
 * import everything related from one place.
 */
export type { SlideTheme, SlideTransition }

export const TRANSITIONS_CSS = `
/* ── Transitions ──────────────────────────────────────────── */
/* The outer wrapper (slide-anim) is keyed on the slide index in JSX; React
   remounts it on every navigation so the animation replays. */
.slide-anim { display: contents; }
.slide-anim[data-pres-transition="fade"] > .slide {
  animation: pres-fade 200ms ease-out;
}
.slide-anim[data-pres-transition="slide-left"] > .slide {
  animation: pres-slide-left 300ms cubic-bezier(.2,.7,.2,1);
}
.slide-anim[data-pres-transition="none"] > .slide {
  animation: none;
}
@keyframes pres-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes pres-slide-left {
  from { opacity: 0; transform: translateX(40px); }
  to   { opacity: 1; transform: none; }
}

/* ── Per-block stagger ────────────────────────────────────── */
.slide-block-wrap { /* layout-neutral; just hosts the animation */ }
.slide-block-wrap--stagger {
  animation: pres-block-in 220ms ease-out both;
  animation-delay: calc(50ms * var(--idx, 0));
}
@keyframes pres-block-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

/* ── Themes ───────────────────────────────────────────────── */
/* Light is the historical default; tokens already match.    */
[data-pres-theme="light"] {
  --mx-stage-bg: #ffffff;
  --mx-stage-fg: #0f172a;
  --mx-stage-muted: #475569;
  --mx-stage-accent: #1428a0;
}
[data-pres-theme="dark"] {
  --mx-stage-bg: #050817;
  --mx-stage-fg: #f8fafc;
  --mx-stage-muted: #94a3b8;
  --mx-stage-accent: #6f87d6;
}
[data-pres-theme="bright"] {
  --mx-stage-bg: #1428a0;
  --mx-stage-fg: #ffffff;
  --mx-stage-muted: #cbd5e1;
  --mx-stage-accent: #ffffff;
}
[data-pres-theme="bright"] .slide-title h1 {
  background: none;
  -webkit-text-fill-color: #ffffff;
  color: #ffffff;
}
[data-pres-theme="dark"] .slide-title h1 {
  background: linear-gradient(135deg, #6f87d6, #a5b4fc);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
[data-pres-theme="light"] .slide-title h1 {
  background: linear-gradient(135deg, #1428a0, #6f87d6);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
/* Ensure the section heading + body text follow the theme foreground. */
[data-pres-theme] .slide-section .slide-blocks { color: var(--mx-stage-fg); }
[data-pres-theme] .slide-section .slide-heading h2 { color: var(--mx-stage-fg); }
[data-pres-theme] .slide-summary { color: var(--mx-stage-muted); }

/* ── Toolbar (top-right preference cycler) ────────────────── */
.pres-toolbar {
  position: fixed; top: 12px; right: 12px; z-index: 35;
  display: flex; gap: 6px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(6px);
  border-radius: 8px; padding: 4px;
}
.pres-toolbar button {
  background: transparent; color: var(--mx-stage-fg, #f8fafc);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;
  font-family: inherit;
}
.pres-toolbar button:hover { background: rgba(255,255,255,0.08); }
.pres-toolbar select.pres-toolbar-select {
  background: transparent; color: var(--mx-stage-fg, #f8fafc);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 4px 6px; border-radius: 6px; cursor: pointer; font-size: 12px;
  font-family: inherit;
}
.pres-toolbar select.pres-toolbar-select:disabled {
  opacity: 0.4; cursor: not-allowed;
}
.pres-toolbar select.pres-toolbar-select option {
  background: rgba(15, 23, 42, 0.95); color: #f8fafc;
}
[data-pres-theme="light"] .pres-toolbar {
  background: rgba(255,255,255,0.85); border-color: rgba(15,23,42,0.12);
}
[data-pres-theme="light"] .pres-toolbar button { color: #0f172a; border-color: rgba(15,23,42,0.12); }
[data-pres-theme="light"] .pres-toolbar button:hover { background: rgba(15,23,42,0.06); }
[data-pres-theme="light"] .pres-toolbar select.pres-toolbar-select {
  color: #0f172a; border-color: rgba(15,23,42,0.12);
}
[data-pres-theme="light"] .pres-toolbar select.pres-toolbar-select option {
  background: #ffffff; color: #0f172a;
}

/* ── Reduced motion ───────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .slide-anim[data-pres-transition] > .slide { animation: none; }
  .slide-block-wrap--stagger { animation: none; }
}
`
