import { useEffect, useRef, useState } from 'react'

/**
 * Returns true when the user has recently pasted (or attempted to paste) an
 * image into the document. The flag lingers for `ttlMs` so the UI affordance
 * (e.g. a glow on the QuickInsertBar's image button) stays visible long
 * enough for the user to act on it.
 *
 * We intentionally do NOT touch `navigator.clipboard.read()` — that requires
 * a user gesture in most browsers and a permission grant. Reacting to the
 * native `paste` event is enough for the affordance: Chrome/Firefox/Safari
 * all surface image entries via `event.clipboardData.items`.
 */
export function useClipboardImage(ttlMs = 15000): boolean {
  const [hasImage, setHasImage] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it && it.kind === 'file' && it.type.startsWith('image/')) {
          setHasImage(true)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setHasImage(false), ttlMs)
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('paste', onPaste)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [ttlMs])

  return hasImage
}
