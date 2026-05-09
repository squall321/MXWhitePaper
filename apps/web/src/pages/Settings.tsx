import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Card } from '@/components/ui'
import {
  useSettingsStore,
  type EmailCadence,
  type ThemeMode,
  type UiSettings,
} from '@/features/settings/store'
import { useAuthStore } from '@/features/auth/store'
import { useLocale } from '@/lib/i18n'
import { SpellcheckSettingsSection } from '@/features/spellcheck/SpellcheckSettingsSection'
import type { AppOutletContext } from '@/App'

/**
 * "/settings" — cosmetic preference toggles persisted in localStorage.
 *
 * Tier 1 dark-mode: a "테마: 라이트 / 다크 / 시스템" radio group writes
 * `themeMode` and the legacy `darkMode` boolean is kept in sync (so the
 * Quick Settings modal switch keeps working).
 *
 * Tier 2 i18n: a Language select between Korean / English. The select
 * writes `language`; copy on this page is translated via `useLocale()`.
 */
export function SettingsPage() {
  const { t } = useLocale()
  const notifications = useSettingsStore((s) => s.notifications)
  const autoSave = useSettingsStore((s) => s.autoSave)
  const codeFade = useSettingsStore((s) => s.codeFade)
  const darkMode = useSettingsStore((s) => s.darkMode)
  const themeMode = useSettingsStore((s) => s.themeMode)
  const language = useSettingsStore((s) => s.language)
  const emailDigest = useSettingsStore((s) => s.emailDigest)
  const emailCadence = useSettingsStore((s) => s.emailCadence)
  const setOne = useSettingsStore((s) => s.set)
  const reset = useSettingsStore((s) => s.reset)
  const userEmail = useAuthStore((s) => s.user?.email ?? null)
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()

  useEffect(() => {
    setLeftRail(null)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  return (
    <section className="space-y-6" data-testid="settings-page">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl dark:text-gray-100">
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('settings.subtitle')}
        </p>
      </header>

      <Card padded="md">
        <dl className="divide-y divide-gray-100 dark:divide-gray-800">
          <ToggleRow
            label={t('settings.notifications')}
            description={t('settings.notifications.help')}
            checked={notifications}
            onChange={(v) => setOne('notifications', v)}
            testId="settings-toggle-notifications"
          />
          <ToggleRow
            label={t('settings.autoSave')}
            description={t('settings.autoSave.help')}
            checked={autoSave}
            onChange={(v) => setOne('autoSave', v)}
            testId="settings-toggle-autosave"
          />
          <ToggleRow
            label={t('settings.codeFade')}
            description={t('settings.codeFade.help')}
            checked={codeFade}
            onChange={(v) => setOne('codeFade', v)}
            testId="settings-toggle-codefade"
          />
          <ToggleRow
            label={t('settings.theme.dark')}
            description={t('settings.darkBetaHelp')}
            checked={darkMode}
            onChange={(v) => {
              setOne('darkMode', v)
              setOne('themeMode', v ? 'dark' : 'light')
            }}
            testId="settings-toggle-darkmode"
          />
          <ThemeRadioRow
            label={t('settings.theme')}
            description={t('settings.theme.help')}
            value={themeMode}
            options={[
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
              { value: 'system', label: t('settings.theme.system') },
            ]}
            onChange={(v) => {
              setOne('themeMode', v)
              // Mirror the legacy boolean so the Quick Settings switch stays
              // in sync. `system` leaves the boolean untouched.
              if (v === 'dark') setOne('darkMode', true)
              else if (v === 'light') setOne('darkMode', false)
            }}
            testId="settings-theme-radio"
          />
          <SelectRow
            label={t('settings.language')}
            description={t('settings.language.help')}
            value={language}
            options={[
              { value: 'ko', label: t('settings.language.ko') },
              { value: 'en', label: t('settings.language.en') },
            ]}
            onChange={(v) => setOne('language', v as UiSettings['language'])}
            testId="settings-select-language"
          />
        </dl>
      </Card>

      <Card padded="md" data-testid="settings-email-card">
        <h2 className="text-base font-semibold text-smsg-900 dark:text-gray-100">
          이메일 알림
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          구독 다이제스트와 검토 요청 메일 발송 설정입니다. 발신은 관리자가 SMTP 를
          연결한 환경에서만 실제로 이루어집니다.
        </p>
        <dl className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <div className="min-w-0">
              <dt className="text-sm font-medium text-smsg-900 dark:text-gray-100">
                내 이메일
              </dt>
              <dd
                className="mt-0.5 text-xs text-gray-500 dark:text-gray-400"
                data-testid="settings-email-readonly"
              >
                {userEmail ?? '로그인 후 표시됩니다.'}
              </dd>
            </div>
          </div>
          <ToggleRow
            label="다이제스트 이메일 받기"
            description="구독한 문서의 변경 사항을 모아 이메일로 받습니다."
            checked={emailDigest && Boolean(userEmail)}
            onChange={(v) => setOne('emailDigest', v)}
            testId="settings-toggle-email-digest"
          />
          <CadenceRadioRow
            label="알림 빈도"
            description="다이제스트 묶음의 발송 주기를 정합니다."
            value={emailCadence}
            options={[
              { value: 'instant', label: '즉시' },
              { value: 'daily', label: '매일' },
              { value: 'weekly', label: '매주' },
            ]}
            onChange={(v) => setOne('emailCadence', v)}
            testId="settings-email-cadence"
          />
        </dl>
      </Card>

      <SpellcheckSettingsSection />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => reset()}
          className="min-h-[44px] rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 transition-colors hover:border-smsg-500 hover:text-smsg-900 dark:border-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
          data-testid="settings-reset"
        >
          {t('settings.reset')}
        </button>
      </div>
    </section>
  )
}

interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
  testId?: string
}

function ToggleRow({ label, description, checked, onChange, testId }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-smsg-900 dark:text-gray-100">{label}</dt>
        <dd className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</dd>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-fast ${
          checked ? 'bg-smsg-700' : 'bg-gray-300 dark:bg-gray-700'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-fast ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

interface SelectRowProps {
  label: string
  description: string
  value: string
  options: { value: string; label: string }[]
  onChange: (next: string) => void
  testId?: string
}

function SelectRow({ label, description, value, options, onChange, testId }: SelectRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-smsg-900 dark:text-gray-100">{label}</dt>
        <dd className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</dd>
      </div>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="min-h-[40px] rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus-visible:outline-none focus-visible:shadow-focus dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface CadenceRadioRowProps {
  label: string
  description: string
  value: EmailCadence
  options: { value: EmailCadence; label: string }[]
  onChange: (v: EmailCadence) => void
  testId?: string
}

function CadenceRadioRow({
  label,
  description,
  value,
  options,
  onChange,
  testId,
}: CadenceRadioRowProps) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-smsg-900 dark:text-gray-100">{label}</dt>
        <dd className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</dd>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        data-testid={testId}
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800"
      >
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`settings-email-cadence-${o.value}`}
              onClick={() => onChange(o.value)}
              className={`min-h-[36px] rounded-full px-3 py-1 transition-colors ${
                active
                  ? 'bg-smsg-700 text-white shadow-sm'
                  : 'text-gray-700 hover:text-smsg-900 dark:text-gray-300 dark:hover:text-gray-100'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface ThemeRadioRowProps {
  label: string
  description: string
  value: ThemeMode
  options: { value: ThemeMode; label: string }[]
  onChange: (v: ThemeMode) => void
  testId?: string
}

function ThemeRadioRow({ label, description, value, options, onChange, testId }: ThemeRadioRowProps) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-smsg-900 dark:text-gray-100">{label}</dt>
        <dd className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</dd>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        data-testid={testId}
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800"
      >
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`settings-theme-${o.value}`}
              onClick={() => onChange(o.value)}
              className={`min-h-[36px] rounded-full px-3 py-1 transition-colors ${
                active
                  ? 'bg-smsg-700 text-white shadow-sm'
                  : 'text-gray-700 hover:text-smsg-900 dark:text-gray-300 dark:hover:text-gray-100'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
