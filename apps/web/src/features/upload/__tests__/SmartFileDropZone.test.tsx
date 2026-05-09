import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  SmartFileDropZone,
  processDroppedFiles,
  type ProcessDeps,
} from '../SmartFileDropZone'

function f(name: string, type: string, size = 16): File {
  return new File([new Uint8Array(size)], name, { type })
}

/**
 * Build a mock dependency bundle for `processDroppedFiles`. Each uploader
 * resolves with a synthetic record so the test can assert the resulting
 * insertBlock body.
 */
function makeDeps(overrides: Partial<ProcessDeps> = {}): {
  deps: ProcessDeps
  inserted: Array<{ section_id: string; block: { type: string } }>
} {
  const inserted: Array<{ section_id: string; block: { type: string } }> = []
  const deps: ProcessDeps = {
    uploadImage: vi.fn(async (file: File | Blob) => {
      const name = file instanceof File ? file.name : 'blob'
      return {
        image_id:
          '01IMG' +
          name.replace(/\W/g, '').toUpperCase().padEnd(20, '0').slice(0, 20),
        urls: { thumb: 't', view: 'v', orig: 'o' },
        width: 1,
        height: 1,
        dominant_color: '#000',
      }
    }) as unknown as ProcessDeps['uploadImage'],
    uploadFile: vi.fn(async (file: File) => ({
      fileId:
        '01FILE' +
        file.name.replace(/\W/g, '').toUpperCase().padEnd(19, '0').slice(0, 19),
      filename: file.name,
      size: file.size,
      mime: file.type,
      downloadUrl: `https://example/${file.name}`,
    })) as unknown as ProcessDeps['uploadFile'],
    insertBlock: vi.fn(async (_slug: string, body: { section_id: string; block: { type: string } }) => {
      inserted.push({
        section_id: body.section_id,
        block: { type: body.block.type },
      })
      return {
        document: { sections: [], metadata: {} } as never,
        etag: 'next-etag',
      }
    }) as unknown as ProcessDeps['insertBlock'],
    getEtag: () => 'etag-1',
    applySnapshot: vi.fn(),
    setConflict: vi.fn(),
    toastError: vi.fn(),
    toastWarn: vi.fn(),
    fileDownloadUrl: (id) => `/api/v1/files/${id}/download`,
    ...overrides,
  }
  return { deps, inserted }
}

describe('processDroppedFiles', () => {
  it('routes each file by MIME and inserts the matching block type', async () => {
    const { deps, inserted } = makeDeps()
    const onProgress = vi.fn()
    await processDroppedFiles({
      files: [
        f('a.png', 'image/png'),
        f('manual.pdf', 'application/pdf'),
        f('clip.mp4', 'video/mp4'),
        f('notes.txt', 'text/plain'),
      ],
      slug: 'doc-1',
      sectionId: '01SECTIONSECTIONSECTIONABC',
      onProgress,
      deps,
    })
    expect(deps.uploadImage).toHaveBeenCalledTimes(1)
    expect(deps.uploadFile).toHaveBeenCalledTimes(3)
    expect(inserted.map((i) => i.block.type)).toEqual([
      'image',
      'pdf',
      'video',
      'file',
    ])
    // Each file ended at 100%.
    const lastRows = onProgress.mock.calls[onProgress.mock.calls.length - 1]?.[0] as
      | Array<{ pct: number; error?: string }>
      | undefined
    expect(lastRows?.every((r) => r.pct === 100 && !r.error)).toBe(true)
  })

  it('caps the queue at 10 files and warns', async () => {
    const { deps } = makeDeps()
    const files = Array.from({ length: 13 }, (_, i) => f(`x${i}.png`, 'image/png'))
    await processDroppedFiles({
      files,
      slug: 'doc-1',
      sectionId: '01SECTIONSECTIONSECTIONABC',
      onProgress: () => {},
      deps,
    })
    expect(deps.uploadImage).toHaveBeenCalledTimes(10)
    expect(deps.toastWarn).toHaveBeenCalledWith(expect.stringContaining('10개만'))
  })

  it('rejects oversize files with a warn toast and skips them', async () => {
    const { deps } = makeDeps()
    const big = f('huge.bin', 'application/octet-stream', 31 * 1024 * 1024)
    const small = f('ok.png', 'image/png', 4)
    await processDroppedFiles({
      files: [big, small],
      slug: 'doc-1',
      sectionId: '01SECTIONSECTIONSECTIONABC',
      onProgress: () => {},
      deps,
    })
    expect(deps.toastWarn).toHaveBeenCalledWith(expect.stringContaining('30MB'))
    expect(deps.uploadImage).toHaveBeenCalledTimes(1)
    expect(deps.uploadFile).not.toHaveBeenCalled()
  })

  it('continues with the remaining files after one upload throws', async () => {
    const { deps, inserted } = makeDeps({
      uploadFile: (vi
        .fn()
        .mockRejectedValueOnce(new Error('네트워크 끊김'))
        .mockResolvedValueOnce({
          fileId: '01FILEOK000000000000000000',
          filename: 'good.txt',
          size: 4,
          mime: 'text/plain',
          downloadUrl: 'x',
        }) as unknown) as ProcessDeps['uploadFile'],
    })
    await processDroppedFiles({
      files: [f('bad.txt', 'text/plain'), f('good.txt', 'text/plain')],
      slug: 'doc-1',
      sectionId: '01SECTIONSECTIONSECTIONABC',
      onProgress: () => {},
      deps,
    })
    // Bad file → error toast; good file still inserted.
    expect(deps.toastError).toHaveBeenCalledWith(
      expect.stringContaining('bad.txt'),
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.block.type).toBe('file')
  })

  it('aborts the loop on a missing etag (session expired)', async () => {
    const { deps } = makeDeps({ getEtag: () => null })
    await processDroppedFiles({
      files: [f('a.png', 'image/png'), f('b.png', 'image/png')],
      slug: 'doc-1',
      sectionId: '01SECTIONSECTIONSECTIONABC',
      onProgress: () => {},
      deps,
    })
    expect(deps.toastError).toHaveBeenCalledWith(expect.stringContaining('세션'))
    expect(deps.insertBlock).not.toHaveBeenCalled()
  })
})

describe('<SmartFileDropZone />', () => {
  it('renders its children inside a wrapper marked for drop', () => {
    const html = renderToStaticMarkup(
      <SmartFileDropZone slug="doc-1" sectionId={'01SECTIONSECTIONSECTIONABC'}>
        <span>child-marker</span>
      </SmartFileDropZone>,
    )
    expect(html).toContain('data-smart-file-dropzone')
    expect(html).toContain('child-marker')
    // Overlay only renders during dragOver state — initial markup has no overlay.
    expect(html).not.toContain('파일 떨어뜨려서 추가')
  })
})
