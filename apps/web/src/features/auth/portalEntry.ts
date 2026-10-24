// 포털 진입 다녀오기 — 돌아올 자리를 sessionStorage 에 두고 진입 링크로 보낸다 · 착지 뒤 꺼낸다 · 1분 안 되풀이 막기
/**
 * SSO 전용(`GET /auth/mode` 의 sso_only)이면 세션이 끝나거나 포털 사진이 낡을 때(refresh 401 PORTAL_REENTRY) 화면이 포털의 MX 백서
 * 진입 링크로 저절로 다녀온다. 진입 링크는 돌아올 자리(next)를 넘기지 않으니 여기서 sessionStorage 에 두고, 포털이 착지시킨
 * `/mx-white-paper/` 에서 사용자가 생기면 꺼내 되돌린다(`ReturnAfterPortalEntry`).
 *
 * 다녀왔는데도 세션이 이어지지 않으면(쿠키 경로 · 포털 설정 고장) 1분 안에는 다시 보내지 않는다 — 로그인 화면의 단추만 남긴다.
 */
import { useAuthStore } from './store'

const RETURN_KEY = 'mxwp.return_to'
const TRIED_KEY = 'mxwp.portal_entry_at'
export const RETRY_GUARD_MS = 60_000

let leaving = false // 이 페이지가 이미 진입 링크로 떠나는 중 — StrictMode 의 두 번 부르기 등에서 되보내지 않는다

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** 브라우저 주소 → 라우터 경로(포털 접두 `/mx-white-paper` 를 뗀다). */
export function appPath(pathname: string, search: string, base: string = import.meta.env.BASE_URL): string {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  const path = prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || '/' : pathname
  return path + search
}

/** 같은 앱 안 경로만(열린 되돌리기 막기). */
function internal(path: string | null): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null
  return path
}

export function recentlyTried(now: number = Date.now()): boolean {
  const at = Number(store()?.getItem(TRIED_KEY) ?? 0)
  return at > 0 && now - at < RETRY_GUARD_MS
}

/** 진입 링크로 보낸다 — `force`(사람이 단추를 누름)가 아니면 1분 안에 다시 보내지 않는다. 보냈으면 true. */
export function goToPortalEntry(returnTo: string, { force = false }: { force?: boolean } = {}): boolean {
  if (leaving) return true
  const url = useAuthStore.getState().launchUrl
  if (!url || (!force && recentlyTried())) return false
  const s = store()
  s?.setItem(RETURN_KEY, internal(returnTo) ?? '/')
  s?.setItem(TRIED_KEY, String(Date.now()))
  leaving = true
  window.location.assign(url)
  return true
}

/** 착지 뒤 한 번 — 남긴 자리를 꺼내고 되풀이 표시도 지운다. */
export function takeReturnPath(): string | null {
  const s = store()
  const path = internal(s?.getItem(RETURN_KEY) ?? null)
  s?.removeItem(RETURN_KEY)
  s?.removeItem(TRIED_KEY)
  return path
}
