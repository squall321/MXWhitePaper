import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Vim-style "G then key" chord listener for global navigation.
 *
 *   - `G H` → /
 *   - `G O` → /orgs
 *   - `G R` → /recent
 *   - `G N` → /docs/new
 *   - `G S` → /settings
 *   - `G A` → /analytics
 *
 * The chord arms when the user presses `G` outside an editable element and
 * disarms after 1.5s if no second key follows. Pressing `Esc` cancels.
 */
export function useGChord() {
  const navigate = useNavigate()

  useEffect(() => {
    let armed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function disarm() {
      armed = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    function isTextInput(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (target.isContentEditable) return true
      return false
    }

    function onKey(e: KeyboardEvent) {
      // Skip when typing in form fields.
      if (isTextInput(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (!armed) {
        if (e.key === 'g' || e.key === 'G') {
          armed = true
          if (timer) clearTimeout(timer)
          timer = setTimeout(disarm, 1500)
        }
        return
      }

      // Armed — second key
      const k = e.key.toLowerCase()
      let dest: string | null = null
      switch (k) {
        case 'h':
          dest = '/'
          break
        case 'o':
          dest = '/orgs'
          break
        case 'r':
          dest = '/recent'
          break
        case 'n':
          dest = '/docs/new'
          break
        case 's':
          dest = '/settings'
          break
        case 'a':
          dest = '/analytics'
          break
        case 'escape':
          break
        default:
          break
      }
      disarm()
      if (dest) {
        e.preventDefault()
        navigate(dest)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      disarm()
    }
  }, [navigate])
}
