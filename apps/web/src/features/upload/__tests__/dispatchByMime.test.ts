import { describe, it, expect } from 'vitest'
import { dispatchByMime } from '../dispatchByMime'

function f(name: string, type: string): File {
  return new File([new Uint8Array([0])], name, { type })
}

describe('dispatchByMime()', () => {
  it('routes image/* to image / uploadImage', () => {
    expect(dispatchByMime(f('a.png', 'image/png'))).toEqual({
      kind: 'image',
      uploader: 'image',
    })
    expect(dispatchByMime(f('a.jpg', 'image/jpeg'))).toEqual({
      kind: 'image',
      uploader: 'image',
    })
    expect(dispatchByMime(f('a.gif', 'image/gif'))).toEqual({
      kind: 'image',
      uploader: 'image',
    })
  })

  it('routes application/pdf to pdf / uploadFile', () => {
    expect(dispatchByMime(f('manual.pdf', 'application/pdf'))).toEqual({
      kind: 'pdf',
      uploader: 'file',
    })
  })

  it('falls back to .pdf extension when MIME is empty', () => {
    expect(dispatchByMime(f('manual.pdf', ''))).toEqual({
      kind: 'pdf',
      uploader: 'file',
    })
  })

  it('routes video/* to video / uploadFile', () => {
    expect(dispatchByMime(f('clip.mp4', 'video/mp4'))).toEqual({
      kind: 'video',
      uploader: 'file',
    })
    expect(dispatchByMime(f('clip.webm', 'video/webm'))).toEqual({
      kind: 'video',
      uploader: 'file',
    })
  })

  it('uses video extensions when MIME is missing', () => {
    expect(dispatchByMime(f('movie.mov', ''))).toEqual({
      kind: 'video',
      uploader: 'file',
    })
  })

  it('falls back to file/file for everything else', () => {
    expect(
      dispatchByMime(
        f(
          'sheet.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ),
    ).toEqual({ kind: 'file', uploader: 'file' })
    expect(dispatchByMime(f('notes.txt', 'text/plain'))).toEqual({
      kind: 'file',
      uploader: 'file',
    })
    expect(dispatchByMime(f('archive.zip', 'application/zip'))).toEqual({
      kind: 'file',
      uploader: 'file',
    })
  })

  it('handles uppercase MIME types', () => {
    expect(dispatchByMime(f('a.PNG', 'IMAGE/PNG'))).toEqual({
      kind: 'image',
      uploader: 'image',
    })
  })
})
