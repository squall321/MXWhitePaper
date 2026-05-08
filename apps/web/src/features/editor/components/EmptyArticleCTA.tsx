interface EmptyArticleCTAProps {
  /** Called when one of the example chips is clicked. */
  onSelect?: (kind: 'paragraph' | 'image' | 'table' | 'chart') => void
}

const CHIPS: { kind: 'paragraph' | 'image' | 'table' | 'chart'; label: string }[] = [
  { kind: 'paragraph', label: '글' },
  { kind: 'image', label: '이미지' },
  { kind: 'table', label: '표' },
  { kind: 'chart', label: '차트' },
]

/**
 * Inline CTA shown when the first section of a freshly-created doc has zero
 * blocks. Encourages the user to type `/` and offers four common starting
 * blocks as one-click chips.
 */
export function EmptyArticleCTA({ onSelect }: EmptyArticleCTAProps) {
  return (
    <div
      data-empty-article-cta
      className="rounded-lg border border-dashed border-smsg-100 bg-smsg-100/30 px-5 py-6 text-center"
    >
      <p className="text-sm text-smsg-900">
        본문이 비어있어요.{' '}
        <kbd className="rounded border border-gray-300 bg-white px-1.5 font-mono text-xs">/</kbd>{' '}
        를 눌러 블록을 추가하세요.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.kind}
            type="button"
            onClick={() => onSelect?.(c.kind)}
            className="rounded-full border border-smsg-100 bg-white px-3 py-1 text-xs font-medium text-smsg-700 hover:border-smsg-500 hover:bg-smsg-100"
          >
            + {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}
