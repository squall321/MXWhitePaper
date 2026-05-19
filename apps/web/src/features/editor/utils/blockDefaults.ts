/**
 * Block defaults — remember the last-used field settings per block type so
 * that adding the next field starts from the user's most recent choice
 * rather than the static template default.
 *
 * pass-3 N4: form/quiz 의 새 필드 추가 시 사용자의 마지막 kind/required 설정을
 * localStorage 에 저장 → 다음 추가 시 그대로 적용. SSR 안전 (try/catch).
 *
 * Scope intentionally small — 옵션 전체가 아니라 *추가 시 가장 자주 바뀌는 키
 * 한두 개* 만. 너무 많은 필드를 기억하면 의도치 않은 prefill 로 혼란.
 */

const STORAGE_PREFIX = 'mxwp-block-defaults-'

function key(scope: string): string {
  return STORAGE_PREFIX + scope
}

/** SSR / private-mode 안전. localStorage 접근 실패 시 fallback 반환. */
function safeRead<T extends object>(scope: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback
  try {
    const raw = window.localStorage.getItem(key(scope))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return { ...fallback, ...parsed }
    }
  } catch {
    // JSON 파싱 실패 또는 storage quota — fallback
  }
  return fallback
}

function safeWrite(scope: string, partial: object): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const existing = window.localStorage.getItem(key(scope))
    const merged = existing
      ? { ...JSON.parse(existing), ...partial }
      : { ...partial }
    window.localStorage.setItem(key(scope), JSON.stringify(merged))
  } catch {
    // quota / private mode — silently drop
  }
}

/**
 * Merge `fallback` with the persisted partial defaults for `scope`.
 * Partial fields not present in storage retain their fallback value.
 */
export function loadBlockDefaults<T extends object>(scope: string, fallback: T): T {
  return safeRead(scope, fallback)
}

/**
 * Persist `partial` as the new defaults for `scope`. Merged with existing
 * storage entry so callers can save one key at a time without losing others.
 */
export function rememberBlockDefaults(scope: string, partial: object): void {
  safeWrite(scope, partial)
}
