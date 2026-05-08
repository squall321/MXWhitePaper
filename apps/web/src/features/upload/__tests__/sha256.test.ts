import { describe, it, expect } from 'vitest'
import { bufferToHex, sha256Hex } from '../sha256'

/**
 * SubtleCrypto is available in Node ≥ 16 under `globalThis.crypto.subtle`.
 * Vitest's default environment is `node`, so the same Web Crypto API the
 * browser exposes is reachable here without any setup.
 */
describe('sha256', () => {
  it('bufferToHex emits 64-char lowercase hex for a SHA-256 digest', async () => {
    const hash = await sha256Hex(new Uint8Array([0]))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches the known SHA-256 of the empty string', async () => {
    const hash = await sha256Hex(new Uint8Array([]))
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches the known SHA-256 of "abc" (RFC 6234)', async () => {
    const data = new TextEncoder().encode('abc')
    const hash = await sha256Hex(data)
    expect(hash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('bufferToHex pads single-digit byte values', () => {
    const buf = new Uint8Array([0x01, 0x0f, 0xff]).buffer
    expect(bufferToHex(buf)).toBe('010fff')
  })
})
