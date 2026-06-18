import { useEffect, useRef, useState } from 'react'
import {
  downloadDocx,
  downloadMarkdown,
  downloadPdf,
  downloadPptx,
  htmlExportUrl,
} from './api'
import { withBase } from '@/lib/basePath'

interface ExportMenuProps {
  slug: string
}

/**
 * 내보내기 드롭다운. EditorToolbar 의 "HTML 내보내기" anchor 자리에 들어간다.
 * 항목:
 *  - HTML : 기존 export.html 엔드포인트 (새 창)
 *  - Markdown : POST /exports/markdown → 다운로드
 *  - PowerPoint : POST /exports/pptx → 다운로드
 *  - PDF : POST /exports/pdf, 501 이면 print 페이지로 fallback
 *
 * 외부 라이브러리 없이 click-outside + Escape 닫기를 구현한다.
 */
export function ExportMenu({ slug }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<null | 'md' | 'pdf' | 'pptx' | 'docx'>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(ev: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(ev.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Auto-clear the transient status message.
  useEffect(() => {
    if (!statusMsg) return
    const t = setTimeout(() => setStatusMsg(null), 3000)
    return () => clearTimeout(t)
  }, [statusMsg])

  const handleMarkdown = async () => {
    setBusy('md')
    try {
      await downloadMarkdown(slug)
      setStatusMsg('Markdown 다운로드 시작')
    } catch (err) {
       
      console.error('[export] markdown failed', err)
      setStatusMsg('Markdown 내보내기 실패')
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }

  const handlePptx = async () => {
    setBusy('pptx')
    try {
      await downloadPptx(slug)
      setStatusMsg('PowerPoint 다운로드 시작')
    } catch (err) {
       
      console.error('[export] pptx failed', err)
      setStatusMsg('PowerPoint 내보내기 실패')
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }

  const handleDocx = async () => {
    setBusy('docx')
    try {
      await downloadDocx(slug)
      setStatusMsg('Word 다운로드 시작')
    } catch (err) {
       
      console.error('[export] docx failed', err)
      setStatusMsg('Word 내보내기 실패')
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }

  const handlePdf = async () => {
    setBusy('pdf')
    try {
      const r = await downloadPdf(slug)
      if (r.kind === 'fallback') {
        // BE 가 PDF 변환 미지원 — 인쇄 페이지로 폴백.
        window.open(withBase(r.hint.url), '_blank', 'noopener')
        setStatusMsg('PDF 미지원 — 인쇄 미리보기를 새 창으로 띄웠습니다')
      } else {
        setStatusMsg('PDF 다운로드 시작')
      }
    } catch (err) {
       
      console.error('[export] pdf failed', err)
      setStatusMsg('PDF 내보내기 실패')
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }

  const itemClass =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-smsg-50 hover:text-smsg-900 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:text-smsg-900 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-focus"
        aria-haspopup="menu"
        aria-expanded={open}
        title="내보내기 (HTML / Markdown / PDF)"
        data-testid="export-menu-trigger"
      >
        <span aria-hidden>⤓</span> 내보내기
        <span aria-hidden className="ml-0.5 text-[10px]">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-popover mt-1 w-52 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
          data-testid="export-menu"
        >
          <a
            href={htmlExportUrl(slug)}
            target="_blank"
            rel="noopener noreferrer"
            className={itemClass}
            onClick={() => setOpen(false)}
            data-testid="export-html-item"
          >
            <span aria-hidden>📄</span>
            <span>HTML</span>
            <span className="ml-auto text-[10px] text-gray-400">.html</span>
          </a>
          <button
            type="button"
            onClick={handleMarkdown}
            disabled={busy !== null}
            className={itemClass}
            data-testid="export-markdown-item"
          >
            <span aria-hidden>📝</span>
            <span>Markdown</span>
            <span className="ml-auto text-[10px] text-gray-400">
              {busy === 'md' ? '…' : '.md'}
            </span>
          </button>
          <button
            type="button"
            onClick={handleDocx}
            disabled={busy !== null}
            className={itemClass}
            data-testid="export-docx-item"
          >
            <span aria-hidden>📃</span>
            <span>Word (.docx)</span>
            <span className="ml-auto text-[10px] text-gray-400">
              {busy === 'docx' ? '…' : '.docx'}
            </span>
          </button>
          <button
            type="button"
            onClick={handlePptx}
            disabled={busy !== null}
            className={itemClass}
            data-testid="export-pptx-item"
          >
            <span aria-hidden>📊</span>
            <span>PowerPoint</span>
            <span className="ml-auto text-[10px] text-gray-400">
              {busy === 'pptx' ? '…' : '.pptx'}
            </span>
          </button>
          <button
            type="button"
            onClick={handlePdf}
            disabled={busy !== null}
            className={itemClass}
            data-testid="export-pdf-item"
          >
            <span aria-hidden>🖨</span>
            <span>PDF</span>
            <span className="ml-auto text-[10px] text-gray-400">
              {busy === 'pdf' ? '…' : '.pdf'}
            </span>
          </button>
        </div>
      )}

      {statusMsg && (
        <div
          role="status"
          className="absolute right-0 top-full mt-1 max-w-xs rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 shadow-md"
          data-testid="export-status-msg"
        >
          {statusMsg}
        </div>
      )}
    </div>
  )
}
