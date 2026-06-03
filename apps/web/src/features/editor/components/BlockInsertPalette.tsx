import { useEffect, useRef, useState } from 'react'
import type { Block } from '@/types/document'
import { ulid } from '../ulid'
import { useLocale } from '@/lib/i18n'
import { getTablePreset, type TablePresetKind } from '../blocks/tablePresets'

/** Wrapper that asserts the kind exists at module load — keeps `build()` callsites tidy. */
function getTablePresetSafe(kind: TablePresetKind) {
  return getTablePreset(kind)
}

/**
 * BlockInsertPalette — small inline popover with the 16 most-used block
 * builders. Anchored to the `+` rail above/below a block, it returns the
 * picked block to the caller (which fires `insertBlock` with the right
 * `index`). Mouse + keyboard accessible:
 *   - ArrowLeft/ArrowRight or ArrowUp/ArrowDown moves focus through tiles.
 *   - Enter / Space picks the focused tile.
 *   - Esc closes without picking.
 *
 * Each tile carries a small tooltip with a 1-line description, a tiny visual
 * preview, and the slash-menu shortcut a keyboard user would type to insert
 * the same block from the `/` menu. Hover or focus the tile to surface it.
 *
 * Designed to feel like Notion's "/+" bubble — no chrome, very low friction.
 */

