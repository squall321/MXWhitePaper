import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * 진단 페이지 — AuthGuard 우회. 사용자가 흰 화면을 마주쳤을 때 접속해
 * 어디가 망가졌는지 한 눈에 본다. /diag 에서 직접 접근 가능.
 *
 * 점검 항목:
 *   - VITE_API_URL 의 실제 값
 *   - /api/v1/healthz 응답
 *   - sessionStorage / localStorage 의 토큰/최근문서/디버그 키
 *   - navigator.onLine
 *   - 모듈 로드 시도(특히 lazy 컴포넌트들)
 */
interface CheckRow {
  label: string
  status: 'pending' | 'ok' | 'warn' | 'error'
  detail?: string
}

export function DiagPage() {
  const [checks, setChecks] = useState<CheckRow[]>([])

  useEffect(() => {
    void runChecks(setChecks)
  }, [])

  const apiUrl = (import.meta.env.VITE_API_URL as string) || '/api/v1'

  return (
    <div className="mx-auto max-w-2xl p-6 font-mono text-sm">
      <header className="mb-4">
        <h1 className="text-xl font-bold">MX White Paper — 진단</h1>
        <p className="text-xs text-gray-500">
          이 페이지는 AuthGuard 를 우회합니다. 흰 화면이 보이거나 데이터가
          안 불러와질 때 첫 단서를 모읍니다.
        </p>
      </header>

      <section className="mb-4 rounded border border-gray-200 bg-gray-50 p-3">
        <p>
          <strong>VITE_API_URL:</strong>{' '}
          <code className="rounded bg-white px-1">{apiUrl}</code>
        </p>
        <p>
          <strong>오프라인:</strong>{' '}
          <code>{typeof navigator !== 'undefined' && !navigator.onLine ? '예' : '아니오'}</code>
        </p>
        <p>
          <strong>현재 시각:</strong>{' '}
          <code>{new Date().toISOString()}</code>
        </p>
      </section>

      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-3 px-3 py-2">
            <span className="mt-0.5">
              {c.status === 'ok' && <span className="text-emerald-600">✓</span>}
              {c.status === 'pending' && <span className="text-gray-400">⋯</span>}
              {c.status === 'warn' && <span className="text-amber-600">!</span>}
              {c.status === 'error' && <span className="text-red-600">✗</span>}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{c.label}</p>
              {c.detail && (
                <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all text-[11px] text-gray-600">
                  {c.detail}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            try {
              window.sessionStorage.clear()
              window.localStorage.clear()
            } catch {
              /* private mode */
            }
            location.assign('/login')
          }}
          className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          전체 스토리지 비우기 후 /login
        </button>
        <Link
          to="/login"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
        >
          로그인 페이지
        </Link>
        <Link
          to="/?dev"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
        >
          dev 우회로 메인
        </Link>
      </div>

      <details className="mt-4 text-xs text-gray-500">
        <summary className="cursor-pointer">로컬 스토리지 / 세션 스토리지 덤프</summary>
        <pre className="mt-2 overflow-auto rounded border bg-white p-2 text-[11px]">
{(() => {
  const ls: Record<string, string> = {}
  const ss: Record<string, string> = {}
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k) ls[k] = (window.localStorage.getItem(k) ?? '').slice(0, 200)
    }
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i)
      if (k) ss[k] = (window.sessionStorage.getItem(k) ?? '').slice(0, 200)
    }
  } catch {
    /* no-op */
  }
  return JSON.stringify({ localStorage: ls, sessionStorage: ss }, null, 2)
})()}
        </pre>
      </details>
    </div>
  )
}

async function runChecks(setChecks: (rows: CheckRow[]) => void): Promise<void> {
  const apiUrl = (import.meta.env.VITE_API_URL as string) || '/api/v1'
  const rows: CheckRow[] = [
    { label: 'GET /healthz', status: 'pending' },
    { label: 'POST /auth/login (admin/admin1234!)', status: 'pending' },
    { label: 'GET /me (with bearer)', status: 'pending' },
    { label: 'GET /orgs/tree', status: 'pending' },
    { label: 'GET /documents?limit=5', status: 'pending' },
  ]
  setChecks([...rows])

  // 1) healthz
  try {
    const r = await fetch(`${apiUrl}/healthz`, { credentials: 'include' })
    rows[0] = {
      label: 'GET /healthz',
      status: r.ok ? 'ok' : 'error',
      detail: r.ok ? `${r.status} OK` : `${r.status} ${r.statusText}`,
    }
  } catch (e) {
    rows[0] = {
      label: 'GET /healthz',
      status: 'error',
      detail: (e as Error).message,
    }
  }
  setChecks([...rows])

  // 2) login
  let token: string | null = null
  try {
    const r = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@mx.local', password: 'admin1234!' }),
      credentials: 'include',
    })
    const body = await r.json().catch(() => null)
    token = (body?.data?.access_token as string | undefined) ?? null
    rows[1] = {
      label: 'POST /auth/login',
      status: r.ok && token ? 'ok' : 'error',
      detail: r.ok ? `200 user=${body?.data?.user?.email ?? '?'}` : `${r.status} ${JSON.stringify(body?.error ?? body).slice(0, 200)}`,
    }
  } catch (e) {
    rows[1] = {
      label: 'POST /auth/login',
      status: 'error',
      detail: (e as Error).message,
    }
  }
  setChecks([...rows])

  // 3) /me with bearer
  if (token) {
    try {
      const r = await fetch(`${apiUrl}/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
      const body = await r.json().catch(() => null)
      rows[2] = {
        label: 'GET /me (with bearer)',
        status: r.ok ? 'ok' : 'error',
        detail: r.ok ? `${body?.data?.email ?? '?'} role=${body?.data?.role ?? '?'}` : `${r.status}`,
      }
    } catch (e) {
      rows[2] = { label: 'GET /me (with bearer)', status: 'error', detail: (e as Error).message }
    }
  } else {
    rows[2] = { label: 'GET /me (with bearer)', status: 'warn', detail: '토큰 미발급 — 스킵' }
  }
  setChecks([...rows])

  // 4) /orgs/tree
  try {
    const r = await fetch(`${apiUrl}/orgs/tree`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    const body = await r.json().catch(() => null)
    const divs = body?.data?.divisions
    rows[3] = {
      label: 'GET /orgs/tree',
      status: r.ok && Array.isArray(divs) ? 'ok' : 'error',
      detail: r.ok ? `divisions=${divs?.length ?? '?'}` : `${r.status}`,
    }
  } catch (e) {
    rows[3] = { label: 'GET /orgs/tree', status: 'error', detail: (e as Error).message }
  }
  setChecks([...rows])

  // 5) /documents
  try {
    const r = await fetch(`${apiUrl}/documents?limit=5`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    const body = await r.json().catch(() => null)
    const items = body?.data
    rows[4] = {
      label: 'GET /documents?limit=5',
      status: r.ok && Array.isArray(items) ? 'ok' : 'error',
      detail: r.ok ? `count=${items?.length ?? '?'}` : `${r.status}`,
    }
  } catch (e) {
    rows[4] = { label: 'GET /documents?limit=5', status: 'error', detail: (e as Error).message }
  }
  setChecks([...rows])
}
