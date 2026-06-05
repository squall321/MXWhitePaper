/**
 * N — drill modal export controls (4 modal 공통).
 *
 * 3 가지 액션을 한 줄로:
 *   - 📥 CSV: UTF-8 BOM + CSV (Excel 한글 호환)
 *   - 📋 Copy: TSV 를 system clipboard 로 (스프레드시트 paste 친화)
 *   - 📥 TSV: BOM + TSV (Excel 이 .csv 보다 더 견고하게 인식)
 *
 * Callers 가 두 builder (csv / tsv) 를 prop 으로 전달 — single-row vs
 * multi-row drill 에 따라 다른 helper 를 사용해야 하므로 컴포넌트가
 * shape 을 모름. 결과 텍스트만 받아 download / clipboard 트리거.
 *
 * Ultra-review fixes (post-N):
 *   - Fix B: setTimeout 을 useRef + cleanup 으로 → rapid double-click
 *     race + unmount-during-flash 의 state warning 회피.
 *   - Fix C: emoji 는 aria-hidden, button 자체는 aria-label, copy state
 *     change 는 aria-live="polite" 으로 SR 사용자에게 알림.
 */
import { useEffect, useRef, useState } from 'react'
import { copyToClipboard, downloadBlob, UTF8_BOM } from '@/lib/widgetExport'

interface Props {
  /** Build the CSV text — caller chooses drillRowsToCsv vs drillSingleRowToCsv. */
  buildCsv: () => string
  /** Build the TSV text — same shape choice as CSV. */
  buildTsv: () => string
  /** File stem (no extension). e.g. `chart-drill-Sales`. */
  filename: string
  /** test-id prefix — e.g. `chart-drill` → buttons get `chart-drill-csv` etc. */
  testIdPrefix: string
}

export function DrillExportControls({
  buildCsv,
  buildTsv,
  filename,
  testIdPrefix,
}: Props) {
  const [copyFlash, setCopyFlash] = useState<'idle' | 'ok' | 'fail'>('idle')
  // Fix B — single timer ref so double-clicks reset cleanly + unmount
  // cleanup prevents "setState on unmounted component" warnings.
  const flashTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) {
        window.clearTimeout(flashTimer.current)
        flashTimer.current = null
      }
    }
  }, [])

  const scheduleFlash = (state: 'ok' | 'fail') => {
    setCopyFlash(state)
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      setCopyFlash('idle')
      flashTimer.current = null
    }, 1500)
  }

  const handleCsv = () => {
    // S1 — CSV 는 BOM 유지. Excel/한글 OS 의 호환 가치가 strict-parser
    // 의 header[0] 오염 risk 보다 큼 (사용 시나리오: 사용자 → Excel).
    // strict parser (python csv / go encoding/csv) 사용자는 docs/lat/
    // documents.md 의 ★ N 항목의 안내대로 `﻿` strip.
    const csv = UTF8_BOM + buildCsv()
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `${filename}.csv`,
    )
  }
  const handleTsv = () => {
    // S1 — TSV 는 BOM 제거. Excel 의 TSV 인코딩 추정은 BOM 없이도 UTF-8
    // 로 잘 동작하고, BOM 이 있으면 strict parser (R, awk 의 일부) 가
    // 깨짐. CSV 와 TSV 의 contract 가 다른 게 정상.
    downloadBlob(
      new Blob([buildTsv()], { type: 'text/tab-separated-values;charset=utf-8' }),
      `${filename}.tsv`,
    )
  }
  const handleCopy = async () => {
    const ok = await copyToClipboard(buildTsv())
    scheduleFlash(ok ? 'ok' : 'fail')
  }

  // Fix C — aria-live polite status region 미러링 copy state. SR users
  // 가 클릭 결과를 들을 수 있다 (sr-only 라 시각적으로는 안 보임).
  const copyStatusText =
    copyFlash === 'ok' ? '클립보드에 복사됨' : copyFlash === 'fail' ? '복사 실패' : ''

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleCsv}
        data-testid={`${testIdPrefix}-csv`}
        aria-label="UTF-8 BOM 포함 CSV 다운로드"
        title="UTF-8 BOM 포함 CSV (Excel 한글 호환)"
        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
      >
        <span aria-hidden="true">📥 </span>CSV
      </button>
      <button
        type="button"
        onClick={handleTsv}
        data-testid={`${testIdPrefix}-tsv`}
        aria-label="UTF-8 BOM 포함 TSV 다운로드"
        title="UTF-8 BOM 포함 TSV (Excel 이 더 견고하게 인식)"
        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
      >
        <span aria-hidden="true">📥 </span>TSV
      </button>
      <button
        type="button"
        onClick={() => void handleCopy()}
        data-testid={`${testIdPrefix}-copy`}
        aria-label="TSV 를 클립보드로 복사"
        title="TSV 를 클립보드로 복사 (스프레드시트 paste 친화)"
        className={
          'rounded border px-2 py-0.5 text-[11px] transition-colors ' +
          (copyFlash === 'ok'
            ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            : copyFlash === 'fail'
              ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
              : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800')
        }
      >
        {copyFlash === 'ok' ? (
          <><span aria-hidden="true">✓ </span>복사됨</>
        ) : copyFlash === 'fail' ? (
          <><span aria-hidden="true">⚠ </span>실패</>
        ) : (
          <><span aria-hidden="true">📋 </span>Copy</>
        )}
      </button>
      {/* Fix C — SR-only live region. polite = 사용자의 다른 행동 안 끊음. */}
      <span
        role="status"
        aria-live="polite"
        data-testid={`${testIdPrefix}-status`}
        className="sr-only"
      >
        {copyStatusText}
      </span>
    </div>
  )
}
