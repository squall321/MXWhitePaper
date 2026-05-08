import { useEffect } from 'react'

interface LightboxProps {
  open: boolean
  /** Original-size URL (no thumb). */
  src: string
  alt?: string
  caption?: string
  onClose: () => void
}

/**
 * Fullscreen image overlay. Esc / click-on-backdrop closes. Used by
 * `<ImageBlockView>` when the user clicks a rendered image.
 */
export function Lightbox({ open, src, alt, caption, onClose }: LightboxProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 확대"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt ?? caption ?? ''}
        className="max-h-[90vh] max-w-[95vw] rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {caption && (
        <p className="mt-3 max-w-[80vw] text-center text-sm text-white/90">
          {caption}
        </p>
      )}
    </div>
  )
}
