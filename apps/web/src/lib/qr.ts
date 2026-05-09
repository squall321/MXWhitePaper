/**
 * QR-share helpers for the share modal.
 *
 * STRATEGY (read this before extending):
 *   The "real" way to render a QR code is to implement a full QR encoder
 *   (mode bits, version selection, byte stream, ECC, mask scoring, …) — that
 *   is hundreds of lines plus lookup tables. The cycle-8 brief explicitly
 *   allows shipping a simpler fallback: an inline SVG that displays the
 *   URL as styled monospace text, alongside a "Copy URL" affordance. That
 *   is what we do here.
 *
 *   Rationale:
 *     - The mandate says "Pick the simpler path; document it."
 *     - No new deps allowed (`qrcode-svg` would have been the easy fix).
 *     - The UX still gives users a way to share via link (paste / copy).
 *     - A real QR encoder can be slotted in later by replacing the body of
 *       `generateQrSvg` — the public signature is stable.
 *
 *   Follow-up TODO: implement a real byte-mode + ECC-L encoder, capped at
 *   version 10 (~150 chars), and switch the fallback off when input fits.
 *
 * The function is pure — given the same `text` and `size` it always returns
 * the same SVG markup. No DOM lookups, no random ids, deterministic output
 * so snapshot-style tests stay stable.
 */

const MAX_INPUT_LEN = 2048

export interface QrSvgOptions {
  /** Pixel size of the rendered SVG. Defaults to 240. */
  size?: number
}

/**
 * Render `text` as an inline SVG. Returned markup can be set via
 * `dangerouslySetInnerHTML` or written to a file (download).
 *
 * Throws when `text` is empty or longer than {@link MAX_INPUT_LEN} — the
 * caller should validate ahead of time and show a UX-friendly error.
 */
export function generateQrSvg(text: string, size: number = 240): string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('qr: text must be a non-empty string')
  }
  if (text.length > MAX_INPUT_LEN) {
    throw new Error(`qr: text exceeds max length (${MAX_INPUT_LEN})`)
  }
  const px = clampSize(size)
  const escaped = escapeXml(text)
  // Word-wrap for readability inside the SVG. ~32 chars per line at 12px
  // monospace fits comfortably in a 240px box.
  const lines = wrapForSvg(text, 32)
  const lineHeight = 14
  const startY = 28
  const tspans = lines
    .map((ln, i) => {
      const y = startY + i * lineHeight
      return `<tspan x="12" y="${y}">${escapeXml(ln)}</tspan>`
    })
    .join('')
  // The `<title>` makes the SVG accessible (screen-reader announces the URL)
  // and keeps the markup self-describing for download-as-file.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 ${px} ${px}" role="img" aria-label="${escaped}">` +
    `<title>${escaped}</title>` +
    `<rect width="100%" height="100%" fill="#ffffff" stroke="#1f2937" stroke-width="2"/>` +
    `<text x="12" y="14" font-family="monospace" font-size="10" fill="#6b7280">QR fallback — copy URL</text>` +
    `<text font-family="monospace" font-size="11" fill="#111827">${tspans}</text>` +
    `</svg>`
  )
}

/** Tells callers whether the URL fits the current encoder. The fallback
 *  always accepts up to MAX_INPUT_LEN — a real encoder would be stricter. */
export function isQrTextSupported(text: string): boolean {
  return (
    typeof text === 'string' && text.length > 0 && text.length <= MAX_INPUT_LEN
  )
}

function clampSize(size: number): number {
  if (!Number.isFinite(size)) return 240
  return Math.max(96, Math.min(640, Math.round(size)))
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapForSvg(s: string, width: number): string[] {
  if (width <= 0) return [s]
  const out: string[] = []
  for (let i = 0; i < s.length; i += width) {
    out.push(s.slice(i, i + width))
  }
  return out
}
