/**
 * Slug 자동 생성기 — title 에서 URL 안전한 slug 만들기.
 *
 * BE 의 `doc_templates.py:_slugify` 와 동등하게 동작 (한글 ASCII 정규식 매칭).
 * 사이트 schema 의 slug 규칙:
 *
 *   ^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$
 *
 * 변환 단계:
 *   1. lowercase + trim
 *   2. 공백 / `_` → `-`
 *   3. 허용된 문자 (a-z 0-9 가-힣 `-`) 외 모두 제거
 *   4. 연속 `-` 한 개로
 *   5. 양끝 `-` 제거
 *   6. 빈 결과면 'untitled'
 *   7. 첫 글자가 `-` 면 한 번 더 stripped (regex 보장)
 *   8. 100 자 cap
 *
 * 예:
 *   "Monthly Report"          → "monthly-report"
 *   "AMD/GPU/RX 5000 시리즈"   → "amdgpurx-5000-시리즈"
 *   "안드로이드(운영체제)/10"   → "안드로이드운영체제10"
 *   "*** ! @ #"                → "untitled"
 *   "  많은    공백  "         → "많은-공백"
 *
 * Note: BE 와 *문자 단위* 로 동일 결과 — 같은 정규식 사용.
 */

const FALLBACK = 'untitled'
const MAX_LEN = 100

/**
 * Slug pattern from packages/shared/schemas/document.json `#/$defs/Slug`.
 * Mirrors the BE `_SLUG_RE` (Polish D).
 */
export const SLUG_REGEX = /^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/

/**
 * Generate a slug from a title. Always returns a valid slug or FALLBACK.
 */
export function slugify(title: string): string {
  if (!title) return FALLBACK

  let s = title.toLowerCase().trim()

  // 1) whitespace / underscore → hyphen
  s = s.replace(/[\s_]+/g, '-')

  // 2) drop everything outside [a-z 0-9 가-힣 -]
  s = s.replace(/[^a-z0-9가-힣-]/g, '')

  // 3) collapse multiple hyphens, strip leading/trailing
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '')

  if (!s) return FALLBACK

  // 4) cap length BEFORE regex (regex enforces 100-char limit; over-length
  // valid content would otherwise hit the fallback unnecessarily)
  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN).replace(/-+$/, '')
  }

  // 5) validate against schema regex; if invalid, fallback
  if (!SLUG_REGEX.test(s)) return FALLBACK

  return s
}

/**
 * `true` if the given string is a valid slug per the schema regex.
 */
export function isValidSlug(s: string): boolean {
  return SLUG_REGEX.test(s)
}
