import { useEffect, useRef } from 'react'
import { postRead, postReadAnchor } from '../api'
import { getAnchorBlockId } from '@/features/presence/usePresence'

const FLUSH_INTERVAL_MS = 30_000

/**
 * 페이지가 visible 상태일 때 1초씩 누적, 30초마다 또는 unmount 시점에
 * BE 로 flush. 탭 hidden, 다른 라우트로 이동, brower close 모두 같은
 * "총 누적 read_seconds" 가 누락 없이 BE 에 도달하도록 best-effort 동작.
 *
 * 실패는 silent — 분석/책갈피용 부수 정보이지 critical path 가 아니다.
 */
export function useReadingTimeTracker(slug: string | undefined) {
  const accumulatedRef = useRef<number>(0)
  const lastTickRef = useRef<number>(Date.now())
  const slugRef = useRef<string | undefined>(slug)
  const lastAnchorRef = useRef<string | null>(null)

  useEffect(() => {
    slugRef.current = slug
  }, [slug])

  useEffect(() => {
    if (!slug) return
    if (typeof window === 'undefined') return
    if (typeof document === 'undefined') return

    let timer: ReturnType<typeof setInterval> | null = null
    accumulatedRef.current = 0
    lastTickRef.current = Date.now()
    lastAnchorRef.current = null

    const flush = () => {
      const seconds = Math.floor(accumulatedRef.current)
      const targetSlug = slugRef.current
      if (!targetSlug || seconds <= 0) return
      accumulatedRef.current -= seconds
      void postRead(targetSlug, seconds).catch(() => {
        /* network blip — drop the flush silently */
      })
      // Cycle 0016 — also persist the current anchor sample, but only if
      // the anchor changed since the last flush. This keeps the table
      // sparse (no row per 30s for an idle reader) while still giving the
      // heat-map enough signal.
      const anchor = getAnchorBlockId(targetSlug)
      if (anchor && anchor !== lastAnchorRef.current) {
        lastAnchorRef.current = anchor
        void postReadAnchor(targetSlug, { block_id: anchor }).catch(() => {
          /* anchor sample is best-effort */
        })
      }
    }

    const tick = () => {
      if (document.visibilityState !== 'visible') {
        lastTickRef.current = Date.now()
        return
      }
      const now = Date.now()
      const delta = (now - lastTickRef.current) / 1000
      lastTickRef.current = now
      // Cap a single tick — if the laptop slept for hours, don't credit hours.
      accumulatedRef.current += Math.min(delta, FLUSH_INTERVAL_MS / 1000 + 5)
      if (accumulatedRef.current >= FLUSH_INTERVAL_MS / 1000) {
        flush()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        lastTickRef.current = Date.now()
      } else {
        // Tab hidden → flush whatever's banked.
        // First credit the partial second up to now.
        const now = Date.now()
        const delta = (now - lastTickRef.current) / 1000
        accumulatedRef.current += Math.min(delta, FLUSH_INTERVAL_MS / 1000 + 5)
        flush()
      }
    }

    timer = setInterval(tick, 5_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', flush)

    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', flush)
      // Final flush on unmount.
      const now = Date.now()
      const delta = (now - lastTickRef.current) / 1000
      accumulatedRef.current += Math.min(delta, FLUSH_INTERVAL_MS / 1000 + 5)
      flush()
    }
  }, [slug])
}
