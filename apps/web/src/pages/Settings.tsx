import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Card } from '@/components/ui'
import { useSettingsStore, type UiSettings } from '@/features/settings/store'
import type { AppOutletContext } from '@/App'

/**
 * "/settings" — cosmetic preference toggles persisted in localStorage.
 *
 * All toggles are wired into the Zustand store directly. The dark-mode
 * switch only flips the boolean; the actual theme application is staged
 * for a later sprint (tokens are already dark-ready).
 */
export function SettingsPage() {
  const notifications = useSettingsStore((s) => s.notifications)
  const autoSave = useSettingsStore((s) => s.autoSave)
  const codeFade = useSettingsStore((s) => s.codeFade)
  const darkMode = useSettingsStore((s) => s.darkMode)
  const language = useSettingsStore((s) => s.language)
  const setOne = useSettingsStore((s) => s.set)
  const reset = useSettingsStore((s) => s.reset)
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
        <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
          환경설정
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          이 브라우저에만 저장되는 표시 설정입니다.
        </p>
      </header>

      <Card padded="md">
        <dl className="divide-y divide-gray-100">
          <ToggleRow
            label="알림"
            description="저장/오류 알림 토스트를 표시합니다."
            checked={notifications}
            onChange={(v) => setOne('notifications', v)}
            testId="settings-toggle-notifications"
          />
          <ToggleRow
            label="자동 저장"
            description="편집 중 변경사항을 주기적으로 자동 저장합니다."
            checked={autoSave}
            onChange={(v) => setOne('autoSave', v)}
            testId="settings-toggle-autosave"
          />
          <ToggleRow
            label="코드블록 fade"
            description="긴 코드블록의 하단을 흐리게 표시합니다."
            checked={codeFade}
            onChange={(v) => setOne('codeFade', v)}
            testId="settings-toggle-codefade"
          />
          <ToggleRow
            label="다크 모드"
            description="아직 베타입니다. 토큰만 준비되어 있어요."
            checked={darkMode}
            onChange={(v) => setOne('darkMode', v)}
            testId="settings-toggle-darkmode"
          />
          <SelectRow
            label="언어"
            description="추후 영어/한국어 전환을 지원합니다."
            value={language}
            options={[
              { value: 'ko', label: '한국어' },
              { value: 'en', label: 'English (예정)' },
            ]}
            onChange={(v) => setOne('language', v as UiSettings['language'])}
            testId="settings-select-language"
          />
        </dl>
      </Card>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 transition-colors hover:border-smsg-500 hover:text-smsg-900"
          data-testid="settings-reset"
        >
          기본값으로 되돌리기
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
        <dt className="text-sm font-medium text-smsg-900">{label}</dt>
        <dd className="mt-0.5 text-xs text-gray-500">{description}</dd>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-fast ${
          checked ? 'bg-smsg-700' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-fast ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
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
        <dt className="text-sm font-medium text-smsg-900">{label}</dt>
        <dd className="mt-0.5 text-xs text-gray-500">{description}</dd>
      </div>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus-visible:outline-none focus-visible:shadow-focus"
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
