import { describe, it, expect, vi } from 'vitest'

/**
 * canvasEncode lives in a DOM-only module (HTMLCanvasElement, Image). We
 * exercise the FUNCTION SIGNATURE here with a stubbed `document.createElement`
 * so we can assert the wiring without jsdom.
 */

describe('canvasEncode wiring', () => {
  it('cropImageToBlob calls drawImage with the rect and resolves Blob', async () => {
    const drawImage = vi.fn()
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected tag ${tag}`)
        return fakeCanvas
      },
    })
    const { cropImageToBlob } = await import('../canvasEncode')
    const fakeImg = {
      naturalWidth: 200,
      naturalHeight: 100,
    } as unknown as HTMLImageElement
    const blob = await cropImageToBlob(fakeImg, { x: 10, y: 20, w: 50, h: 40 })
    expect(blob).toBeInstanceOf(Blob)
    expect(drawImage).toHaveBeenCalledWith(
      fakeImg,
      10,
      20,
      50,
      40,
      0,
      0,
      50,
      40,
    )
    expect(fakeCanvas.width).toBe(50)
    expect(fakeCanvas.height).toBe(40)
    vi.unstubAllGlobals()
  })

  it('rotateImageToBlob swaps dimensions for 90°', async () => {
    const drawImage = vi.fn()
    const translate = vi.fn()
    const rotate = vi.fn()
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, translate, rotate }),
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement
    vi.stubGlobal('document', {
      createElement: () => fakeCanvas,
    })
    const { rotateImageToBlob } = await import('../canvasEncode')
    const fakeImg = {
      naturalWidth: 300,
      naturalHeight: 100,
    } as unknown as HTMLImageElement
    const blob = await rotateImageToBlob(fakeImg, 90)
    expect(blob).toBeInstanceOf(Blob)
    expect(fakeCanvas.width).toBe(100)
    expect(fakeCanvas.height).toBe(300)
    expect(rotate).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
