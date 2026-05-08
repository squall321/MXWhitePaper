import { ulid } from '../ulid'

/**
 * Minimal shape of a BlockNote editor exposed for the slash menu.
 * Cast at the boundary so we don't depend on generic instantiations.
 */
export interface BNEditorLike {
  insertBlocks: (
    blocks: unknown[],
    referenceBlock: unknown,
    placement: 'after' | 'before',
  ) => void
  getTextCursorPosition: () => { block: unknown }
  focus?: () => void
}

/**
 * One slash-menu entry shaped to be a `DefaultReactSuggestionItem`. Compatible
 * fields only: title / subtext / aliases / group / onItemClick.
 */
export interface SlashItem {
  /** Korean display label. */
  title: string
  /** English helper subtitle (and shortcut hint, when applicable). */
  subtext?: string
  /** Group header label. */
  group: string
  aliases?: string[]
  onItemClick: () => void
}

/**
 * Insert a block at the cursor and trigger the focus-pulse callback.
 */
function insertAtCursor(
  editor: BNEditorLike,
  block: Record<string, unknown>,
  pulse?: () => void,
) {
  const cur = editor.getTextCursorPosition?.()
  const ref = cur?.block
  // BlockNote requires a block with `id` if we set it; otherwise it generates.
  const payload = { id: ulid(), ...block }
  if (ref) {
    editor.insertBlocks([payload], ref, 'after')
  } else {
    editor.insertBlocks([payload], { id: 'first' }, 'after')
  }
  pulse?.()
  setTimeout(() => editor.focus?.(), 30)
}

/**
 * The 25 block types organized into eight groups. Korean labels with English
 * helper text. Non-native types (chart / gantt / gallery / etc.) insert a
 * paragraph carrying a `docJsonRaw` placeholder; the adapter reconstructs them
 * on save so a round-trip keeps the type intact.
 */
