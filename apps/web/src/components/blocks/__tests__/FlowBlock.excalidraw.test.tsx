import { describe, it, expect } from 'vitest'
import { parseExcalidrawScene } from '../FlowBlock'

describe('parseExcalidrawScene', () => {
  it('returns ok with the scene for a valid payload', () => {
    const source = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [
        { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    const result = parseExcalidrawScene(source)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.scene.elements).toHaveLength(1)
      expect(result.scene.appState?.viewBackgroundColor).toBe('#ffffff')
    }
  })

  it('returns parse error for invalid JSON', () => {
    const result = parseExcalidrawScene('not-json{')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('parse')
      expect(result.message.length).toBeGreaterThan(0)
    }
  })

  it('returns shape error when JSON parses but elements is missing', () => {
    const result = parseExcalidrawScene(JSON.stringify({ type: 'excalidraw', version: 2 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('shape')
  })

  it('returns shape error when elements is not an array', () => {
    const result = parseExcalidrawScene(JSON.stringify({ elements: 'oops' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('shape')
  })

  it('returns shape error for primitive payloads', () => {
    expect(parseExcalidrawScene('null').ok).toBe(false)
    expect(parseExcalidrawScene('42').ok).toBe(false)
    expect(parseExcalidrawScene('"a string"').ok).toBe(false)
  })

  it('accepts a scene with no appState or files (both optional)', () => {
    const result = parseExcalidrawScene(JSON.stringify({ elements: [] }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.scene.appState).toBeUndefined()
      expect(result.scene.files).toBeUndefined()
    }
  })
})
