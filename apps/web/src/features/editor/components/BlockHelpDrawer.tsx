import { Drawer } from '@/components/ui'

interface HelpExample {
  title?: string
  /** Plain text or pre-formatted code-ish snippet shown in a box. */
  body: string
}

export interface BlockHelpContent {
  /** Short heading shown on the drawer. */
  title: string
  /** 1-3 paragraphs explaining the schema. Markdown-lite — no rendering, plain text. */
  description: string[]
  /** 1-2 worked examples. */
  examples: HelpExample[]
}

interface Props {
  open: boolean
  onClose: () => void
  content: BlockHelpContent
}

/**
 * Lightweight per-block help drawer. Mounted next to the block's empty-state
 * CTA so users can read up on the schema without leaving the editor. Markdown
 * rendering is intentionally limited — we only need plain text + a code box,
 * and pulling in a markdown parser for that would be overkill.
 */
export function BlockHelpDrawer({ open, onClose, content }: Props) {
  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={`${content.title} 도움말`}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-smsg-900 dark:text-gray-100">{content.title}</h2>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          ✕
        </button>
      </div>
      <div className="space-y-4 px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
        {content.description.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {content.examples.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              예시
            </h3>
            <div className="space-y-3">
              {content.examples.map((ex, i) => (
                <div key={i} className="rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
                  {ex.title && (
                    <p className="mb-1 text-[12px] font-semibold text-smsg-900 dark:text-gray-100">{ex.title}</p>
                  )}
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-700 dark:text-gray-300">
                    {ex.body}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