export function buildSlashItems(
  editor: BNEditorLike,
  pulse?: () => void,
): SlashItem[] {
  const placeholder = (
    title: string,
    subtext: string,
    docType: string,
    docJson: Record<string, unknown>,
    group: string,
    aliases: string[] = [],
  ): SlashItem => ({
    title,
    subtext,
    group,
    aliases: [...aliases, docType],
    onItemClick: () =>
      insertAtCursor(
        editor,
        {
          type: 'paragraph',
          props: {
            docJsonId: ulid(),
            docJsonRaw: JSON.stringify({ ...docJson, type: docType, id: ulid() }),
          },
          content: [{ type: 'text', text: `[${docType}]`, styles: {} }],
        },
        pulse,
      ),
  })

  return [
    // -------- 텍스트 --------
    {
      title: '단락',
      subtext: 'Paragraph',
      group: '텍스트',
      aliases: ['paragraph', '글'],
      onItemClick: () => insertAtCursor(editor, { type: 'paragraph' }, pulse),
    },
    {
      title: '소제목 (H4)',
      subtext: 'Heading 4',
      group: '텍스트',
      aliases: ['heading', '제목'],
      onItemClick: () =>
        insertAtCursor(editor, { type: 'heading', props: { level: 4 } }, pulse),
    },
    {
      title: '인용',
      subtext: 'Quote',
      group: '텍스트',
      aliases: ['quote', '인용'],
      onItemClick: () => insertAtCursor(editor, { type: 'quote' }, pulse),
    },
    {
      title: '강조 박스',
      subtext: 'Callout',
      group: '텍스트',
      aliases: ['callout', '콜아웃'],
      onItemClick: () =>
        insertAtCursor(
          editor,
          {
            type: 'paragraph',
            props: {
              docJsonId: ulid(),
              docJsonCallout: JSON.stringify({ variant: 'info', title: '' }),
            },
          },
          pulse,
        ),
    },
    {
      title: '코드',
      subtext: 'Code block · ```',
      group: '텍스트',
      aliases: ['code', '코드'],
      onItemClick: () =>
        insertAtCursor(editor, { type: 'codeBlock', props: { language: 'text' } }, pulse),
    },

    // -------- 리스트 --------
    {
      title: '글머리 목록',
      subtext: 'Bullet list · - ',
      group: '리스트',
      aliases: ['bulletListItem', 'list'],
      onItemClick: () => insertAtCursor(editor, { type: 'bulletListItem' }, pulse),
    },
    {
      title: '번호 목록',
      subtext: 'Numbered list · 1. ',
      group: '리스트',
      aliases: ['numberedListItem'],
      onItemClick: () => insertAtCursor(editor, { type: 'numberedListItem' }, pulse),
    },
    {
      title: '체크리스트',
      subtext: 'Check list',
      group: '리스트',
      aliases: ['checkListItem', '체크'],
      onItemClick: () => insertAtCursor(editor, { type: 'checkListItem' }, pulse),
    },

    // -------- 표 --------
    {
      title: '표',
      subtext: 'Table',
      group: '표',
      aliases: ['table', '표'],
      onItemClick: () => insertAtCursor(editor, { type: 'table' }, pulse),
    },

    // -------- 차트 --------
    placeholder('차트', 'Chart', 'chart', {
      chartType: 'line',
      data: { labels: [], series: [] },
    }, '차트'),
    placeholder('KPI 카드', 'KPI cards', 'kpi-cards', {
      items: [{ label: '', value: 0 }],
    }, '차트', ['kpi']),
    placeholder('간트', 'Gantt', 'gantt', { tasks: [] }, '차트'),
    placeholder(
      '플로우',
      'Mermaid flow',
      'flow',
      { engine: 'mermaid', source: '' },
      '차트',
      ['mermaid', '플로우'],
    ),
    placeholder('조직도', 'Org chart', 'org-chart', {
      root: { id: ulid(), label: '' },
    }, '차트'),

    // -------- 미디어 --------
    {
      title: '이미지',
      subtext: 'Image · 파일 선택이 열립니다',
      group: '미디어',
      aliases: ['image', '이미지', '사진'],
      onItemClick: () => {
        // The toolbar listens for this and pops its file picker.
        window.dispatchEvent(new CustomEvent('mxwp:open-image-picker'))
      },
    },
    placeholder('갤러리', 'Gallery', 'gallery', { layout: 'grid', items: [] }, '미디어'),
    {
      title: '비디오',
      subtext: 'Video',
      group: '미디어',
      aliases: ['video', '동영상'],
      onItemClick: () => insertAtCursor(editor, { type: 'video' }, pulse),
    },
    placeholder('파일', 'File attachment', 'file', { fileId: '', name: '' }, '미디어'),

    // -------- 임베드 --------
    placeholder('임베드 (iframe)', 'Iframe', 'iframe', { src: '' }, '임베드'),
    placeholder(
      '대시보드',
      'Dashboard',
      'dashboard-embed',
      { provider: 'grafana', panelId: '' },
      '임베드',
      ['dashboard'],
    ),
    placeholder(
      '데이터 소스',
      'Data source',
      'data-source',
      { endpoint: '', render: 'table' },
      '임베드',
      ['data'],
    ),

    // -------- 레이아웃 --------
    placeholder(
      '단(Columns)',
      'Columns',
      'columns',
      { columns: [[], []] },
      '레이아웃',
    ),
    placeholder('탭', 'Tabs', 'tabs', { tabs: [] }, '레이아웃'),
    placeholder('아코디언', 'Accordion', 'accordion', { items: [] }, '레이아웃'),

    // -------- 위젯 --------
    placeholder(
      '수식',
      'Math (KaTeX)',
      'math',
      { expression: '' },
      '위젯',
      ['math', '수식'],
    ),
    placeholder(
      '계산기',
      'Calculator',
      'calculator',
      { inputs: [], formula: '0' },
      '위젯',
    ),
    placeholder(
      '문서 링크 카드',
      'Doc link card',
      'doc-link-card',
      { slug: '' },
      '위젯',
    ),
    placeholder(
      '용어 참조',
      'Glossary ref',
      'glossary-ref',
      { term: '' },
      '위젯',
    ),
  ]
}
