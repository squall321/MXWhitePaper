/**
 * Lightweight ULID generator for client-side block/section ids.
 *
 * The BE accepts any 26-char Crockford base32 string for `id`. This helper
 * is intentionally minimal — it is NOT cryptographically rigorous, but it is
 * monotonic within the process so block lists keep insert order.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let lastTime = 0
let lastRand: number[] = []

function encodeTime(time: number): string {
  let t = time
  let out = ''
  for (let i = 0; i < 10; i++) {
    const idx = t % 32
    out = CROCKFORD[idx] + out
    t = Math.floor(t / 32)
  }
  return out
}

function encodeRand(rand: number[]): string {
  return rand.map((n) => CROCKFORD[n] ?? '0').join('')
}

function newRand(): number[] {
  const out: number[] = []
  for (let i = 0; i < 16; i++) out.push(Math.floor(Math.random() * 32))
  return out
}

/** Return a fresh 26-char ULID string. Monotonic within a millisecond. */
export function ulid(): string {
  const now = Date.now()
  if (now === lastTime) {
    // increment the random tail to preserve monotonicity
    for (let i = lastRand.length - 1; i >= 0; i--) {
      const cur = lastRand[i] ?? 0
      if (cur < 31) {
        lastRand[i] = cur + 1
        break
      }
      lastRand[i] = 0
    }
  } else {
    lastTime = now
    lastRand = newRand()
  }
  return encodeTime(now) + encodeRand(lastRand)
}
