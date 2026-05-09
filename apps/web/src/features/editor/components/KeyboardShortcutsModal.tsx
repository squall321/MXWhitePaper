import { useEffect } from 'react'
import { useLocale } from '@/lib/i18n'

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

interface ShortcutRow {
  keys: string
  /** i18n key for the row description. */
  descKey: string
}

interface ShortcutSection {
  /** i18n key for the section heading. */
  titleKey: string
  rows: ShortcutRow[]
}

const SECTIONS: ShortcutSection[] = [
  {
    titleKey: 'shortcuts.section.basic',
    rows: [
      { keys: 'E', descKey: 'shortcuts.basic.toggleEdit' },
      { keys: '⌘ S', descKey: 'shortcuts.basic.save' },
      { keys: '⌘ Z / ⌘ ⇧ Z', descKey: 'shortcuts.basic.undoRedo' },
      { keys: '?', descKey: 'shortcuts.basic.help' },
      { keys: 'Esc', descKey: 'shortcuts.basic.escape' },
    ],
  },
  {
    titleKey: 'shortcuts.section.edit',
    rows: [
      { keys: '/', descKey: 'shortcuts.edit.slash' },
      { keys: 'Tab / ⇧ Tab', descKey: 'shortcuts.edit.indent' },
      { keys: '⌘ ↑ / ⌘ ↓', descKey: 'shortcuts.edit.move' },
      { keys: '[[', descKey: 'shortcuts.edit.wikilink' },
      { keys: '@', descKey: 'shortcuts.edit.term' },
      { keys: ':emoji', descKey: 'shortcuts.edit.emoji' },
    ],
  },
  {
    titleKey: 'shortcuts.section.bulk',
    rows: [
      { keys: '⌘ A', descKey: 'shortcuts.bulk.selectAll' },
      { keys: '⌘ D', descKey: 'shortcuts.bulk.duplicate' },
      { keys: 'Delete / Backspace', descKey: 'shortcuts.bulk.delete' },
      { keys: 'Esc', descKey: 'shortcuts.bulk.deselect' },
    ],
  },
  {
    titleKey: 'shortcuts.section.format',
    rows: [
      { keys: '⌘ B', descKey: 'shortcuts.format.bold' },
      { keys: '⌘ I', descKey: 'shortcuts.format.italic' },
      { keys: '⌘ U', descKey: 'shortcuts.format.underline' },
      { keys: '⌘ E', descKey: 'shortcuts.format.code' },
      { keys: '⌘ K', descKey: 'shortcuts.format.link' },
      { keys: '~~text~~', descKey: 'shortcuts.format.strike' },
    ],
  },
  {
    titleKey: 'shortcuts.section.find',
    rows: [
      { keys: '⌘ F', descKey: 'shortcuts.find.open' },
      { keys: 'Esc', descKey: 'shortcuts.find.close' },
    ],
  },
  {
    titleKey: 'shortcuts.section.go',
    rows: [
      { keys: '⌘ K', descKey: 'shortcuts.go.palette' },
      { keys: 'G H', descKey: 'shortcuts.go.home' },
      { keys: 'G O', descKey: 'shortcuts.go.orgs' },
      { keys: 'G R', descKey: 'shortcuts.go.recent' },
      { keys: 'G N', descKey: 'shortcuts.go.newDoc' },
      { keys: 'G S', descKey: 'shortcuts.go.settings' },
    ],
  },
  {
    titleKey: 'shortcuts.section.article',
    rows: [
      { keys: 'J / K', descKey: 'shortcuts.article.nav' },
      { keys: '★', descKey: 'shortcuts.article.favorite' },
    ],
  },
]

/**
 * Lightweight modal listing all editor / app shortcuts. Opens via the global
 * `?` hotkey when not typing, and via the toolbar "단축키" button.
 */
export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  const { t } = useLocale()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.title')}
      data-testid="shortcuts-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-smsg-900">{t('shortcuts.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            aria-label={t('shortcuts.close.aria')}
          >
            Esc
          </button>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          {SECTIONS.map((sec) => (
            <section key={sec.titleKey}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {t(sec.titleKey)}
              </h3>
              <dl className="space-y-1">
                {sec.rows.map((row) => (
                  <div
                    key={row.keys}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <dt>
                      <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                        {row.keys}
                      </kbd>
                    </dt>
                    <dd className="flex-1 text-right text-gray-700">{t(row.descKey)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          {t('shortcuts.hint')}
        </p>
      </div>
    </div>
  )
}
