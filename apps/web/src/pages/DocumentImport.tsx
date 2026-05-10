import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Button, Card, Field, Input } from '@/components/ui'
import {
  importDocx,
  importPptx,
  type ImportSummary,
  type ImportPptxSummary,
} from '@/features/import/api'
import { postDocument } from '@/features/editor/api'
import { useAuthStore } from '@/features/auth/store'
import type { DocumentJSONV10 } from '@/types/document'
import type { AppOutletContext } from '@/App'

/**
 * Word(.docx) 가져오기 페이지 — `/docs/import`.
 *
 * 흐름:
 *   1) 사용자가 .docx 를 드롭하거나 선택
 *   2) slug/title 자동 채움 (override 가능)
 *   3) "가져오기" → POST /imports/docx → 변환 결과 + 통계
 *   4) 사용자 확인 → POST /documents 로 영구화 → /docs/:slug?fullEdit=1 이동
 */
export function DocumentImportPage() {
  const navigate = useNavigate()
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()
  useEffect(() => {
    setLeftRail(null)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  const user = useAuthStore((s) => s.user)
  const canWrite = !!user && ['editor', 'owner', 'admin'].includes(user.role ?? '')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    document: DocumentJSONV10
    summary: ImportSummary | ImportPptxSummary
    /** Format detected from the uploaded file. Drives the summary card layout. */
    format: 'docx' | 'pptx'
  } | null>(null)
  const [persisting, setPersisting] = useState(false)

  // Auto-detect Word vs PowerPoint from filename so we route to the right
  // import endpoint without forcing the user to pick a tab. Both file
  // formats land in the same DocumentJSON envelope, but the BE handlers
  // (and per-format size caps) differ.
  const fmt: 'docx' | 'pptx' | null = useMemo(() => {
    if (!file) return null
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.docx')) return 'docx'
    if (lower.endsWith('.pptx')) return 'pptx'
    return null
  }, [file])

  // slug 자동 도출 (파일명 기반, override 안 됐을 때만)
  const derivedSlug = useMemo(() => {
    if (!file) return ''
    const base = file.name.replace(/\.(docx|pptx)$/i, '').toLowerCase()
    const cleaned = base.replace(/[^a-z0-9가-힣-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    return cleaned.slice(0, 100)
  }, [file])

  useEffect(() => {
    if (file && !slug) setSlug(derivedSlug)
    if (file && !title) setTitle(file.name.replace(/\.(docx|pptx)$/i, ''))
  }, [file, derivedSlug, slug, title])

  const onPickFile = useCallback((picked: File) => {
    const lower = picked.name.toLowerCase()
    const isDocx = lower.endsWith('.docx')
    const isPptx = lower.endsWith('.pptx')
    if (!isDocx && !isPptx) {
      setError('.docx 또는 .pptx 파일만 가져올 수 있습니다.')
      return
    }
    const cap = isPptx ? 50 * 1024 * 1024 : 30 * 1024 * 1024
    if (picked.size > cap) {
      setError(`파일이 너무 큽니다 (최대 ${Math.round(cap / 1024 / 1024)} MB).`)
      return
    }
    setError(null)
    setFile(picked)
    setPreview(null)
  }, [])

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) onPickFile(f)
  }
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault()

  const slugIsValid = /^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/.test(slug)

  const runImport = async () => {
    if (!file || !fmt) return
    if (!slugIsValid) {
      setError('slug 형식이 올바르지 않습니다.')
      return
    }
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      const opts = {
        slug: slug.trim() || undefined,
        title: title.trim() || undefined,
        onProgress: (p: number) => setProgress(p),
      }
      const r =
        fmt === 'pptx'
          ? await importPptx(file, opts)
          : await importDocx(file, opts)
      setPreview({ ...r, format: fmt })
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      if (status === 429) {
        setError('가져오기 호출이 너무 잦습니다. 잠시 후 다시 시도하세요.')
      } else if (status === 422) {
        setError(msg ?? '파일 형식이 올바르지 않습니다.')
      } else {
        setError(msg ?? (err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  const persistAndNavigate = async () => {
    if (!preview) return
    setPersisting(true)
    setError(null)
    try {
      const finalDoc: DocumentJSONV10 = {
        ...preview.document,
        slug: slug.trim() || preview.document.slug,
        title: title.trim() || preview.document.title,
      }
      await postDocument(finalDoc)
      navigate(`/docs/${encodeURIComponent(finalDoc.slug)}?fullEdit=1`)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      if (status === 409) {
        setError(`이미 사용 중인 슬러그입니다: '${slug}'.`)
      } else {
        setError(msg ?? (err as Error).message)
      }
    } finally {
      setPersisting(false)
    }
  }

  if (!canWrite) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <Card padded="lg">
          <p className="text-sm text-gray-700">
            문서 가져오기는 editor 이상 권한이 필요합니다.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
          📄 Word / 📊 PowerPoint 가져오기
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          .docx 또는 .pptx 파일을 업로드하면 자동으로 본문/표/이미지/슬라이드가 변환됩니다.
          PowerPoint는 슬라이드 한 장이 섹션 한 개로, 슬라이드 마스터에 따라 자동으로 섹션 레이아웃이 적용됩니다.
        </p>
      </header>

      <Card padded="lg" className="space-y-5">
        <div
          data-testid="docx-dropzone"
          onDrop={onDrop}
          onDragOver={onDragOver}
          className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-smsg-400"
        >
          {file ? (
            <div>
              <p className="text-sm font-semibold text-smsg-900">{file.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                {(file.size / 1024).toFixed(1)} KB
              </p>
              <button
                type="button"
                className="mt-3 text-xs text-smsg-700 underline"
                onClick={() => {
                  setFile(null)
                  setPreview(null)
                  setSlug('')
                  setTitle('')
                }}
              >
                다른 파일 선택
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600">
                .docx 파일을 여기로 드래그하거나
              </p>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3"
              >
                파일 선택
              </Button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            data-testid="docx-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onPickFile(f)
            }}
          />
        </div>

        {file && (
          <>
            <Field
              label="슬러그 (URL)"
              htmlFor="import-slug"
              required
              error={!slugIsValid && slug ? '소문자/숫자/하이픈/한글만 가능합니다' : undefined}
            >
              <Input
                id="import-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="imported-doc"
                prefix={<span className="text-gray-400">/docs/</span>}
                invalid={!!slug && !slugIsValid}
              />
            </Field>

            <Field label="제목" htmlFor="import-title" required>
              <Input
                id="import-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="문서 제목"
              />
            </Field>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {busy && (
          <div className="space-y-1">
            <p className="text-xs text-gray-500">변환 중… {Math.round(progress * 100)}%</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full bg-smsg-600 transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {preview && !busy && (
          <ImportSummaryCard
            summary={preview.summary}
            format={preview.format}
          />
        )}

        <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={() => navigate(-1)} className="sm:w-auto">
            취소
          </Button>
          {!preview ? (
            <Button
              data-testid="docx-import-btn"
              onClick={() => void runImport()}
              disabled={!file || !slugIsValid || busy}
              loading={busy}
              className="sm:w-auto"
            >
              가져오기
            </Button>
          ) : (
            <Button
              data-testid="docx-confirm-btn"
              onClick={() => void persistAndNavigate()}
              disabled={persisting}
              loading={persisting}
              className="sm:w-auto"
            >
              저장하고 편집 시작
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

function ImportSummaryCard({
  summary,
  format,
}: {
  summary: ImportSummary | ImportPptxSummary
  format: 'docx' | 'pptx'
}) {
  // Two summary shapes share most fields but differ at the edges
  // (docx has equations/headings/lists/code_blocks/footnotes; pptx has
  // slides/sections/speaker_notes). Render whichever applies so the
  // card stays useful for both formats without duplicating UI code.
  const items: Array<[string, number]> =
    format === 'pptx'
      ? [
          ['슬라이드', (summary as ImportPptxSummary).slides],
          ['섹션', (summary as ImportPptxSummary).sections],
          ['단락', summary.paragraphs],
          ['표', summary.tables],
          ['이미지', summary.images],
          ['발표자 노트', (summary as ImportPptxSummary).speaker_notes],
        ]
      : [
          ['단락', summary.paragraphs],
          ['제목', (summary as ImportSummary).headings],
          ['표', summary.tables],
          ['이미지', summary.images],
          ['수식', (summary as ImportSummary).equations],
          ['리스트', (summary as ImportSummary).lists],
          ['각주', (summary as ImportSummary).footnotes],
        ]
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-semibold text-emerald-900">
        변환 결과 미리보기 ({format === 'pptx' ? 'PowerPoint' : 'Word'})
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-emerald-800 sm:grid-cols-3">
        {items.map(([label, count]) => (
          <li key={label}>
            {label}: <span className="font-semibold">{count}개</span>
          </li>
        ))}
      </ul>
      {summary.warnings.length > 0 && (
        <details className="mt-3 text-xs text-amber-800">
          <summary className="cursor-pointer">경고 {summary.warnings.length}건</summary>
          <ul className="ml-4 mt-1 list-disc">
            {summary.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
