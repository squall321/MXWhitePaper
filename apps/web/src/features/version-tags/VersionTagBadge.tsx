import type { VersionTag } from './api'

interface VersionTagBadgeProps {
  tag: VersionTag
  className?: string
}

/**
 * Renders a single tag pill that sits next to a version number in the
 * version history list / diff picker. Locked tags get an extra 🔒.
 */
export function VersionTagBadge({ tag, className }: VersionTagBadgeProps) {
  return (
    <span
      data-testid="version-tag-badge"
      data-tag-name={tag.tag_name}
      data-locked={tag.is_locked ? '' : undefined}
      title={tag.description ?? tag.tag_name}
      className={`inline-flex items-center gap-1 rounded border border-smsg-300 bg-smsg-50 px-1.5 py-0.5 text-[10px] font-medium text-smsg-900 ${
        className ?? ''
      }`}
    >
      <span aria-hidden="true">🏷</span>
      <span>{tag.tag_name}</span>
      {tag.is_locked && <span aria-hidden="true">🔒</span>}
    </span>
  )
}
