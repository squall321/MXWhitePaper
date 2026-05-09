/**
 * Runtime application of "표시 설정" (density / font scale / line height /
 * high-contrast) preferences. The mandate disallows editing tokens.css, so
 * we instead inject a single `<style id="mxwp-display-prefs">` tag into
 * `<head>` and rewrite its body each time the relevant store fields change.
 *
 * Why a single global style tag rather than inline `style` attributes on
 * components?
 *
 * 1. Most existing components use Tailwind padding classes which compile to
 *    static rules — they cannot pick up CSS custom properties retroactively.
 *    The override stylesheet uses real selectors (`html[data-density="…"]`)
 *    so we get the cascade for free without re-rendering the React tree.
 * 2. We can express media-query-driven overrides (`prefers-contrast: more`)
 *    that the store cannot reach.
 *
 * The rendered CSS is fully derived from a `DisplayPrefs` value object —
 * `buildDisplayPrefsCss()` is a pure function so unit tests don't need a DOM.
 */

import type { Density, FontScale, LineHeight } from './store'

/** Subset of UiSettings that this module reads. */
export interface DisplayPrefs {
  density: Density
  fontScale: FontScale
  lineHeight: LineHeight
  highContrast: boolean
}

/** ID of the singleton `<style>` tag injected into `<head>`. */
export const DISPLAY_PREFS_STYLE_ID = 'mxwp-display-prefs'

const DENSITY_PADDING_Y: Record<Density, string> = {
  comfortable: '0.75rem',
  compact: '0.4rem',
}

const LEADING: Record<LineHeight, string> = {
  tight: '1.35',
  normal: '1.6',
  relaxed: '1.85',
}

/**
 * Build the CSS string applied to `<head>`. Pure function; the DOM-mounting
 * side of this module calls it on every store update.
 *
 * Selector strategy:
 *   :root { --density-padding-y; --font-scale; --leading-base; }
 *   html[data-font-scale]            → scales `--text-base`
 *   html[data-density]               → bumps default body line-height
 *   html[data-contrast="high"]       → links / borders / focus rings
 *   @media (prefers-contrast: more)  → safety net for OS-level high-contrast
 */
export function buildDisplayPrefsCss(prefs: DisplayPrefs): string {
  const paddingY = DENSITY_PADDING_Y[prefs.density]
  const leading = LEADING[prefs.lineHeight]
  const fontScale = String(prefs.fontScale)

  // Static :root vars — components can opt in via var(--density-padding-y)
  // etc. without forcing all existing Tailwind padding classes to react.
  const rootVars = `:root{--density-padding-y:${paddingY};--font-scale:${fontScale};--leading-base:${leading};}`

  // Multiplier on root font-size so every `rem` in the design system scales
  // proportionally. We deliberately scope to <html> (not :root) so app-shell
  // chrome with explicit pixel values still wins where it matters.
  const fontScaleRule = `html{font-size:calc(1rem * var(--font-scale, 1));}`

  // Density: tighter paragraph rhythm so users with `compact` see less
  // whitespace inside cards and lists. We only touch `dl`/`p`/`li` via the
  // dataset so existing buttons keep their hit-target padding.
  const densityRule =
    prefs.density === 'compact'
      ? `html[data-density="compact"] dl>div,html[data-density="compact"] li,html[data-density="compact"] p{line-height:var(--leading-base);}`
      : `html[data-density="comfortable"] p,html[data-density="comfortable"] li{line-height:var(--leading-base);}`

  // High-contrast overrides — bumps link colour to a darker Samsung Blue
  // variant (--smsg-blue-700 → --smsg-blue-900) and forces 2px focus rings.
  const contrastBlock = prefs.highContrast
    ? `html[data-contrast="high"]{--smsg-blue-700:#0a2a66;--smsg-blue-600:#0a2a66;}html[data-contrast="high"] a,html[data-contrast="high"] .text-link{text-decoration:underline;}html[data-contrast="high"] :focus-visible{outline:2px solid #0a2a66;outline-offset:2px;}`
    : ''

  // OS-level prefers-contrast: more. Independent of the explicit toggle so
  // users get a sensible default even without flipping it.
  const prefersContrast = `@media (prefers-contrast: more){:root{--smsg-blue-700:#0a2a66;}}`

  return [rootVars, fontScaleRule, densityRule, contrastBlock, prefersContrast]
    .filter(Boolean)
    .join('\n')
}

/**
 * Mount (or update) the singleton `<style>` tag, then write the dataset
 * attributes to `<html>` so CSS selectors above resolve.
 *
 * Safe to call repeatedly — idempotent. No-op when `document` is unavailable
 * (SSR / test stubs).
 */
export function applyDisplayPrefs(prefs: DisplayPrefs): void {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  if (!html) return

  html.setAttribute('data-density', prefs.density)
  html.setAttribute('data-font-scale', String(prefs.fontScale))
  html.setAttribute('data-line-height', prefs.lineHeight)
  if (prefs.highContrast) {
    html.setAttribute('data-contrast', 'high')
  } else {
    html.removeAttribute('data-contrast')
  }

  const css = buildDisplayPrefsCss(prefs)
  let tag = document.getElementById(DISPLAY_PREFS_STYLE_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = DISPLAY_PREFS_STYLE_ID
    document.head.appendChild(tag)
  }
  if (tag.textContent !== css) tag.textContent = css
}