export interface PaletteItem {
  kind: string
  /** Default Korean label. Renderers should prefer `labelKey` when an i18n
   *  translator is available so the UI flips with the locale. */
  label: string
  /** i18n key for the visible tile label (e.g. `palette.paragraph`). */
  labelKey?: string
  /** Single-glyph icon. Stick to one char so the grid stays tidy. */
  icon: string
  /** Build the block payload; return null when the action delegates (image picker). */
  build: () => Block | null
  /** One-liner shown on hover. */
  hint: string
  /** Slash-menu shortcut (e.g. `/표` or `/H2`). */
  slash: string
  /** Tiny preview swatch shown above the hint. ASCII / single-line UI. */
  preview: string
}

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    kind: 'paragraph',
    label: '글',
    labelKey: 'palette.paragraph',
    icon: '¶',
    build: () => ({ type: 'paragraph', id: ulid(), text: '' }),
    hint: '일반 본문 단락. 마크다운으로 **굵게** *기울임* `코드` 가능.',
    slash: '/글',
    preview: '본문 한 줄을 자유롭게 작성해요.',
  },
  // Heading levels 2 / 3 / 4 — schema stores them all as heading-4 blocks
  // with the dedicated `level` field distinguishing the visual size. The
  // renderer picks the right CSS based on level (text-2xl / text-xl / text-lg).
  {
    kind: 'heading-2',
    label: '큰 제목',
    labelKey: 'palette.heading2',
    icon: 'H₂',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', level: 2 }),
    hint: 'level 2 큰 제목. 섹션 분기점에 사용하세요.',
    slash: '/H2',
    preview: 'H₂ 큰 제목',
  },
  {
    kind: 'heading-3',
    label: '중간 제목',
    labelKey: 'palette.heading3',
    icon: 'H₃',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', level: 3 }),
    hint: 'level 3 중간 제목. 큰 제목의 하위 분류.',
    slash: '/H3',
    preview: 'H₃ 중간 제목',
  },
  {
    kind: 'heading-4',
    label: '작은 제목',
    labelKey: 'palette.heading4',
    icon: 'H₄',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', level: 4 }),
    hint: 'level 4 작은 제목. 가장 가벼운 강조.',
    slash: '/H4',
    preview: 'H₄ 작은 제목',
  },
  // Lists — split per style so users pick up-front instead of cycling later.
  {
    kind: 'bullet-list',
    label: '글머리 목록',
    labelKey: 'palette.bulletList',
    icon: '•',
    build: () => ({ type: 'list', id: ulid(), style: 'bullet', items: [''] }),
    hint: '점(•)으로 시작하는 비순서 목록.',
    slash: '/목록',
    preview: '• 항목 1\n• 항목 2',
  },
  {
    kind: 'numbered-list',
    label: '번호 목록',
    labelKey: 'palette.numberedList',
    icon: '1.',
    build: () => ({ type: 'list', id: ulid(), style: 'number', items: [''] }),
    hint: '1, 2, 3 … 자동 번호가 붙는 목록.',
    slash: '/번호',
    preview: '1. 첫째\n2. 둘째',
  },
  {
    kind: 'check-list',
    label: '체크리스트',
    labelKey: 'palette.checkList',
    icon: '☑',
    build: () => ({ type: 'list', id: ulid(), style: 'check', items: [''] }),
    hint: '체크박스로 진행 상태를 관리.',
    slash: '/체크',
    preview: '☐ 할 일\n☑ 완료',
  },
  {
    kind: 'callout',
    label: '콜아웃',
    labelKey: 'palette.callout',
    icon: '!',
    build: () => ({ type: 'callout', id: ulid(), variant: 'info', text: '' }),
    hint: 'info / warn / danger / tip 강조 박스.',
    slash: '/콜아웃',
    preview: 'ℹ 정보 알림',
  },
  {
    kind: 'quote',
    label: '인용',
    labelKey: 'palette.quote',
    icon: '“',
    build: () => ({ type: 'quote', id: ulid(), text: '' }),
    hint: '인용문. 출처(`cite`)도 함께 보관.',
    slash: '/인용',
    preview: '“ 인용 한 줄 ”',
  },
  {
    kind: 'code',
    label: '코드',
    labelKey: 'palette.code',
    icon: '<>',
    build: () => ({ type: 'code', id: ulid(), code: '', language: 'text' }),
    hint: '언어별 하이라이팅 코드 블록.',
    slash: '/코드',
    preview: '`const x = 1`',
  },
  {
    kind: 'table',
    label: '표',
    labelKey: 'palette.table',
    icon: '▦',
    build: () => ({ type: 'table', id: ulid(), headers: ['열 1', '열 2'], rows: [['', '']] }),
    hint: '행/열 표. CSV 붙여넣기로 빠르게 채울 수 있어요.',
    slash: '/표',
    preview: '┌─┬─┐\n├─┼─┤',
  },
  {
    kind: 'table-comparison',
    label: '비교표',
    icon: '⚖',
    build: () => getTablePresetSafe('comparison').build(),
    hint: '두 옵션을 항목별로 비교 (가격/기능/장단점).',
    slash: '/비교표',
    preview: '항목 │ A │ B',
  },
  {
    kind: 'table-schedule',
    label: '일정표',
    icon: '📅',
    build: () => getTablePresetSafe('schedule').build(),
    hint: '날짜·담당·작업·상태 4열 일정 표 (정렬·검색 ON).',
    slash: '/일정표',
    preview: '05-12 │ 진행중',
  },
  {
    kind: 'table-budget',
    label: '예산표',
    icon: '💰',
    build: () => getTablePresetSafe('budget').build(),
    hint: 'Q1~Q4 통화 셀 + 합계 행 (KRW 자동 포맷).',
    slash: '/예산표',
    preview: '항목 │ Q1 │ ... │ 합계',
  },
  {
    kind: 'table-checklist',
    label: '체크리스트 표',
    icon: '☑',
    build: () => getTablePresetSafe('checklist').build(),
    hint: '☐ 체크박스 + 작업·담당·마감.',
    slash: '/체크리스트표',
    preview: '☐ 작업 / 담당',
  },
  {
    kind: 'chart',
    label: '차트',
    labelKey: 'palette.chart',
    icon: '📊',
    build: () => ({ type: 'chart', id: ulid(), chartType: 'line', data: { labels: [], series: [] } }),
    hint: '막대/선/원/면적/레이더/산점. CSV 붙여넣기 지원.',
    slash: '/차트',
    preview: '▁▂▃▅▇',
  },
  {
    kind: 'pivot-table',
    label: '피벗 표',
    labelKey: 'palette.pivot',
    icon: '🔀',
    build: () => ({
      type: 'pivot-table',
      id: ulid(),
      source: { kind: 'inline', rows: [] },
      rows: [],
      cols: [],
      values: [{ field: '', agg: 'sum' }],
    }),
    hint: 'raw rows 를 row × col cross-tab 집계 (Excel pivot table 동등).',
    slash: '/피벗',
    preview: ' Σ A | B | C',
  },
  {
    kind: 'slicer',
    label: '슬라이서',
    labelKey: 'palette.slicer',
    icon: '🔘',
    build: () => ({
      type: 'slicer',
      id: ulid(),
      field: '',
      source: { kind: 'inline', rows: [] },
    }),
    hint: '값 chip 그룹으로 같은 문서의 Pivot 등에 cross-widget filter.',
    slash: '/슬라이서',
    preview: '● A ○ B ○ C',
  },
  {
    kind: 'image',
    label: '이미지',
    labelKey: 'palette.image',
    icon: '🖼',
    build: () => null,
    hint: '업로드 또는 URL 첨부. 캡션 / alt 텍스트 지원.',
    slash: '/이미지',
    preview: '🖼 (image)',
  },
  {
    kind: 'math',
    label: '수식',
    labelKey: 'palette.math',
    icon: '∑',
    build: () => ({ type: 'math', id: ulid(), expression: '' }),
    hint: 'LaTeX 수식 (KaTeX 렌더). 인라인/블록 모두 지원.',
    slash: '/수식',
    preview: '∫ f(x) dx',
  },
  {
    kind: 'video',
    label: '영상',
    labelKey: 'palette.video',
    icon: '▶',
    build: () => ({ type: 'video', id: ulid(), url: '' }),
    hint: '사내/유튜브/비메오 영상 임베드.',
    slash: '/영상',
    preview: '▶ video',
  },
  {
    kind: 'iframe-url',
    label: '임베드 (외부 URL)',
    labelKey: 'palette.iframeUrl',
    icon: '🌐',
    build: () => ({ type: 'iframe', id: ulid(), src: '' }),
    hint: '사내 화이트리스트 도메인의 외부 페이지를 임베드합니다.',
    slash: '/임베드',
    preview: '🌐 https://…',
  },
  {
    kind: 'iframe-html',
    label: 'HTML 임베드 (인라인)',
    labelKey: 'palette.iframeHtml',
    icon: '⟨/⟩',
    build: () => ({
      type: 'iframe',
      id: ulid(),
      html: '<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n<body>\n<!-- HTML을 작성하거나 .html 파일을 업로드하세요 -->\n</body>\n</html>',
    }),
    hint: '자기완결형 HTML을 sandbox iframe으로 임베드 (인터랙티브 그래프 등). .html 파일 업로드 가능.',
    slash: '/HTML',
    preview: '⟨/⟩ inline html',
  },
  {
    kind: 'file',
    label: '파일',
    labelKey: 'palette.file',
    icon: '📎',
    build: () => ({ type: 'file', id: ulid(), fileId: '', name: '' }),
    hint: '첨부 파일. 다운로드 카드로 표시됩니다.',
    slash: '/파일',
    preview: '📎 file.pdf',
  },
  {
    kind: 'snippet',
    label: '스니펫',
    labelKey: 'palette.snippet',
    icon: '📚',
    // build() returns null — caller opens SnippetPicker and inserts the resolved
    // blocks itself (similar to how the 'image' tile opens the image picker).
    build: () => null,
    hint: '저장된 블록 묶음을 현재 위치에 삽입.',
    slash: '/스니펫',
    preview: '📚 saved blocks',
  },
  {
    kind: 'whiteboard',
    label: '화이트보드',
    labelKey: 'palette.whiteboard',
    icon: '🎨',
    build: () => ({
      type: 'whiteboard',
      id: ulid(),
      viewbox: { w: 800, h: 480 },
      elements: [],
    }),
    hint: '펜/도형/텍스트로 그리는 자유 캔버스 (free-draw board).',
    slash: '/화이트보드',
    preview: '🎨 free-draw board',
  },
  {
    kind: 'form',
    label: '설문',
    labelKey: 'palette.form',
    icon: '📋',
    build: () => ({
      type: 'form',
      id: ulid(),
      title: '새 설문',
      questions: [
        { id: ulid(), kind: 'text', label: '질문 1', required: false },
      ],
    }),
    hint: '독자가 채워서 제출하는 설문/체크리스트/퀴즈.',
    slash: '/설문',
    preview: '📋 설문 폼',
  },
  {
    kind: 'pdf',
    label: 'PDF',
    labelKey: 'palette.pdf',
    icon: '📕',
    build: () => ({
      type: 'pdf',
      id: ulid(),
      file_id: '',
      page: 1,
      height_px: 600,
    }),
    hint: 'SOP/규정/양식 PDF를 인라인으로 미리보기 + 다운로드.',
    slash: '/PDF',
    preview: '📕 PDF 미리보기',
  },
  {
    kind: 'image-annotation',
    label: '이미지 주석',
    labelKey: 'palette.imageAnnotation',
    icon: '🖍',
    build: () => ({
      type: 'image-annotation',
      id: ulid(),
      imageId: '',
      annotations: [],
    }),
    hint: '업로드한 이미지에 화살표/사각형/콜아웃을 얹어 강조.',
    slash: '/주석',
    preview: '🖍 image + arrows',
  },
  {
    kind: 'quiz',
    label: '퀴즈',
    labelKey: 'palette.quiz',
    icon: '📝',
    build: () => ({
      type: 'quiz',
      id: ulid(),
      title: '새 퀴즈',
      passing_score: 70,
      max_attempts: 0,
      show_answers_after: true,
      questions: [
        {
          id: ulid(),
          kind: 'single-choice',
          label: '문제 1',
          options: ['옵션 1', '옵션 2'],
          correct: '옵션 1',
          points: 1,
        },
      ],
    }),
    hint: '정답/배점/통과 점수가 있는 퀴즈/평가 블록.',
    slash: '/퀴즈',
    preview: '📝 퀴즈 / 평가',
  },
  {
    kind: 'spreadsheet',
    label: '스프레드시트',
    labelKey: 'palette.spreadsheet',
    icon: '🧮',
    build: () => ({
      type: 'spreadsheet',
      id: ulid(),
      cols: 6,
      rows: 10,
      cells: {},
    }),
    hint: '셀 기반 표 + 간단한 수식 (=SUM/AVG/IF 등). 풀 엑셀이 아니라 가벼운 계산용.',
    slash: '/스프레드시트',
    preview: '🧮 A1+B1=…',
  },
  {
    kind: 'bibliography',
    label: '참고문헌',
    labelKey: 'palette.bibliography',
    icon: '📚',
    build: () => ({
      type: 'bibliography',
      id: ulid(),
      entries: [{ text: '' }],
    }),
    hint: '참고문헌 목록. 각 항목에 key를 부여하면 본문 [[cite:KEY]] 가 그 항목으로 연결됩니다.',
    slash: '/참고문헌',
    preview: '📚 [1] Smith, J. (2020) …',
  },
]

