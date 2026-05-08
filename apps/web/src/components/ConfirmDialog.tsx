import { useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Minimal modal confirmation. Used by the dropzone for the multi-image
 * "make a gallery?" prompt. Esc cancels, Enter confirms — matches the
 * "drop and keep your hands on the keyboard" flow we lean on for the
 * caption-input UX.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '예',
  cancelLabel = '아니오',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel, onConfirm])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-80 rounded bg-white p-4 shadow-lg">
        <h3 className="mb-2 text-base font-semibold text-smsg-900">{title}</h3>
        {message && <p className="mb-3 text-sm text-gray-600">{message}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="rounded bg-smsg-700 px-3 py-1 text-sm font-medium text-white hover:bg-smsg-900"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
