/**
 * usePresence — show "who else is here" on a doc.
 *
 * The hook coordinates three signals:
 *
 *   1. POST /presence/:slug/heartbeat every 10s while the tab is visible.
 *   2. GET /presence/:slug/stream (SSE) — pushes the live registry every 5s.
 *   3. BroadcastChannel('mx-presence:<slug>') — same-browser tabs share state
 *      so only the leader tab fires heartbeats / opens the EventSource.
 *
 * On unmount or visibility=hidden we send an explicit DELETE.
 */
import { useEffect, useRef, useState } from 'react'

import {
  getPresence,
  leavePresence,
  postHeartbeat,
  streamUrl,
  type PresenceList,
  type PresenceUser,
} from './api'

/** Topic prefix for the BroadcastChannel — keep in sync with tests. */
export const PRESENCE_BC_TOPIC = 'mx-presence'
export const HEARTBEAT_INTERVAL_MS = 10_000

interface PresenceHookState {
  others: PresenceUser[]
  /** True once we've sent at least one successful heartbeat. */
  iAmHere: boolean
}

interface BroadcastMessage {
  kind: 'snapshot'
  list: PresenceList
}

/**
 * Get the current user's id by reading the same auth store other features
 * use. We read it lazily so the hook doesn't import the auth module at
 * module-init time (avoids circulars in tests).
 */
function readMyUserId(): string | null {
  // Use a soft global that bootstrap.ts maintains — but fall back gracefully.
  const w = globalThis as unknown as {
    __mxAuth?: { userId?: string | null }
  }
  return w.__mxAuth?.userId ?? null
}

function stripSelf(list: PresenceList, myId: string | null): PresenceUser[] {
  if (!myId) return list.items
  return list.items.filter((u) => u.user_id !== myId)
}

/** True only when this tab thinks it should be the BroadcastChannel leader. */
function isLeader(slug: string, tabId: string): boolean {
  try {
    const key = `mx-presence:leader:${slug}`
    const cur = window.localStorage.getItem(key)
    if (!cur) {
      window.localStorage.setItem(key, tabId)
      return true
    }
    return cur === tabId
  } catch {
    // Storage disabled — every tab will heartbeat. That's a degraded but
    // still-correct fallback (BE dedupes by user_id anyway).
    return true
  }
}

function clearLeader(slug: string, tabId: string) {
  try {
    const key = `mx-presence:leader:${slug}`
    if (window.localStorage.getItem(key) === tabId) {
      window.localStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

function useTabId(): string {
  const ref = useRef<string | null>(null)
  if (ref.current == null) {
    ref.current = `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`
  }
  return ref.current
}

export function usePresence(slug: string | undefined): PresenceHookState {
  const tabId = useTabId()
  const [list, setList] = useState<PresenceList>({
    slug: slug ?? '',
    items: [],
  })
  const [iAmHere, setIAmHere] = useState(false)

  const readAnchor = (): string | null => {
    if (!slug) return null
    const w = globalThis as unknown as {
      __mxPresenceAnchor?: Record<string, string | null>
    }
    return w.__mxPresenceAnchor?.[slug] ?? null
  }

  useEffect(() => {
    if (!slug) return

    let cancelled = false
    let heartbeatTimer: number | null = null
    let evtSource: EventSource | null = null
    let bc: BroadcastChannel | null = null

    const channelName = `${PRESENCE_BC_TOPIC}:${slug}`
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel(channelName)
        bc.onmessage = (ev: MessageEvent<BroadcastMessage>) => {
          const data = ev.data
          if (data && data.kind === 'snapshot' && data.list?.slug === slug) {
            setList(data.list)
          }
        }
      } catch {
        bc = null
      }
    }

    const applySnapshot = (snap: PresenceList) => {
      if (cancelled) return
      setList(snap)
      try {
        bc?.postMessage({ kind: 'snapshot', list: snap } satisfies BroadcastMessage)
      } catch {
        /* ignore */
      }
    }

    const sendHeartbeat = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const snap = await postHeartbeat(slug, readAnchor())
        if (cancelled) return
        setIAmHere(true)
        applySnapshot(snap)
      } catch {
        // Network blip — keep going. The SSE stream will recover.
      }
    }

    const openStream = () => {
      if (typeof EventSource === 'undefined') return
      try {
        evtSource = new EventSource(streamUrl(slug), { withCredentials: true })
        evtSource.addEventListener('presence', (ev: MessageEvent<string>) => {
          try {
            const parsed = JSON.parse(ev.data) as PresenceList
            applySnapshot(parsed)
          } catch {
            /* ignore */
          }
        })
        evtSource.onerror = () => {
          // Browser will auto-reconnect; nothing to do.
        }
      } catch {
        evtSource = null
      }
    }

    const startLeaderWork = () => {
      void sendHeartbeat()
      heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
      openStream()
    }

    const startFollowerWork = () => {
      // Followers just hydrate once so the avatars don't flash empty.
      void getPresence(slug)
        .then((snap) => {
          if (!cancelled) setList(snap)
        })
        .catch(() => {
          /* ignore */
        })
    }

    const leader = isLeader(slug, tabId)
    if (leader) startLeaderWork()
    else startFollowerWork()

    const handleVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.hidden) {
        // Soft leave so we don't sit on the registry while tabbed-away.
        void leavePresence(slug).catch(() => undefined)
        setIAmHere(false)
      } else if (leader) {
        void sendHeartbeat()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
    }

    return () => {
      cancelled = true
      if (heartbeatTimer != null) {
        window.clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      if (evtSource) {
        try {
          evtSource.close()
        } catch {
          /* ignore */
        }
        evtSource = null
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
      // Best-effort leave.
      if (leader) void leavePresence(slug).catch(() => undefined)
      clearLeader(slug, tabId)
      try {
        bc?.close()
      } catch {
        /* ignore */
      }
    }
  }, [slug, tabId])

  const myId = readMyUserId()
  return {
    others: stripSelf(list, myId),
    iAmHere,
  }
}

/**
 * Tiny imperative shim used by the IntersectionObserver hook so it doesn't
 * need to know about React state — it just sets the anchor block id, and
 * `usePresence` reads it on the next heartbeat tick.
 */
export function setAnchorBlockId(slug: string, blockId: string | null): void {
  const w = globalThis as unknown as {
    __mxPresenceAnchor?: Record<string, string | null>
  }
  w.__mxPresenceAnchor = w.__mxPresenceAnchor ?? {}
  w.__mxPresenceAnchor[slug] = blockId
}
