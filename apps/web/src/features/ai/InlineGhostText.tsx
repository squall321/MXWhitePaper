/**
 * 인라인 자동완성 ghost-text 오버레이.
 *
 * 사용자 typing 이 1500ms 멎으면 현재 선택된 contentEditable 의 텍스트를
 * `aiContinue` 로 보내고, 응답을 caret 직후에 회색으로 미리 보여준다.
 *   - Tab : 수락 → caret 위치에 실제로 삽입.
 *   - 그 외 키 / blur / 클릭 : 무시.
 *
 * 본 컴포넌트는 standalone 이다 — InlineTextBlockEditor 에 직접 넣지 않고도
 * Editor route 의 어디든 마운트하면 동작한다. 마운트 후 idle-typing 검출은
 * `document.addEventListener('input', ...)` 로 글로벌 캡처한다.
 *
 * TODO: InlineTextBlockEditor 의 render 안으로 옮겨 caret coordinate 를
 * 더 정확히 잡고, 에디터 단위로 lifecycle 을 묶는 것이 이상적. 현재 구현은
 * "선택 영역의 client rect" 를 사용해 floating div 를 절대 위치로 띄운다.
 */
import { useEffect, useRef, useState } from 'react'
import { aiContinue } from './api'

const IDLE_MS = 1500
const MIN_TEXT_LENGTH = 8

interface GhostState {
  text: string
  /** caret 위치 client coords. */
  x: number
  y: number
}

function findActiveEditable(): HTMLElement | null {
  const a = document.activeElement
  if (a instanceof HTMLElement && a.isContentEditable) return a
  return null
}

function caretRect(): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const rects = range.getClientRects()
  if (rects.length > 0) return rects[0]!
  // Empty line — fall back to the parent element rect.
  const node = range.startContainer
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement
  return el?.getBoundingClientRect() ?? null
}

export function InlineGhostText() {
  const [ghost, setGhost] = useState<GhostState | null>(null)
  const idleTimerRef = useRef<number | null>(null)
  const inFlightRef = useRef<boolean>(false)
  // ghost 상태와 별개로, "현재 보여주는 ghost 가 어떤 editable 에 속하는지" 를
  // 추적해 Tab 으로 수락할 때 같은 element 인지 검증한다.
  const ghostHostRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    function clearIdleTimer() {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }

    function dismissGhost() {
      setGhost(null)
      ghostHostRef.current = null
    }

    async function fireContinue() {
      if (inFlightRef.current) return
      const host = findActiveEditable()
      if (!host) return
      const text = (host.textContent ?? '').trim()
      if (text.length < MIN_TEXT_LENGTH) return
      const rect = caretRect()
      if (!rect) return
      inFlightRef.current = true
      try {
        const result = await aiContinue(text, { maxTokens: 64 })
        if (result && result.trim()) {
          ghostHostRef.current = host
          setGhost({
            text: result,
            // caret 끝 → 약간 우측에 배치
            x: rect.right + window.scrollX,
            y: rect.top + window.scrollY,
          })
        }
      } catch {
        // 503 / network 에러 모두 조용히 skip — UX 방해 금지
      } finally {
        inFlightRef.current = false
      }
    }

    function onInput(ev: Event) {
      const target = ev.target
      if (!(target instanceof HTMLElement)) return
      if (!target.isContentEditable) return
      // 새 입력 → 이전 ghost 제거 + 타이머 재시작
      dismissGhost()
      clearIdleTimer()
      idleTimerRef.current = window.setTimeout(() => {
        void fireContinue()
      }, IDLE_MS)
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (!ghost) return
      if (ev.key === 'Tab') {
        const host = findActiveEditable()
        if (host && host === ghostHostRef.current) {
          ev.preventDefault()
          try {
            document.execCommand('insertText', false, ghost.text)
          } catch {
            /* noop */
          }
          dismissGhost()
        }
        return
      }
      // Escape / Enter / 그 외 → 무시 (그냥 ghost 만 제거)
      dismissGhost()
    }

    function onBlur() {
      dismissGhost()
      clearIdleTimer()
    }

    document.addEventListener('input', onInput, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('mousedown', onBlur)

    return () => {
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('mousedown', onBlur)
      clearIdleTimer()
    }
  }, [ghost])

  if (!ghost) return null
  return (
    <span
      data-testid="inline-ghost-text"
      aria-hidden
      style={{
        position: 'absolute',
        top: ghost.y,
        left: ghost.x,
        pointerEvents: 'none',
        color: 'rgba(107, 114, 128, 0.7)',
        fontStyle: 'italic',
        whiteSpace: 'pre',
        zIndex: 50,
      }}
    >
      {ghost.text}
    </span>
  )
}
