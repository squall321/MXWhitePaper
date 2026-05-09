import { useRef, useState } from 'react'
import { Card } from '@/components/ui'
import { useSpellcheckPrefsStore, useSpellcheckPref } from './preferencesStore'
import { useDictionaryStore, useDictionarySelector } from './dictionaryStore'

/**
 * "맞춤법 검사" — settings panel section.
 *
 *  - 사용 toggle (default on)
 *  - 자동 언어 감지 toggle (default on)
 *  - 사용자 사전 (table + add input + import/export .txt)
 *
 * Mounted from `pages/Settings.tsx`. Uses the same toggle markup style as
 * the rest of /settings so it visually blends in. All state is client-only
 * (localStorage); no API calls.
 */
export function SpellcheckSettingsSection() {
  const enabled = useSpellcheckPref((s) => s.enabled)
  const autoDetectLang = useSpellcheckPref((s) => s.autoDetectLang)
  const setPref = useSpellcheckPrefsStore((s) => s.set)

  const words = useDictionarySelector((s) => s.words)
  const addWord = useDictionaryStore((s) => s.add)
  const removeWord = useDictionaryStore((s) => s.remove)

  const [draft, setDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onAdd = () => {
    const w = draft.trim()
    if (!w) return
    addWord(w)
    setDraft('')
  }

  const onExport = () => {
    if (typeof window === 'undefined') return
    const blob = new Blob([words.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mxwp-spellcheck-dict.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportClick = () => fileRef.current?.click()

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    // One word per line, ignore blanks.
    text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((w) => addWord(w))
    // Reset so re-importing the same file re-fires the change event.
    e.target.value = ''
  }

  return (
    <section className="space-y-3" data-testid="settings-spellcheck-section">
      <h2 className="text-base font-semibold text-smsg-900 dark:text-gray-100">
        맞춤법 검사
      </h2>
      <Card padded="md">
        <dl className="divide-y divide-gray-100 dark:divide-gray-800">
          <ToggleRow
            label="맞춤법 검사 사용"
            description="브라우저 기본 맞춤법 검사를 텍스트 블록에서 사용합니다."
            checked={enabled}
            onChange={(v) => setPref('enabled', v)}
            testId="settings-toggle-spellcheck"
          />
          <ToggleRow
            label="자동 언어 감지"
            description="블록 내용에 한글이 있으면 한국어, 영문만 있으면 영어로 표시합니다."
            checked={autoDetectLang}
            onChange={(v) => setPref('autoDetectLang', v)}
            testId="settings-toggle-spellcheck-autolang"
          />
        </dl>
      </Card>

      <Card padded="md">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-smsg-900 dark:text-gray-100">
              사용자 사전
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              브라우저가 잘못 표시하는 단어를 등록해 두세요. 등록된 단어는
              사전에서 검색·삭제할 수 있습니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onExport}
              data-testid="settings-spellcheck-export"
              className="min-h-[36px] rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:border-smsg-500 hover:text-smsg-900 dark:border-gray-700 dark:text-gray-300"
            >
              내보내기 (.txt)
            </button>
            <button
              type="button"
              onClick={onImportClick}
              data-testid="settings-spellcheck-import"
              className="min-h-[36px] rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:border-smsg-500 hover:text-smsg-900 dark:border-gray-700 dark:text-gray-300"
            >
              가져오기 (.txt)
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={onImportFile}
              data-testid="settings-spellcheck-import-file"
            />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onAdd()
              }
            }}
            placeholder="추가할 단어"
            aria-label="추가할 단어"
            data-testid="settings-spellcheck-add-input"
            className="min-h-[36px] flex-1 rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus-visible:outline-none focus-visible:shadow-focus dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={!draft.trim()}
            data-testid="settings-spellcheck-add-button"
            className="min-h-[36px] rounded bg-smsg-700 px-3 py-1 text-sm text-white transition-colors hover:bg-smsg-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + 단어 추가
          </button>
        </div>

        <div className="mt-3" data-testid="settings-spellcheck-list">
          {words.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-500 dark:text-gray-400">
              아직 등록된 단어가 없습니다.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-1 font-medium">단어</th>
                  <th className="py-1 w-20 font-medium text-right">삭제</th>
                </tr>
              </thead>
              <tbody>
                {words.map((w) => (
                  <tr
                    key={w}
                    className="border-b border-gray-100 last:border-b-0 dark:border-gray-800"
                    data-testid="settings-spellcheck-row"
                  >
                    <td className="py-1.5 text-smsg-900 dark:text-gray-100">{w}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeWord(w)}
                        aria-label={`${w} 삭제`}
                        data-testid={`settings-spellcheck-remove-${w}`}
                        className="min-h-[28px] rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:border-red-400 hover:text-red-600 dark:border-gray-700 dark:text-gray-300"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
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
