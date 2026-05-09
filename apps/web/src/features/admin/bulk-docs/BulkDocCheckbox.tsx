import { useAuthStore } from '@/features/auth/store'
import { useBulkDocStore } from './bulkDocStore'

/**
 * `<BulkDocCheckbox slug="..." />` — admin-only row checkbox that toggles
 * the slug in `bulkDocStore`. Renders nothing for non-admins, so list pages
 * can drop this into every row without role-gating logic.
 *
 * The wrapping `<label>` swallows clicks so the row's link/`<Card>` doesn't
 * navigate when the user just wants to flip the checkbox.
 */
export function BulkDocCheckbox({
  slug,
  className,
}: {
  slug: string
  className?: string
}) {
  const role = useAuthStore((s) => s.user?.role)
  const checked = useBulkDocStore((s) => s.selected.has(slug))
  const toggle = useBulkDocStore((s) => s.toggle)

  if (role !== 'admin') return null

  return (
    <label
      onClick={(e) => e.stopPropagation()}
      className={
        'inline-flex shrink-0 cursor-pointer items-center justify-center p-1 ' +
        (className ?? '')
      }
      data-testid={`bulk-doc-checkbox-${slug}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          e.stopPropagation()
          toggle(slug)
        }}
        aria-label={`문서 ${slug} 선택`}
        className="h-4 w-4 cursor-pointer accent-smsg-700"
      />
    </label>
  )
}
