import { useSettingsStore } from '@/features/settings/store'
import { ko, type LocaleKey } from './ko'
import { en } from './en'

export type Locale = 'ko' | 'en'

const TABLES: Record<Locale, Record<string, string>> = {
  ko: ko as Record<string, string>,
  en: en as Record<string, string>,
}

/**
 * Tiny translator. No library, no plurals, no ICU — just a key → string
 * lookup with `{name}` parameter substitution and a Korean fallback.
 *
 * Usage:
 *   t('home.hero.title')
 *   t('home.welcome.user', { name: '구건모' }, 'en')
 *
 * If `params` are provided, `{key}` placeholders in the string are
 * replaced. Missing keys log once in dev and return the key itself, so
 * untranslated strings are visible during development.
 */
const seenMissing = new Set<string>()

export function t(
  key: LocaleKey | (string & { _brand?: never }),
  params?: Record<string, string | number>,
  locale?: Locale,
): string {
  const lc: Locale = locale ?? readLocale()
  const primary = TABLES[lc]?.[key as string]
  const fallback = TABLES.ko[key as string]
  const raw = primary ?? fallback
  if (raw == null) {
    if (
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV !== 'production' &&
      !seenMissing.has(key as string)
    ) {
      seenMissing.add(key as string)
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key: ${String(key)}`)
    }
    return String(key)
  }
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] != null ? String(params[k]) : `{${k}}`,
  )
}

function readLocale(): Locale {
  try {
    const lang = useSettingsStore.getState().language
    return lang === 'en' ? 'en' : 'ko'
  } catch {
    return 'ko'
  }
}

/**
 * React hook variant — re-renders the consumer when the user toggles the
 * language in /settings.
 */
export function useLocale(): {
  locale: Locale
  t: (key: LocaleKey | string, params?: Record<string, string | number>) => string
} {
  const language = useSettingsStore((s) => s.language)
  const locale: Locale = language === 'en' ? 'en' : 'ko'
  return {
    locale,
    t: (key, params) => t(key as LocaleKey, params, locale),
  }
}

/**
 * Convenience hook returning just the bound `t()` function. Useful for
 * components that don't need to read `locale` directly.
 */
export function useT(): (
  key: LocaleKey | string,
  params?: Record<string, string | number>,
) => string {
  return useLocale().t
}

export type { LocaleKey } from './ko'
