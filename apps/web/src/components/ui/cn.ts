/**
 * Tiny `clsx`/`cn` helper. Filters falsy values and joins the rest with
 * spaces. Avoids pulling in `clsx` for a one-line job.
 */
export type ClassValue = string | number | null | false | undefined | ClassValue[]

export function cn(...args: ClassValue[]): string {
  const out: string[] = []
  for (const a of args) {
    if (!a) continue
    if (Array.isArray(a)) {
      const inner = cn(...a)
      if (inner) out.push(inner)
    } else {
      out.push(String(a))
    }
  }
  return out.join(' ')
}
