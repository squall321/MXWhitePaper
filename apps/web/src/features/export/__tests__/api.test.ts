/**
 * 내보내기 API 헬퍼 단위 테스트.
 *
 * No jsdom — 프로젝트 정책 (uploadImage.test.ts 등 다수 선행 사례). 대신
 * `document` / `URL.createObjectURL` 을 globalThis 에 손수 박아 둔다. axios
 * 인스턴스만 mock 하면 trigger 경로(다운로드 anchor click) 는 전부 검증 가능.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { downloadMarkdown, downloadPdf, htmlExportUrl } from '../api'

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>

interface AnchorSpy {
  click: ReturnType<typeof vi.fn>
  href: string
  download: string
  style: { display: string }
}

let createdAnchors: AnchorSpy[] = []
let originalDocument: unknown
let originalURL: unknown
let originalSetTimeout: typeof setTimeout

beforeEach(() => {
  vi.clearAllMocks()
  createdAnchors = []

  originalDocument = (globalThis as { document?: unknown }).document
  originalURL = (globalThis as { URL?: unknown }).URL
  originalSetTimeout = globalThis.setTimeout

  // Lightweight document stub — only the methods triggerDownload uses.
  const fakeDoc = {
    createElement: vi.fn((tag: string) => {
      if (tag !== 'a') {
        return { click: vi.fn(), style: { display: '' } } as unknown
      }
      const anchor: AnchorSpy = {
        click: vi.fn(),
        href: '',
        download: '',
        style: { display: '' },
      }
      createdAnchors.push(anchor)
      return anchor as unknown
    }),
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
  }
  ;(globalThis as { document: unknown }).document = fakeDoc

  // URL stub — jsdom would normally provide createObjectURL.
  ;(globalThis as { URL: unknown }).URL = {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  }

  // Make setTimeout fire immediately so the revoke runs synchronously,
  // but don't break other tests' setTimeout consumers.
  globalThis.setTimeout = ((fn: () => void) => {
    fn()
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
})

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document
  } else {
    ;(globalThis as { document: unknown }).document = originalDocument
  }
  if (originalURL === undefined) {
    delete (globalThis as { URL?: unknown }).URL
  } else {
    ;(globalThis as { URL: unknown }).URL = originalURL
  }
  globalThis.setTimeout = originalSetTimeout
})

describe('export/api · htmlExportUrl()', () => {
  it('builds the namuwiki-style HTML download URL', () => {
    expect(htmlExportUrl('hello')).toBe(
      '/api/v1/documents/hello/export.html?style=namuwiki',
    )
  })

  it('encodes special characters in the slug', () => {
    expect(htmlExportUrl('한글-슬러그')).toBe(
      '/api/v1/documents/%ED%95%9C%EA%B8%80-%EC%8A%AC%EB%9F%AC%EA%B7%B8/export.html?style=namuwiki',
    )
  })
})

describe('export/api · downloadMarkdown()', () => {
  it('POSTs to /exports/markdown and triggers a .md download', async () => {
    const blob = new Blob(['# Title'], { type: 'text/markdown' })
    post.mockResolvedValueOnce({ data: blob })

    await downloadMarkdown('my-doc')

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, opts] = post.mock.calls[0]!
    expect(url).toBe('/exports/markdown')
    expect(body).toEqual({ slug: 'my-doc', include_metadata: true })
    expect((opts as { responseType?: string })?.responseType).toBe('blob')
    expect(createdAnchors).toHaveLength(1)
    expect(createdAnchors[0]!.download).toBe('my-doc.md')
    expect(createdAnchors[0]!.click).toHaveBeenCalledTimes(1)
  })

  it('forwards include_metadata=false', async () => {
    post.mockResolvedValueOnce({ data: new Blob(['x']) })
    await downloadMarkdown('doc', { includeMetadata: false })
    const [, body] = post.mock.calls[0]!
    expect(body).toEqual({ slug: 'doc', include_metadata: false })
  })

  it('rejects on server failure', async () => {
    post.mockRejectedValueOnce(new Error('boom'))
    await expect(downloadMarkdown('doc')).rejects.toThrow(/boom/)
    expect(createdAnchors).toHaveLength(0)
  })
})

describe('export/api · downloadPdf()', () => {
  it('POSTs to /exports/pdf and triggers a .pdf download on success', async () => {
    const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: 'application/pdf',
    })
    post.mockResolvedValueOnce({ data: blob })

    const result = await downloadPdf('paper')

    expect(result).toEqual({ kind: 'pdf' })
    expect(post).toHaveBeenCalledWith(
      '/exports/pdf',
      { slug: 'paper' },
      { responseType: 'blob' },
    )
    expect(createdAnchors).toHaveLength(1)
    expect(createdAnchors[0]!.download).toBe('paper.pdf')
  })

  it('returns a print-fallback hint on 501', async () => {
    post.mockRejectedValueOnce({ response: { status: 501 } })

    const result = await downloadPdf('paper')

    expect(result).toEqual({
      kind: 'fallback',
      hint: { fallback: 'print', url: '/docs/paper?print=1' },
    })
    expect(createdAnchors).toHaveLength(0)
  })

  it('propagates non-501 errors', async () => {
    post.mockRejectedValueOnce({ response: { status: 500 } })
    await expect(downloadPdf('paper')).rejects.toMatchObject({
      response: { status: 500 },
    })
  })
})