interface Props {
  /** Position the palette opens at; usually the click coordinates. */
  anchor: { x: number; y: number }
  onPick: (item: PaletteItem) => void
  onClose: () => void
}

export function BlockInsertPalette({ anchor, onPick, onClose }: Props) {
  const { t } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const tileLabel = (it: PaletteItem) => (it.labelKey ? t(it.labelKey) : it.label)

  // Click outside / Esc to close.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Focus the first tile when the palette mounts so keyboard users can pick
  // immediately without an extra Tab.
  useEffect(() => {
    const first = ref.current?.querySelector('button') as HTMLButtonElement | null
    first?.focus()
  }, [])

  // 클릭 위치가 메뉴의 좌상단이 되도록 — 이전엔 (anchor.x-12, anchor.y+4)
  // 로 임의 오프셋을 줘서 사용자가 어색하게 느꼈다 (커서 위치와 메뉴의 좌상단
  // 모서리가 어긋남). 양방향으로 viewport 안에 가두는 clamp 도 추가:
  // 화면 우측 가까이 클릭하면 오른쪽 가장자리에서 안쪽으로, 화면 아래쪽이면
  // 위로 올려서 메뉴가 잘리지 않게 한다. 메뉴 폭은 w-72 (288px), 높이는
  // 동적이라 보수적으로 360px 추정.
  const PALETTE_W = 288
  const PALETTE_H_GUESS = 360
  const left = Math.max(
    8,
    Math.min(anchor.x, window.innerWidth - PALETTE_W - 8),
  )
  const top = Math.max(
    8,
    Math.min(anchor.y, window.innerHeight - PALETTE_H_GUESS - 8),
  )

  const onTileKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const tiles = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('button[data-tile]') ?? [],
    )
    const idx = tiles.indexOf(e.currentTarget)
    if (idx < 0) return
    const cols = 4
    let next = idx
    if (e.key === 'ArrowRight') next = idx + 1
    else if (e.key === 'ArrowLeft') next = idx - 1
    else if (e.key === 'ArrowDown') next = idx + cols
    else if (e.key === 'ArrowUp') next = idx - cols
    else return
    e.preventDefault()
    next = Math.max(0, Math.min(tiles.length - 1, next))
    tiles[next]?.focus()
  }

  const active = hovered ? PALETTE_ITEMS.find((it) => it.kind === hovered) ?? null : null

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('palette.label')}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 'var(--z-popover)' as unknown as number,
      }}
      className="w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
        {PALETTE_ITEMS.map((it) => (
          <button
            key={it.kind}
            type="button"
            data-tile
            data-kind={it.kind}
            aria-describedby={`palette-tip-${it.kind}`}
            title={`${it.hint} (${it.slash})`}
            onClick={() => onPick(it)}
            onKeyDown={onTileKeyDown}
            onMouseEnter={() => setHovered(it.kind)}
            onMouseLeave={() => setHovered((cur) => (cur === it.kind ? null : cur))}
            onFocus={() => setHovered(it.kind)}
            onBlur={() => setHovered((cur) => (cur === it.kind ? null : cur))}
            className="flex flex-col items-center gap-1 rounded-md border border-transparent px-1 py-2 text-[11px] text-gray-700 transition-colors hover:border-smsg-300 hover:bg-smsg-50 hover:text-smsg-900 focus-visible:border-smsg-500 focus-visible:bg-smsg-50 focus-visible:outline-none dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <span aria-hidden className="text-base leading-none">{it.icon}</span>
            <span>{tileLabel(it)}</span>
          </button>
        ))}
      </div>

      {/* Hidden description nodes, surfaced through aria-describedby so screen
          readers always have the same body even though the visible tooltip
          only renders for the hovered tile. */}
      <div className="sr-only">
        {PALETTE_ITEMS.map((it) => (
          <span key={it.kind} id={`palette-tip-${it.kind}`}>
            {`${it.hint} ${t('palette.tooltip.shortcutHint', { slash: it.slash })}`}
          </span>
        ))}
      </div>

      {active && (
        <div
          role="tooltip"
          data-testid="palette-tooltip"
          className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-[11px] leading-snug text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          <p className="font-semibold text-smsg-900 dark:text-smsg-100">{tileLabel(active)}</p>
          <p className="mt-0.5">{active.hint}</p>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-white px-2 py-1 font-mono text-[10px] text-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {active.preview}
          </pre>
          <p className="mt-1 text-[10px] text-gray-500">
            {t('palette.tooltip.slash')}: <kbd className="rounded border border-gray-300 bg-white px-1 font-mono dark:border-gray-600 dark:bg-gray-900">{active.slash}</kbd>
          </p>
        </div>
      )}
    </div>
  )
}
