import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/features/settings/store'
import { useLocale } from '@/lib/i18n'

/**
 * Tiny dropdown that flips the UI language. Sits next to the profile menu in
 * the TopBar so users can switch without diving into /settings. The actual
 * persisted value lives in `useSettingsStore.language` — this widget is just
 * a thin trigger.
 */
export function LanguageSwitcher() {
  const { t, locale } = useLocale()
  const setOne = useSettingsStore((s) => s.set)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (value: 'ko' | 'en') => {
    setOne('language', value)
    setOpen(false)
  }

  const shortLabel = locale === 'en' ? 'EN' : 'KO'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="topbar-lang"
        aria-label={t('topbar.lang.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="hidden h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/15 hover:text-white sm:inline-flex"
      >
        <span aria-hidden="true">🌐</span>
        {shortLabel}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-popover w-32 overflow-hidden rounded-lg border border-gray-200 bg-white text-smsg-900 shadow-lg animate-slide-up dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <LangItem
            label={t('topbar.lang.ko')}
            current={locale === 'ko'}
            onClick={() => pick('ko')}
            testId="topbar-lang-ko"
          />
          <LangItem
            label={t('topbar.lang.en')}
            current={locale === 'en'}
            onClick={() => pick('en')}
            testId="topbar-lang-en"
          />
        </div>
      )}
    </div>
  )
}

function LangItem({
  label,
  current,
  onClick,
  testId,
}: {
  label: string
  current: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-smsg-50 ${
        current ? 'font-semibold text-smsg-900' : 'text-gray-700'
      }`}
    >
      {label}
      {current && (
        <span aria-hidden="true" className="text-smsg-700">
          ✓
        </span>
      )}
    </button>
  )
}
