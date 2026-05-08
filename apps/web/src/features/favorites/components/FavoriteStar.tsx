import { useFavoritesStore } from '../store'

interface FavoriteStarProps {
  slug: string
  title: string
  /** Visual size variant. */
  size?: 'sm' | 'md'
  className?: string
  /** When true, prevents the parent <Link> from intercepting the click. */
  stopPropagation?: boolean
}

/**
 * Star toggle for the favorites store. Renders a filled star when the slug
 * is bookmarked, an outlined star otherwise. Used both in the document
 * reader header and on Home cards.
 */
export function FavoriteStar({
  slug,
  title,
  size = 'md',
  className,
  stopPropagation,
}: FavoriteStarProps) {
  const starred = useFavoritesStore((s) => s.items.some((it) => it && it.slug === slug))
  const toggle = useFavoritesStore((s) => s.toggle)
  const dim = size === 'sm' ? 14 : 18

  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `${title} 즐겨찾기 해제` : `${title} 즐겨찾기에 추가`}
      data-testid="favorite-star"
      data-slug={slug}
      onClick={(e) => {
        if (stopPropagation) {
          e.preventDefault()
          e.stopPropagation()
        }
        toggle(slug, title)
      }}
      className={[
        'inline-grid place-items-center rounded transition-colors duration-fast',
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        starred
          ? 'text-amber-500 hover:text-amber-600'
          : 'text-gray-300 hover:text-amber-500',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={starred ? '즐겨찾기 해제' : '즐겨찾기'}
    >
      {starred ? (
        <svg width={dim} height={dim} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 2.5l2.4 4.86 5.36.78-3.88 3.78.92 5.34L10 14.74 5.2 17.26l.92-5.34L2.24 8.14l5.36-.78L10 2.5z" />
        </svg>
      ) : (
        <svg width={dim} height={dim} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 2.5l2.4 4.86 5.36.78-3.88 3.78.92 5.34L10 14.74 5.2 17.26l.92-5.34L2.24 8.14l5.36-.78L10 2.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}
