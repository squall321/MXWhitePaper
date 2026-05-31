/**
 * Sprint-7 — FlowExcalidrawEditor unit tests.
 *
 * The repo has no @testing-library/react, so we can't mount the live
 * canvas (which needs DOM + Suspense + the 4 MB lazy chunk anyway). We
 * exercise the pure helpers that drive persistence — serialiseScene +
 * parseExcalidrawScene round-trip — which is where the actual
 * data-loss risk lives.
 */
import { describe, it, expect } from 'vitest'
import { serialiseScene } from '../FlowExcalidrawEditor'
import { parseExcalidrawScene } from '@/components/blocks/FlowBlock'
import type { ExcalidrawScene } from '@/components/blocks/FlowBlock'

describe('serialiseScene', () => {
  it('emits the canonical Excalidraw scene envelope', () => {
    const scene: ExcalidrawScene = {
      elements: [{ id: 'r1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#fff' },
      files: {},
    }
    const out = JSON.parse(serialiseScene(scene)) as Record<string, unknown>
    expect(out.type).toBe('excalidraw')
    expect(out.version).toBe(2)
    expect(out.source).toBe('mxwp-editor')
    expect(Array.isArray(out.elements)).toBe(true)
    expect(out.appState).toEqual({ viewBackgroundColor: '#fff' })
    expect(out.files).toEqual({})
  })

  it('survives a parse/serialise round-trip through parseExcalidrawScene', () => {
    const scene: ExcalidrawScene = {
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 },
        { id: 'b', type: 'ellipse', x: 50, y: 50, width: 40, height: 40 },
      ],
      appState: { theme: 'light' },
      files: {},
    }
    const result = parseExcalidrawScene(serialiseScene(scene))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.scene.elements).toHaveLength(2)
      expect(result.scene.appState?.theme).toBe('light')
    }
  })

  it('defaults appState and files to {} when callers omit them', () => {
    const out = JSON.parse(
      serialiseScene({ elements: [] } as unknown as ExcalidrawScene),
    ) as Record<string, unknown>
    expect(out.appState).toEqual({})
    expect(out.files).toEqual({})
  })

  it('produces deterministic output for the same scene (debounce dedupe key)', () => {
    const scene: ExcalidrawScene = {
      elements: [{ id: 'r', type: 'rectangle' }],
      appState: {},
      files: {},
    }
    expect(serialiseScene(scene)).toBe(serialiseScene(scene))
  })
})
