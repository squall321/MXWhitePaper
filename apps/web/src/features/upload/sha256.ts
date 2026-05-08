/**
 * Browser SHA-256 helpers used by the image-upload pipeline.
 *
 * The BE deduplicates uploads by content hash (`sha256`), so we compute it on
 * the client BEFORE issuing `/uploads/image/init`. If the hash already exists
 * the server short-circuits and returns the existing image record, skipping
 * the presigned PUT entirely.
 */

const HEX = '0123456789abcdef'

/** Convert an ArrayBuffer of byte values to a 64-char lowercase hex string. */
export function bufferToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < view.length; i++) {
    const b = view[i] ?? 0
    out += HEX[(b >>> 4) & 0xf]
    out += HEX[b & 0xf]
  }
  return out
}

/**
 * SHA-256 of an ArrayBuffer / TypedArray. Returns a 64-char lowercase hex
 * string. Backed by the SubtleCrypto Web API which is available in all
 * evergreen browsers and Node ≥ 16 (where `globalThis.crypto.subtle` is
 * exposed under the same surface).
 */
export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  // Always normalize to a fresh ArrayBuffer copy so the SubtleCrypto types
  // accept it — Uint8Array.buffer can be a SharedArrayBuffer in some envs.
  let bytes: Uint8Array
  if (input instanceof Uint8Array) bytes = input
  else bytes = new Uint8Array(input)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) as
    | SubtleCrypto
    | undefined
  if (!subtle) {
    throw new Error('SubtleCrypto unavailable — cannot compute sha256')
  }
  const digest = await subtle.digest('SHA-256', copy.buffer)
  return bufferToHex(digest)
}

/**
 * Hash a `File` (or `Blob`) by reading it as an ArrayBuffer and SHA-256-ing it.
 * For huge files (>~50MB) this incurs a memory copy; that's acceptable here
 * because the upload spec caps image size at 25MB.
 */
export async function hashFile(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer()
  return sha256Hex(buf)
}
