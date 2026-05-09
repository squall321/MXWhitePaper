/* eslint-disable */
/**
 * One-shot generator for placeholder PWA icons.
 * Emits flat #1428A0 squares at 192/512 px into apps/web/public/.
 * Replace with real artwork before launch.
 *
 * Run:  node apps/web/scripts/gen-pwa-icons.cjs
 *
 * Uses only Node built-ins (zlib, fs) so no new deps are needed.
 */
const z = require('zlib')
const fs = require('fs')
const path = require('path')

function chunk(type, data) {
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  let c = 0xffffffff
  const buf = Buffer.concat([typeBuf, data])
  for (const b of buf) {
    c = c ^ b
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcBuf.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makePng(size, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const pixel = Buffer.from(rgb)
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.concat(Array(size).fill(pixel)),
  ])
  const raw = Buffer.concat(Array(size).fill(row))
  const idat = z.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = path.join(__dirname, '..', 'public')
const rgb = [0x14, 0x28, 0xa0]
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), makePng(size, rgb))
  console.log(`wrote ${path.join(out, `icon-${size}.png`)}`)
}
