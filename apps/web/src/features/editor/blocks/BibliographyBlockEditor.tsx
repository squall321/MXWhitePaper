import { useEffect, useRef, useState } from 'react'
import type { BibliographyBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { ZebraToggle } from './ZebraToggle'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: BibliographyBlock
}

type EntryDraft = BibliographyBlock['entries'][number]

/**
 * BibliographyBlockEditor — minimal editing surface for a reference list.
 *
 * Each entry has three free-text fields (key / text / url). Edits are
 * mirrored locally for immediate feedback and persisted via
 * `patchBlock` after an 800 ms idle, matching the other block editors.
 * Adding / removing rows is instant (no debounce) so users get the
 * structural feedback right away.
 *
 * Design notes:
 *   - We don't try to parse author / year / journal. Reference styles are
 *     too varied; round-tripping the raw text from DOCX is the only sane
 *     bottom line.
 *   - The schema requires at least one entry — removing the last entry
 *     replaces it with an empty placeholder rather than dropping the
 *     block entirely.
 */
export function BibliographyBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<BibliographyBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocal(block)
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedule = (next: BibliographyBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: BibliographyBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          title: next.title,
          style: next.style,
          entries: next.entries,
          ...(next.options ? { options: next.options } : {}),
        } as Partial<BibliographyBlock>,
        etag,
        t('editor.bibliography.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.common.conflict'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  const setEntry = (idx: number, patch: Partial<EntryDraft>) => {
    const entries = local.entries.map((e, i) =>
      i === idx ? { ...e, ...patch } : e,
    ) as BibliographyBlock['entries']
    schedule({ ...local, entries })
  }

  const addEntry = () => {
    const entries = [...local.entries, { text: '' }] as BibliographyBlock['entries']
    schedule({ ...local, entries })
  }

  const removeEntry = (idx: number) => {
    let next: EntryDraft[] = local.entries.filter((_, i) => i !== idx)
    if (next.length === 0) next = [{ text: '' }]
    schedule({ ...local, entries: next as BibliographyBlock['entries'] })
  }

  return (
    <section
      data-bibliography-block-editor
      data-block-id={block.id}
      className="my-4 space-y-2 rounded border border-smsg-100 bg-white p-3 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={local.title ?? ''}
          onChange={(e) =>
            schedule({ ...local, title: e.target.value || undefined })
          }
          placeholder={t('editor.bibliography.titlePlaceholder')}
          aria-label={t('editor.bibliography.title')}
          className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-smsg-900 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
        />
        <ZebraToggle
          blockType="bibliography"
          options={local.options}
          onChange={({ stripe }) =>
            schedule({ ...local, options: { ...local.options, stripe } })
          }
        />
      </div>

      <ol className="list-none space-y-2 pl-0">
        {local.entries.map((entry, idx) => (
          <li
            key={idx}
            className="group/row flex items-start gap-2 rounded border border-transparent px-1 py-1 hover:border-gray-200"
          >
            <span className="mt-1 w-6 shrink-0 text-right text-xs text-gray-500">
              [{idx + 1}]
            </span>
            <div className="flex-1 space-y-1">
              <input
                type="text"
                value={entry.key ?? ''}
                onChange={(e) =>
                  setEntry(idx, { key: e.target.value || undefined })
                }
                placeholder={t('editor.bibliography.keyPlaceholder')}
                aria-label={t('editor.bibliography.key')}
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-gray-700 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
              />
              <input
                type="text"
                value={entry.text}
                onChange={(e) => setEntry(idx, { text: e.target.value })}
                placeholder={t('editor.bibliography.textPlaceholder')}
                aria-label={t('editor.bibliography.text')}
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-smsg-900 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
              />
              <input
                type="text"
                value={entry.url ?? ''}
                onChange={(e) =>
                  setEntry(idx, { url: e.target.value || undefined })
                }
                placeholder={t('editor.bibliography.urlPlaceholder')}
                aria-label={t('editor.bibliography.url')}
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-700 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => removeEntry(idx)}
              aria-label={t('editor.bibliography.remove', { n: idx + 1 })}
              className="rounded px-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover/row:opacity-100"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={addEntry}
          className="rounded border border-dashed border-smsg-300 px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          {t('editor.bibliography.addEntry')}
        </button>
        {error && (
          <span role="status" aria-live="polite" className="text-red-600">
            {error}
          </span>
        )}
      </div>
    </section>
  )
}
