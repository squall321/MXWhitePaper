import type { MathBlock } from '@/types/document'
import { MathBlockView } from '@/components/blocks/MathBlock'

interface Props {
  block: MathBlock
  onChange: (next: MathBlock) => void
}

/**
 * Sprint 6 math editor — textarea + live preview. The preview re-renders on
 * every keystroke since KaTeX is fast enough at this scale.
 */
export function MathBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="block">
          <span className="mb-1 block text-gray-600">표시 방식</span>
          <select
            value={block.display ?? 'block'}
            onChange={(e) =>
              onChange({ ...block, display: e.target.value as 'block' | 'inline' })
            }
            className="w-full rounded border border-gray-300 px-2 py-1"
          >
            <option value="block">block (수식 한 줄)</option>
            <option value="inline">inline (문장 안)</option>
          </select>
        </label>
      </div>
      <label className="block text-xs">
        <span className="mb-1 block text-gray-600">LaTeX</span>
        <textarea
          value={block.expression}
          onChange={(e) => onChange({ ...block, expression: e.target.value })}
          rows={3}
          className="w-full rounded border border-gray-300 px-2 py-1 font-mono"
        />
      </label>
      <div className="rounded border border-gray-200 bg-white p-2">
        <MathBlockView block={block} />
      </div>
    </div>
  )
}
