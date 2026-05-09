import { useState } from 'react'
import { Button } from '@/components/ui'
import {
  createServerTemplate,
  type CreateServerTemplateInput,
  type ServerTemplateCategory,
  type ServerTemplateScope,
} from './serverApi'
import type { DocumentJSONV10 } from '@/types/document'

interface Props {
  document: DocumentJSONV10
  open: boolean
  onClose: () => void
  onSaved?: (slug: string) => void
}

const CATEGORY_OPTIONS: ReadonlyArray<{
  value: ServerTemplateCategory
  label: string
}> = [
  { value: 'report', label: '보고서' },
  { value: 'collab', label: '협업' },
  { value: 'tech', label: '기술 문서' },
  { value: 'announce', label: '공지' },
  { value: 'custom', label: '기타' },
]

const SCOPE_OPTIONS: ReadonlyArray<{
  value: ServerTemplateScope
  label: string
  hint: string
}> = [
  { value: 'private', label: '비공개', hint: '나만' },
  { value: 'team', label: '팀', hint: '같은 팀원' },
  { value: 'org', label: '조직', hint: '모든 사용자' },
]

/**
 * Modal that turns the currently-open document into a server-published
 * template. Cycle 0020 entry point — opens from the doc-actions area in
 * `WikiArticle`. Posts the doc's `sections` straight to `/doc-templates`,
 * stripping IDs (the BE accepts opaque JSON; downstream `templateToSections`
 * regenerates ULIDs at instantiation time).
 */
export function SaveAsTemplateModal({ document, open, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(document.title)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<ServerTemplateCategory>('custom')
  const [scope, setScope] = useState<ServerTemplateScope>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const submit = async () => {
    if (!title.trim()) {
      setError('제목을 입력하세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body: CreateServerTemplateInput = {
        title: title.trim(),
        description: description.trim() || null,
        category,
        scope,
        // Strip IDs — they're regenerated when the template is instantiated.
        sections: (document.sections ?? []).map((sec) => ({
          ...sec,
          id: '' as unknown as string,
          blocks: sec.blocks ?? [],
          subsections: sec.subsections ?? [],
        })),
      }
      const out = await createServerTemplate(body)
      onSaved?.(out.slug)
      onClose()
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      setError(msg ?? (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-as-template-title"
      data-testid="save-as-template-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="save-as-template-title"
          className="text-lg font-semibold text-smsg-900 dark:text-gray-100"
        >
          템플릿으로 저장
        </h2>
        <p className="text-xs text-gray-500">
          이 문서의 섹션 구조를 조직 템플릿으로 발행합니다. 발행 후 다른
          사용자가 새 문서 시작 화면에서 선택할 수 있습니다.
        </p>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            템플릿 제목
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
            data-testid="template-title-input"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            설명 (선택)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
            data-testid="template-desc-input"
          />
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-gray-700 dark:text-gray-300">
            카테고리
          </legend>
          <div
            role="radiogroup"
            aria-label="카테고리"
            className="flex flex-wrap gap-1.5"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <label
                key={c.value}
                className={
                  'cursor-pointer rounded-full border px-3 py-1 text-xs ' +
                  (category === c.value
                    ? 'border-smsg-500 bg-smsg-500 text-white'
                    : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300')
                }
              >
                <input
                  type="radio"
                  name="template-category"
                  value={c.value}
                  checked={category === c.value}
                  onChange={() => setCategory(c.value)}
                  className="sr-only"
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-gray-700 dark:text-gray-300">
            공유 범위
          </legend>
          <div
            role="radiogroup"
            aria-label="공유 범위"
            className="flex flex-wrap gap-1.5"
          >
            {SCOPE_OPTIONS.map((s) => (
              <label
                key={s.value}
                className={
                  'cursor-pointer rounded-md border px-3 py-1.5 text-xs ' +
                  (scope === s.value
                    ? 'border-smsg-500 bg-smsg-50 text-smsg-900 dark:bg-gray-800'
                    : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300')
                }
              >
                <input
                  type="radio"
                  name="template-scope"
                  value={s.value}
                  checked={scope === s.value}
                  onChange={() => setScope(s.value)}
                  className="sr-only"
                />
                <span className="font-semibold">{s.label}</span>
                <span className="ml-1 text-[11px] text-gray-500 dark:text-gray-400">
                  ({s.hint})
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            data-testid="template-save-submit"
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}
