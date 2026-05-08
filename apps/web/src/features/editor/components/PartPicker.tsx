import { useMemo } from 'react'
import { useOrgTree } from '@/features/org/hooks/useOrgTree'
import { useEditorStore } from '../state'
import { putDocument } from '../api'
import { toast } from '@/components/ui/Toast'
import type { Slug } from '@/types/document'

interface PartPickerProps {
  slug: Slug
}

interface PartOption {
  slug: string
  /** Display label like "MX 사업부 / 개발실 / HE팀 / CAE그룹". */
  label: string
}

/**
 * Select-style dropdown that lets an editor change the document's
 * `metadata.part` to any existing part slug. Persists immediately via
 * a full-document PUT so the change is durable even before the next
 * autosave cycle.
 */
export function PartPicker({ slug }: PartPickerProps) {
  const { data: tree } = useOrgTree()
  const draft = useEditorStore((s) => s.draft)
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)

  const options = useMemo<PartOption[]>(() => {
    if (!tree) return []
    const out: PartOption[] = []
    for (const d of tree) {
      for (const t of d.teams) {
        for (const g of t.groups) {
          for (const p of g.parts) {
            out.push({
              slug: p.slug,
              label: `${d.name} / ${t.name} / ${g.name} / ${p.name}`,
            })
          }
        }
      }
    }
    return out
  }, [tree])

  if (!draft) return null

  const current = draft.metadata?.part ?? ''

  async function onChange(next: string) {
    if (!draft || !etag) return
    const updated = {
      ...draft,
      metadata: {
        ...draft.metadata,
        part: next || undefined,
      },
    }
    try {
      const result = await putDocument(slug, updated, etag, '분류 변경')
      applySnapshot(result.document, result.etag)
      toast.success('분류가 변경되었습니다.')
    } catch (err) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message ?? '분류 변경 실패')
    }
  }

  return (
    <label className="hidden items-center gap-1.5 text-xs text-gray-700 sm:inline-flex">
      <span className="text-gray-500">분류</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 max-w-[14rem] rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-800 hover:border-smsg-500 focus:border-smsg-500 focus:outline-none focus:ring-1 focus:ring-smsg-500"
        data-testid="part-picker"
        aria-label="문서 분류"
      >
        <option value="">미배치</option>
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
