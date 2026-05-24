import type { ZebraBlockType, ZebraOpts } from './zebra'

interface Props {
  blockType: ZebraBlockType
  options: ZebraOpts | undefined
  onChange: (next: { stripe: boolean }) => void
  label?: string
}

/**
 * Shared "줄무늬" checkbox surfaced from the block editors that opted in
 * to zebra-striping. Stays a single source of truth so the contract
 * (`stripe !== false` ⇒ ON) is enforced in one place instead of being
 * re-implemented per editor.
 *
 * The wrapper carries a `data-zebra-toggle="{blockType}"` attribute that
 * tests and E2E checks can target without coupling to the exact DOM
 * structure of the host editor.
 */
export function ZebraToggle({
  blockType,
  options,
  onChange,
  label = '줄무늬',
}: Props) {
  const checked = options?.stripe !== false
  return (
    <label
      data-zebra-toggle={blockType}
      className="flex items-center gap-1 text-xs text-gray-600"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange({ stripe: e.target.checked })}
        aria-label={`${label} 표시`}
      />
      {label}
    </label>
  )
}
