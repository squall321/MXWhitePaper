import { TEMPLATES, type TemplateDef } from './templates'

interface Props {
  onPick: (tpl: TemplateDef) => void
  /** Highlight the currently-selected template id. */
  selectedId?: string
}

/**
 * Visual grid (3-col on desktop, 1-col on mobile) of available templates.
 * Each card shows a tiny icon strip thumbnail + title + description, and
 * clicking the card hands the template up to the parent for instantiation.
 */
export function TemplateGallery({ onPick, selectedId }: Props) {
  return (
    <div
      role="list"
      aria-label="문서 템플릿"
      data-testid="template-gallery"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {TEMPLATES.map((tpl) => {
        const selected = selectedId === tpl.id
        return (
          <button
            key={tpl.id}
            type="button"
            role="listitem"
            data-template-id={tpl.id}
            aria-pressed={selected}
            onClick={() => onPick(tpl)}
            className={
              'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ' +
              (selected
                ? 'border-smsg-500 bg-smsg-50 dark:bg-gray-800'
                : 'border-gray-200 bg-white hover:border-smsg-300 hover:bg-smsg-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800')
            }
          >
            <div
              aria-hidden="true"
              className="flex h-10 w-full items-center justify-center gap-1 rounded-md bg-gray-50 text-base dark:bg-gray-800"
            >
              {tpl.thumbnailIcons.map((ic, i) => (
                <span key={i} className="px-1">{ic}</span>
              ))}
            </div>
            <p className="text-sm font-semibold text-smsg-900 dark:text-gray-100">
              {tpl.title}
            </p>
            <p className="text-[12px] leading-snug text-gray-600 dark:text-gray-400">
              {tpl.description}
            </p>
          </button>
        )
      })}
    </div>
  )
}
