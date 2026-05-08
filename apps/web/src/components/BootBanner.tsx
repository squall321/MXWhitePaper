import { useEffect, useState } from 'react'

/**
 * Boot 직후 1.5 초 동안 화면 상단에 떠 있는 진단 배너.
 * 사용자가 "흰 화면이다" 라고 신고했을 때, 이 배너만 보여도
 * (a) JS 가 실행되었고
 * (b) React 가 마운트에 성공했고
 * (c) 어떤 API URL 로 붙어 있는지
 * 한 줄로 확인할 수 있다.
 *
 * 일정 시간 후 자동으로 사라지므로 정상 화면을 가리지 않는다.
 */
export function BootBanner() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(false), 1500)
    return () => window.clearTimeout(t)
  }, [])

  if (!visible) return null

  const apiUrl = (import.meta.env.VITE_API_URL as string) || '/api/v1'
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        zIndex: 99999,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'rgba(20, 40, 160, 0.85)',
        color: '#fff',
        font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
        boxShadow: '0 2px 8px rgba(0,0,0,.25)',
        maxWidth: 'min(90vw, 560px)',
      }}
    >
      <strong>MXWP boot</strong> · API <code>{apiUrl}</code> ·{' '}
      {online ? 'online' : 'offline'} · {new Date().toLocaleTimeString('ko-KR')}
    </div>
  )
}
