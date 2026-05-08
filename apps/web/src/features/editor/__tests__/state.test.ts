import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../state'
import type { DocumentJSONV10 } from '@/types/document'

const minimalDoc: DocumentJSONV10 = {
  schema_version: '1.0',
  id: '01TEST0000000000000000ROOT',
  slug: 'test',
  title: 'Test Doc',
  metadata: {
    division: 'MX',
    owners: ['someone'],
    tags: [],
    confidentiality: 'internal',
  },
  sections: [
    {
      id: '01TEST0000000000000000SEC1',
      level: 1,
      title: 'a',
      blocks: [],
      subsections: [],
    },
  ],
}

describe('editor/state', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
  })

  it('starts in reader mode with no draft', () => {
    const s = useEditorStore.getState()
    expect(s.mode.kind).toBe('reader')
    expect(s.draft).toBeNull()
    expect(s.dirty).toBe(false)
  })

  it('bind() loads a document and clears dirty', () => {
    useEditorStore.getState().bind('test', minimalDoc, 'etag-1')
    const s = useEditorStore.getState()
    expect(s.slug).toBe('test')
    expect(s.draft).toBe(minimalDoc)
    expect(s.etag).toBe('etag-1')
    expect(s.dirty).toBe(false)
  })

  it('enterQuickEdit() switches mode while inside reader', () => {
    useEditorStore.getState().bind('test', minimalDoc, 'etag-1')
    useEditorStore.getState().enterQuickEdit('01TEST0000000000000000SEC1')
    expect(useEditorStore.getState().mode).toEqual({
      kind: 'quickEdit',
      sectionId: '01TEST0000000000000000SEC1',
    })
  })

  it('enterQuickEdit() is a no-op while in fullEdit', () => {
    useEditorStore.getState().enterFullEdit()
    useEditorStore.getState().enterQuickEdit('01TEST0000000000000000SEC1')
    expect(useEditorStore.getState().mode.kind).toBe('fullEdit')
  })

  it('setDraft() flips dirty=true; applyServerSnapshot() clears it', () => {
    useEditorStore.getState().bind('test', minimalDoc, 'etag-1')
    useEditorStore.getState().setDraft({ ...minimalDoc, title: 'Edited' })
    expect(useEditorStore.getState().dirty).toBe(true)
    useEditorStore.getState().applyServerSnapshot(minimalDoc, 'etag-2')
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(useEditorStore.getState().etag).toBe('etag-2')
    expect(useEditorStore.getState().autoSaveStatus).toBe('saved')
  })

  it('exitToReader() returns to reader mode', () => {
    useEditorStore.getState().enterFullEdit()
    useEditorStore.getState().exitToReader()
    expect(useEditorStore.getState().mode.kind).toBe('reader')
  })

  it('reset() restores defaults', () => {
    useEditorStore.getState().bind('test', minimalDoc, 'etag-1')
    useEditorStore.getState().enterFullEdit()
    useEditorStore.getState().setDraft({ ...minimalDoc, title: 'X' })
    useEditorStore.getState().reset()
    const s = useEditorStore.getState()
    expect(s.slug).toBeNull()
    expect(s.draft).toBeNull()
    expect(s.dirty).toBe(false)
    expect(s.mode.kind).toBe('reader')
  })
})
