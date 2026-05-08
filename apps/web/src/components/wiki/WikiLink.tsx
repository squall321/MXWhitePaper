import { useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { useDocumentExists } from '@/features/document/hooks/useDocumentExists'

interface WikiLinkProps {
  slug: string
  anchor?: string
  display?: string
}

/**
 * Internal wiki link.
 *
 *   - Live (slug exists)   → blue `<a href="/docs/<slug>#section-<anchor>">`.
 *   - Missing (404)        → red link; click navigates to `/docs/<slug>?create=1`
 *                            (creation flow lands in Sprint 4).
 *   - Pending / network    → render as if-exists (blue) so the page doesn't
 *                            flash red on first paint.
 */
export function WikiLink({ slug, anchor, display }: WikiLinkProps) {
  const navigate = useNavigate()
  const { data: exists, isPending } = useDocumentExists(slug)

  const label = display ?? slug
  const href = anchor
    ? `/docs/${encodeURIComponent(slug)}#section-${anchor}`
    : `/docs/${encodeURIComponent(slug)}`

  // While loading we render the blue variant — the cache is shared so most
  // links resolve instantly anyway.
  const isMissing = exists === false && !isPending

  if (isMissing) {
    // Missing target → land on the new-doc wizard with the slug pre-filled,
    // so a click straight from a red wiki-link starts authoring immediately.
    const target = `/docs/new?slug=${encodeURIComponent(slug)}`
    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      navigate(target)
    }
    return (
      <a
        href={target}
        onClick={handleClick}
        className="text-link-missing hover:underline"
        title={`'${slug}' 문서가 아직 없습니다. 클릭해 생성하세요.`}
      >
        {label}
      </a>
    )
  }

  return (
    <a
      href={href}
      className="text-link hover:underline"
      title={anchor ? `${slug} #${anchor}` : slug}
    >
      {label}
    </a>
  )
}
