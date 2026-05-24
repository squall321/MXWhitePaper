/**
 * Tests for ZebraToggle — pure stateless wrapper around a checkbox.
 *
 * Following the project convention (see CellBlockEditor.test.tsx header)
 * we avoid jsdom + @testing-library. The component carries no hooks so
 * we just render it via SSR for structural checks and invoke its
 * onChange handler directly through the JSX tree for behaviour checks.
 */
import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ZebraToggle } from '../ZebraToggle'
import type { ZebraBlockType } from '../zebra'

describe('ZebraToggle', () => {
  test('defaults to checked when options is undefined', () => {
    const html = renderToStaticMarkup(
      <ZebraToggle blockType="list" options={undefined} onChange={() => {}} />,
    )
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('data-zebra-toggle="list"')
  })

  test('respects explicit stripe=false', () => {
    const html = renderToStaticMarkup(
      <ZebraToggle
        blockType="bibliography"
        options={{ stripe: false }}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('checked=""')
  })

  test('onChange flips stripe when invoked', () => {
    const onChange = vi.fn()
    const el = ZebraToggle({
      blockType: 'kpi-cards',
      options: undefined,
      onChange,
    }) as JSX.Element & {
      props: { children: Array<JSX.Element & { props: { onChange: (e: unknown) => void } }> }
    }
    const input = el.props.children[0]
    input.props.onChange({ target: { checked: false } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ stripe: false })
  })

  test('every ZebraBlockType surfaces data-zebra-toggle attribute', () => {
    const types: ZebraBlockType[] = [
      'table',
      'spreadsheet',
      'list',
      'kpi-cards',
      'bibliography',
      'figure-index',
    ]
    for (const t of types) {
      const html = renderToStaticMarkup(
        <ZebraToggle blockType={t} options={undefined} onChange={() => {}} />,
      )
      expect(html).toContain(`data-zebra-toggle="${t}"`)
    }
  })
})
