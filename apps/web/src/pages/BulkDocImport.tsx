import { useCallback, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Card } from '@/components/ui'
import { Modal } from '@/components/ui/Modal'
import { useAuthStore } from '@/features/auth/store'
import { importBulkCsv, type BulkImportResult } from '@/features/import/api'

/**
 * `/admin/import-csv` — CSV 일괄 가져오기 (admin 전용).
 *
 * 흐름:
 *   1) CSV 드롭/선택 → 헤더 + 첫 20 행 미리보기
 *   2) "가져오기" 버튼 → POST /imports/csv
 *   3) 결과 모달: created / skipped / errors[]
 */
export function BulkDocImportPage() {
  const user = useAuthStore((s) => s.user)
  if (!user) return null
  if (user.role !== 'admin') return <Navigate to="/" replace />

  return <BulkDocImportContent />
}

function BulkDocImportContent() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkImportResult | null>(null)

  const onPickFile = useCallback(async (picked: File) => {
    if (!picked.name.toLowerCase().endsWith('.csv')) {
      setError('.csv 파일만 가져올 수 있습니다.')
      return
    }
    if (picked.size > 5 * 1024 * 1024) {
      setError('파일이 너무 큽니다 (최대 5 MB).')
      return
    }
    setError(null)
    setFile(picked)
    setResult(null)
    try {
      const txt = await picked.text()
      setText(txt)
    } catch {
      setText('')
    }
  }, [])

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) void onPickFile(f)
  }
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault()

  const preview = useMemo(() => parseCsvPreview(text), [text])

  const runImport = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const r = await importBulkCsv(file)
      setResult(r)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      if (status === 403) {
        setError('admin 권한이 필요합니다.')
      } else if (status === 422) {
        setError(msg ?? 'CSV 형식이 올바르지 않습니다.')
      } else {
        setError(msg ?? (err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setFile(null)
    setText('')
    setResult(null)
    setError(null)
  }

  return (
    <div
      className="mx-auto max-w-4xl space-y-6 py-6 sm:py-10"
      data-testid="bulk-doc-import-page"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
          CSV 일괄 가져오기
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          CSV 한 행이 한 문서가 됩니다. 컬럼: slug, title, summary, division,
          team, group, part, tags, owners, confidentiality, body. 최대 5 MB / 500 행.
        </p>
      </header>

      <Card padded="lg" className="space-y-5">
        <div
          data-testid="csv-dropzone"
          onDrop={onDrop}
          onDragOver={onDragOver}
          className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-smsg-400"
        >
          {file ? (
            <div>
              <p className="text-sm font-semibold text-smsg-900">{file.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                {(file.size / 1024).toFixed(1)} KB · {preview.rowCount} 행
              </p>
              <button
                type="button"
                className="mt-3 text-xs text-smsg-700 underline"
                onClick={reset}
              >
                다른 파일 선택
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600">
                .csv 파일을 여기로 드래그하거나
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
            accept=".csv,text/csv"
            className="hidden"
            data-testid="csv-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onPickFile(f)
            }}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {file && preview.headers.length > 0 && (
          <PreviewTable preview={preview} />
        )}

        <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={reset} className="sm:w-auto">
            초기화
          </Button>
          <Button
            data-testid="csv-import-btn"
            onClick={() => void runImport()}
            disabled={!file || busy}
            loading={busy}
            className="sm:w-auto"
          >
            가져오기
          </Button>
        </div>
      </Card>

      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title="가져오기 결과"
      >
        {result && (
          <div data-testid="csv-result-modal" className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs text-emerald-700">생성됨</div>
                <div className="mt-1 text-2xl font-bold text-emerald-900">
                  {result.created}
                </div>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs text-amber-700">건너뜀 (slug 중복)</div>
                <div className="mt-1 text-2xl font-bold text-amber-900">
                  {result.skipped}
                </div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <details className="rounded-md border border-red-200 bg-red-50 p-3">
                <summary className="cursor-pointer text-xs text-red-700">
                  오류 {result.errors.length}건
                </summary>
                <ul className="ml-4 mt-2 list-disc text-xs text-red-800">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      행 {e.row}
                      {e.slug ? ` (${e.slug})` : ''}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

interface CsvPreview {
  headers: string[]
  rows: string[][]
  rowCount: number
}

/**
 * Naive CSV parser — only used for the preview table. The server uses Python
 * stdlib `csv` for the real import. Quoted fields with commas/newlines are
 * supported well enough for the common case; gnarly edge cases will still
 * round-trip correctly server-side.
 */
function parseCsvPreview(text: string): CsvPreview {
  if (!text) return { headers: [], rows: [], rowCount: 0 }
  const records: string[][] = []
  let cur: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        cur.push(cell)
        cell = ''
      } else if (ch === '\n') {
        cur.push(cell)
        records.push(cur)
        cur = []
        cell = ''
      } else if (ch === '\r') {
        // skip
      } else {
        cell += ch
      }
    }
  }
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell)
    records.push(cur)
  }
  if (records.length === 0) return { headers: [], rows: [], rowCount: 0 }
  const [header, ...rest] = records
  const dataRows = rest.filter((r) => r.some((c) => c.trim() !== ''))
  return {
    headers: header!.map((h) => h.trim().toLowerCase()),
    rows: dataRows.slice(0, 20),
    rowCount: dataRows.length,
  }
}

function PreviewTable({ preview }: { preview: CsvPreview }) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table
        className="min-w-full text-xs"
        data-testid="csv-preview-table"
      >
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            {preview.headers.map((h) => (
              <th key={h} className="px-2 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {preview.rows.map((row, i) => (
            <tr key={i}>
              {preview.headers.map((_h, j) => (
                <td key={j} className="px-2 py-1 text-gray-700">
                  {(row[j] ?? '').slice(0, 80)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.rowCount > 20 && (
        <p className="border-t border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500">
          전체 {preview.rowCount} 행 중 처음 20 행만 미리보기.
        </p>
      )}
    </div>
  )
}
