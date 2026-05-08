import { useCallback, useState } from 'react'
import {
  uploadFile,
  type FileUploadResult,
  type UploadFileOptions,
} from '../uploadFile'

/**
 * React hook around `uploadFile` so blocks can show progress + error UI
 * without re-implementing the boilerplate.
 *
 *   const { upload, progress, busy, error, reset } = useUploadFile()
 *   const result = await upload(file)
 *
 * `progress` is 0..1 during the PUT; resets to 0 between uploads.
 */
export interface UseUploadFile {
  upload: (file: File, opts?: UploadFileOptions) => Promise<FileUploadResult>
  progress: number
  busy: boolean
  error: string | null
  reset: () => void
}

export function useUploadFile(): UseUploadFile {
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(
    async (file: File, opts: UploadFileOptions = {}): Promise<FileUploadResult> => {
      setBusy(true)
      setError(null)
      setProgress(0)
      try {
        const result = await uploadFile(file, {
          onProgress: (p) => {
            setProgress(p)
            opts.onProgress?.(p)
          },
        })
        return result
      } catch (e) {
        const msg = (e as Error).message ?? '업로드 실패'
        setError(msg)
        throw e
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const reset = useCallback(() => {
    setProgress(0)
    setError(null)
    setBusy(false)
  }, [])

  return { upload, progress, busy, error, reset }
}
