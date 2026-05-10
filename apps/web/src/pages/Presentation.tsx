import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useDocument } from '@/features/document/hooks/useDocument'
import {
  buildSlides,
  keyToNav,
  navigate as navReducer,
  speakerNotesFor,
  splitSpeakerNotes,
  type Slide,
} from '@/features/presentation/slideMachine'
import { SlideBlockRenderer } from '@/features/presentation/SlideBlockRenderer'
import { SectionLayout } from '@/components/SectionLayout'
import { openPresenterChannel } from '@/features/presentation/presenterChannel'
import {
  TRANSITIONS_CSS,
  blockWrapperClass,
  staggerStyle,
  themeAttrs,
} from '@/features/presentation/transitions.css'
import {
  useSettingsStore,
  type SlideTheme,
  type SlideTransition,
} from '@/features/settings/store'

/**
 * Presentation mode — one section per slide, keyboard-driven.
 *
 * Routes
 * ------
 *   /present/:slug              → flat (title + level-1 sections only)
 *   /present/:slug?nested=1     → also one slide per level-2 subsection
 *   /present/:slug/notes        → presenter view (popup, see PresenterView.tsx)
 *
 * Keyboard
 * --------
 *   →, Space, PageDown      next
 *   ←, PageUp               prev
 *   Home / End              first / last
 *   1..9                    jump to slide N
 *   B                       black-screen overlay
 *   W                       white-screen overlay
 *   T                       toggle thumbnail strip
 *   N                       toggle inline notes pane
 *   H                       toggle watermark
 *   Shift+P                 open presenter view (separate window)
 *   Esc                     exit (back to /docs/:slug)
 *   ?                       toggle keyboard help overlay
 *
 * Print: each `<article.slide>` page-breaks so File→Print produces a deck PDF.
 */
export function PresentationPage() {
  const { slug } = useParams<{ slug: string }>()
  const [params] = useSearchParams()
  const nested = params.get('nested') === '1'
  const navigate = useNavigate()
  const { data, isPending, isError } = useDocument(slug)

  const slides = useMemo<Slide[]>(() => {
    if (!data?.document) return []
    try {
      return buildSlides(data.document, { nested })
    } catch (err) {
       
      console.error('[Presentation] buildSlides failed', err)
      return []
    }
  }, [data, nested])

  const [index, dispatch] = useReducer(
    (state: number, action: Parameters<typeof navReducer>[2]) =>
      navReducer(state, slides.length, action),
    0,
  )
  const total = slides.length
  const [helpOpen, setHelpOpen] = useState(false)
  const [overlay, setOverlay] = useState<'black' | 'white' | null>(null)
  const [stripVisible, setStripVisible] = useState(false)
  const [notesVisible, setNotesVisible] = useState(false)
  const [watermarkHidden, setWatermarkHidden] = useState(false)

  // Visual preferences (transition, theme, stagger). Subscribing to the store
  // re-renders on change so cycling through options updates immediately.
  const slideTransition = useSettingsStore((s) => s.slide_transition)
  const slideTheme = useSettingsStore((s) => s.slide_theme)
  const slideStagger = useSettingsStore((s) => s.slide_stagger)
  const setSetting = useSettingsStore((s) => s.set)

  const exit = useCallback(() => {
    if (slug) navigate(`/docs/${slug}`)
    else navigate('/')
  }, [navigate, slug])

  // Open the presenter view in a separate window. Sized for typical
  // notebook secondary screens; the user can resize freely.
  const openPresenter = useCallback(() => {
    if (!slug) return
    const url = `/present/${encodeURIComponent(slug)}/notes${nested ? '?nested=1' : ''}`
    window.open(url, 'mx-presenter', 'width=1280,height=720,popup=yes')
  }, [slug, nested])

  // BroadcastChannel sync: post our index whenever it changes, and listen
  // for index updates from the presenter window so navigation in either side
  // stays consistent. We piggy-back the visual prefs (theme/transition/stagger)
  // on every tick so the popup window stays visually aligned without needing
  // its own settings store hookup.
  useEffect(() => {
    if (total === 0) return
    const channel = openPresenterChannel()
    channel.post({
      index,
      total,
      ts: Date.now(),
      theme: slideTheme,
      transition: slideTransition,
      stagger: slideStagger,
    })
    channel.close()
  }, [index, total, slideTheme, slideTransition, slideStagger])

  useEffect(() => {
    const channel = openPresenterChannel()
    const unsub = channel.subscribe((msg) => {
      dispatch({ type: 'goto', index: msg.index })
    })
    return () => {
      unsub()
      channel.close()
    }
  }, [])

  // Keyboard handler — global, ignores modifier-only events.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      // Shift+P opens the presenter view. Detect before the lower-cased map.
      if (ev.shiftKey && (ev.key === 'P' || ev.key === 'p') && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault()
        openPresenter()
        return
      }
      if (ev.key === 'Escape') {
        ev.preventDefault()
        if (overlay) {
          setOverlay(null)
          return
        }
        exit()
        return
      }
      if (ev.key === '?') {
        ev.preventDefault()
        setHelpOpen((v) => !v)
        return
      }
      // Ignore modified shortcuts past this point.
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      switch (ev.key) {
        case 'b':
        case 'B':
          ev.preventDefault()
          setOverlay((v) => (v === 'black' ? null : 'black'))
          return
        case 'w':
        case 'W':
          ev.preventDefault()
          setOverlay((v) => (v === 'white' ? null : 'white'))
          return
        case 't':
        case 'T':
          ev.preventDefault()
          setStripVisible((v) => !v)
          return
        case 'n':
        case 'N':
          ev.preventDefault()
          setNotesVisible((v) => !v)
          return
        case 'h':
        case 'H':
          ev.preventDefault()
          setWatermarkHidden((v) => !v)
          return
      }
      const cmd = keyToNav(ev)
      if (cmd) {
        ev.preventDefault()
        dispatch(cmd)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit, openPresenter, overlay])

  if (!slug) {
    return (
      <div style={{ color: 'white', padding: 24 }}>
        <p>슬러그가 지정되지 않았습니다.</p>
        <a href="/" style={{ color: '#a5b4fc', textDecoration: 'underline' }}>
          ← 돌아가기
        </a>
      </div>
    )
  }
  if (isPending)
    return <p style={{ color: 'white', padding: 24 }}>불러오는 중…</p>
  if (isError || !data) {
    const status = (
      (
        (data as unknown) ??
        (Object.create(null) as { response?: { status?: number } })
      ) as { response?: { status?: number } }
    )?.response?.status
    return (
      <div style={{ color: 'white', padding: 24 }}>
        <p>
          {status === 404
            ? '해당 슬러그의 문서를 찾을 수 없습니다.'
            : '문서를 불러오지 못했습니다.'}
        </p>
        <a
          href="/"
          style={{ color: '#a5b4fc', textDecoration: 'underline' }}
        >
          ← 돌아가기
        </a>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div style={{ color: 'white', padding: 24 }}>
        <p>슬라이드를 만들 수 없는 문서입니다.</p>
        <a
          href={`/docs/${encodeURIComponent(slug)}`}
          style={{ color: '#a5b4fc', textDecoration: 'underline' }}
        >
          ← 돌아가기
        </a>
      </div>
    )
  }
  // `index` is reducer-clamped, but TS sees `slides[number]` as possibly
  // undefined under noUncheckedIndexedAccess. Guard explicitly.
  const slide = slides[index] ?? slides[0]
  if (!slide) {
    return (
      <div style={{ color: 'white', padding: 24 }}>
        <p>렌더할 슬라이드가 없습니다.</p>
        <a
          href={`/docs/${encodeURIComponent(slug)}`}
          style={{ color: '#a5b4fc', textDecoration: 'underline' }}
        >
          ← 돌아가기
        </a>
      </div>
    )
  }
  const progress = total > 1 ? ((index + 1) / total) * 100 : 100
  const notes = speakerNotesFor(slide)
  const sectionNumber = slide.kind === 'section' ? slide.number || '' : ''

  return (
    <div className="presentation-root" {...themeAttrs(slideTheme)}>
      <style>{PRESENTATION_CSS}</style>
      <style>{TRANSITIONS_CSS}</style>
      {/* Keying on `index` remounts the wrapper on every navigation so the
          CSS animation replays. The data attribute selects the kind. */}
      <div
        key={index}
        className="slide-anim"
        data-pres-transition={slideTransition}
      >
        <article
          className={`slide${slide.kind === 'section' && shouldAutoShrink(slide) ? ' slide-dense' : ''}`}
          data-kind={slide.kind}
          aria-live="polite"
        >
          <SlideContent slide={slide} staggerEnabled={slideStagger} />
          {!watermarkHidden && (
            <div className="slide-watermark" aria-hidden>
              <span>{slug}</span>
              {sectionNumber && <span> · §{sectionNumber}</span>}
            </div>
          )}
        </article>
      </div>

      <PresentationToolbar
        theme={slideTheme}
        transition={slideTransition}
        stagger={slideStagger}
        onCycleTheme={() => setSetting('slide_theme', cycleTheme(slideTheme))}
        onCycleTransition={() =>
          setSetting('slide_transition', cycleTransition(slideTransition))
        }
        onToggleStagger={() => setSetting('slide_stagger', !slideStagger)}
      />

      {notesVisible && (
        <aside className="slide-notes" aria-label="발표자 메모">
          <h3>발표자 메모</h3>
          <div className="slide-notes-body">
            {notes ? (
              notes.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p className="slide-notes-empty">메모 없음</p>
            )}
          </div>
        </aside>
      )}

      {stripVisible && (
        <SlideThumbnailStrip
          slides={slides}
          activeIndex={index}
          onPick={(i) => dispatch({ type: 'goto', index: i })}
        />
      )}

      {overlay && (
        <div
          className={`slide-blank slide-blank-${overlay}`}
          role="presentation"
          onClick={() => setOverlay(null)}
        />
      )}

      <footer className="slide-chrome">
        <div className="slide-progress" aria-hidden>
          <div
            className="slide-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="slide-counter">
          <button
            type="button"
            onClick={() => dispatch({ type: 'prev' })}
            aria-label="이전 슬라이드"
            disabled={index === 0}
          >
            ←
          </button>
          <span className="counter">
            {index + 1} / {total}
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'next' })}
            aria-label="다음 슬라이드"
            disabled={index >= total - 1}
          >
            →
          </button>
          <span className="sep">·</span>
          <button type="button" onClick={() => setStripVisible((v) => !v)} aria-pressed={stripVisible}>
            T 썸네일
          </button>
          <button type="button" onClick={() => setNotesVisible((v) => !v)} aria-pressed={notesVisible}>
            N 메모
          </button>
          <button type="button" onClick={openPresenter}>
            발표자 보기
          </button>
          <button type="button" onClick={() => setHelpOpen((v) => !v)}>
            ? 도움말
          </button>
          <button type="button" onClick={exit}>
            Esc 종료
          </button>
        </div>
      </footer>

      {helpOpen && (
        <div
          className="slide-help"
          role="dialog"
          aria-label="단축키"
          onClick={() => setHelpOpen(false)}
        >
          <div className="slide-help-card" onClick={(e) => e.stopPropagation()}>
            <h2>키보드 단축키</h2>
            <ul>
              <li><kbd>→</kbd> / <kbd>Space</kbd> / <kbd>PageDown</kbd> — 다음</li>
              <li><kbd>←</kbd> / <kbd>PageUp</kbd> — 이전</li>
              <li><kbd>Home</kbd> / <kbd>End</kbd> — 처음 / 끝</li>
              <li><kbd>1</kbd>…<kbd>9</kbd> — N번 슬라이드로 이동</li>
              <li><kbd>B</kbd> — 검은 화면</li>
              <li><kbd>W</kbd> — 흰 화면</li>
              <li><kbd>T</kbd> — 썸네일 토글</li>
              <li><kbd>N</kbd> — 메모 패널 토글</li>
              <li><kbd>H</kbd> — 워터마크 토글</li>
              <li><kbd>Shift</kbd>+<kbd>P</kbd> — 발표자 화면 (새 창)</li>
              <li><kbd>?</kbd> — 이 도움말</li>
              <li><kbd>Esc</kbd> — 종료</li>
            </ul>
            <button type="button" onClick={() => setHelpOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SlideContent({
  slide,
  staggerEnabled,
}: {
  slide: Slide
  staggerEnabled: boolean
}) {
  if (slide.kind === 'title') {
    const tags = Array.isArray(slide.meta?.tags) ? slide.meta.tags : []
    return (
      <div className="slide-body slide-title">
        <h1>{slide.title || '(제목 없음)'}</h1>
        {slide.summary && <p className="slide-summary">{slide.summary}</p>}
        <div className="slide-meta">
          {slide.meta?.path && <span>{slide.meta.path}</span>}
          {slide.meta?.confidentiality && (
            <span className="badge">{slide.meta.confidentiality}</span>
          )}
          {tags.slice(0, 5).map((t) => (
            <span key={t} className="tag">#{t}</span>
          ))}
        </div>
      </div>
    )
  }
  const allBlocks = Array.isArray(slide.section?.blocks) ? slide.section.blocks : []
  const { body } = splitSpeakerNotes(allBlocks)
  const layout = slide.section?.layout
  // `title-only` is a deliberate cover-style slide: render only the heading,
  // hide all body blocks. Other layouts go through SectionLayout for the
  // 2-col / image-left / image-right / full-bleed shapes; the wrapper
  // staggered-animation classes are applied to each layout cell.
  const isTitleOnly = layout === 'title-only'
  return (
    <div className="slide-body slide-section">
      <header className="slide-heading">
        {slide.number && <span className="num">{slide.number}</span>}
        <h2>{slide.title || '(제목 없음)'}</h2>
      </header>
      {!isTitleOnly && (
        <div className="slide-blocks">
          <SectionLayout
            blocks={body.filter((b): b is NonNullable<typeof b> => Boolean(b))}
            layout={layout}
            renderBlock={(block, i) => (
              <div
                className={blockWrapperClass(staggerEnabled)}
                style={staggerStyle(i, staggerEnabled)}
              >
                <SlideBlockRenderer block={block} />
              </div>
            )}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Cycle to the next theme in {light → dark → bright → light}. Pure helper so
 * the unit test can lock the order down.
 */
export function cycleTheme(theme: SlideTheme): SlideTheme {
  return theme === 'light' ? 'dark' : theme === 'dark' ? 'bright' : 'light'
}

/**
 * Cycle to the next transition in {none → fade → slide-left → none}.
 */
export function cycleTransition(t: SlideTransition): SlideTransition {
  return t === 'none' ? 'fade' : t === 'fade' ? 'slide-left' : 'none'
}

interface PresentationToolbarProps {
  theme: SlideTheme
  transition: SlideTransition
  stagger: boolean
  onCycleTheme: () => void
  onCycleTransition: () => void
  onToggleStagger: () => void
}

function PresentationToolbar({
  theme,
  transition,
  stagger,
  onCycleTheme,
  onCycleTransition,
  onToggleStagger,
}: PresentationToolbarProps) {
  return (
    <div className="pres-toolbar" role="toolbar" aria-label="발표 모드 설정">
      <button
        type="button"
        onClick={onCycleTheme}
        title="테마 전환 (light/dark/bright)"
        aria-label={`테마: ${theme}`}
      >
        {`🎨 테마: ${theme}`}
      </button>
      <button
        type="button"
        onClick={onCycleTransition}
        title="슬라이드 전환 효과"
        aria-label={`전환 효과: ${transition}`}
      >
        {`✨ 전환: ${transition}`}
      </button>
      <button
        type="button"
        onClick={onToggleStagger}
        aria-pressed={stagger}
        title="블록 단계별 등장"
        aria-label={`단계별 등장: ${stagger ? 'on' : 'off'}`}
      >
        {`📋 등장: ${stagger ? 'on' : 'off'}`}
      </button>
    </div>
  )
}

/**
 * Heuristic: a slide is "dense" (and should auto-shrink its body) if its
 * body has more than 3 paragraph-equivalent blocks OR contains a chart/table.
 * Cheap structural check — no DOM measurement needed for the vast majority
 * of decks.
 */
function shouldAutoShrink(slide: Slide): boolean {
  if (slide.kind !== 'section') return false
  const blocks = Array.isArray(slide.section?.blocks) ? slide.section.blocks : []
  const { body } = splitSpeakerNotes(blocks)
  let weight = 0
  for (const b of body) {
    if (!b) continue
    if (b.type === 'paragraph') {
      // A long paragraph counts as ~2 paragraph-equivalents (rough heuristic).
      const text = (b as { text?: string }).text ?? ''
      weight += text.length > 240 ? 2 : 1
    } else if (b.type === 'table' || b.type === 'chart') {
      // Heavy blocks always trigger shrink so they fit within the slide.
      return true
    } else {
      weight += 1
    }
  }
  return weight > 3
}

interface ThumbnailStripProps {
  slides: Slide[]
  activeIndex: number
  onPick: (index: number) => void
}

function SlideThumbnailStrip({ slides, activeIndex, onPick }: ThumbnailStripProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  // Auto-scroll active thumbnail into view whenever index changes.
  useEffect(() => {
    const root = stripRef.current
    if (!root) return
    const active = root.querySelector<HTMLButtonElement>(
      `[data-thumb-index="${activeIndex}"]`,
    )
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [activeIndex])

  return (
    <div
      ref={stripRef}
      className="slide-strip"
      role="tablist"
      aria-label="슬라이드 썸네일"
    >
      {slides.map((s, i) => {
        const title = s.kind === 'title' ? s.title : s.title
        const num = s.kind === 'section' ? s.number : ''
        return (
          <button
            key={s.key ?? i}
            type="button"
            data-thumb-index={i}
            role="tab"
            aria-selected={i === activeIndex}
            className={`slide-thumb${i === activeIndex ? ' slide-thumb-active' : ''}`}
            onClick={() => onPick(i)}
          >
            <span className="slide-thumb-num">{num || `#${i + 1}`}</span>
            <span className="slide-thumb-title" title={title}>
              {title || '(제목 없음)'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const PRESENTATION_CSS = `
.presentation-root {
  position: fixed; inset: 0; background: var(--mx-stage-bg, #050817);
  color: var(--mx-stage-fg, #f8fafc);
  display: grid; grid-template-rows: 1fr auto; overflow: hidden;
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI',
               'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
}
@media (prefers-color-scheme: light) {
  .presentation-root { --mx-stage-bg: #ffffff; --mx-stage-fg: #0f172a; }
}
.slide {
  display: grid; place-items: center; padding: 56px 80px;
  overflow: auto; animation: slideFade 200ms ease-out;
  position: relative;
}
.slide-dense .slide-blocks { font-size: clamp(14px, 1.05vw, 18px); }
@keyframes slideFade { from { opacity: .25; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .slide { animation: none; }
}
.slide-body { width: 100%; max-width: 1200px; margin: auto; }
.slide-title { text-align: center; }
.slide-title h1 {
  font-size: clamp(40px, 6vw, 80px); font-weight: 700;
  margin: 0 0 16px; line-height: 1.1;
  background: linear-gradient(135deg, #6f87d6, #1428a0);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.slide-summary { font-size: clamp(18px, 1.6vw, 24px); color: #cbd5e1; margin: 0 auto 24px; max-width: 900px; }
.slide-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; color: #94a3b8; font-size: 14px; }
.slide-meta .badge {
  padding: 2px 8px; border-radius: 999px; background: rgba(99, 130, 255, 0.18);
  color: #a5b4fc;
}
.slide-meta .tag { color: #94a3b8; }
.slide-section .slide-heading { display: flex; align-items: baseline; gap: 16px; margin-bottom: 24px; }
.slide-section .slide-heading .num {
  font-family: 'JetBrains Mono', monospace; color: #6f87d6; font-size: 28px;
}
.slide-section .slide-heading h2 {
  font-size: clamp(36px, 4.5vw, 56px); margin: 0; line-height: 1.15; color: var(--mx-stage-fg, #f8fafc);
}
.slide-section .slide-blocks { font-size: clamp(18px, 1.4vw, 22px); line-height: 1.6; color: #e2e8f0; }
.slide-section .slide-blocks h5 { font-size: 22px; color: #cbd5e1; margin-top: 24px; }
.slide-section .prose-slide { margin: 12px 0; }
.slide-section .prose-slide p { margin: 0 0 12px; }
.slide-section .prose-slide ul,
.slide-section .prose-slide ol { padding-left: 28px; margin: 0 0 12px; }
.slide-section .prose-slide li { margin: 4px 0; }
.slide-section .prose-slide table { font-size: 16px; }
.slide-section .prose-slide img { max-height: 60vh; width: auto; max-width: 100%; }
.slide-watermark {
  position: absolute; right: 16px; bottom: 16px; font-size: 11px;
  color: rgba(148, 163, 184, 0.6); font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.04em; pointer-events: none;
}
.slide-blank { position: fixed; inset: 0; z-index: 60; cursor: pointer; }
.slide-blank-black { background: #000; }
.slide-blank-white { background: #fff; }
.slide-notes {
  position: fixed; right: 16px; top: 16px; width: min(420px, 32vw);
  max-height: 60vh; overflow: auto;
  background: rgba(15, 23, 42, 0.96); color: #e2e8f0;
  border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  padding: 12px 16px; z-index: 40; backdrop-filter: blur(8px);
}
.slide-notes h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
.slide-notes-body p { margin: 0 0 8px; font-size: 14px; line-height: 1.6; }
.slide-notes-empty { color: #64748b; font-style: italic; }
.slide-strip {
  position: fixed; left: 0; right: 0; bottom: 56px;
  display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden;
  padding: 8px 12px; background: rgba(5, 8, 23, 0.85);
  border-top: 1px solid rgba(255,255,255,0.06); z-index: 30;
  scroll-snap-type: x proximity;
}
.slide-thumb {
  flex: 0 0 auto; min-width: 140px; max-width: 200px;
  background: rgba(255,255,255,0.04); color: #cbd5e1;
  border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
  padding: 6px 10px; cursor: pointer;
  display: grid; grid-template-rows: auto 1fr; gap: 2px;
  text-align: left; scroll-snap-align: center;
}
.slide-thumb:hover { background: rgba(255,255,255,0.1); }
.slide-thumb-active {
  background: rgba(99, 130, 255, 0.18); border-color: #6f87d6; color: #f8fafc;
}
.slide-thumb-num { font-size: 10px; color: #6f87d6; font-family: 'JetBrains Mono', monospace; }
.slide-thumb-title {
  font-size: 12px; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; text-overflow: ellipsis;
}
.slide-chrome {
  display: grid; grid-template-rows: auto auto; gap: 6px; padding: 12px 24px 16px;
  background: rgba(5, 8, 23, 0.85); backdrop-filter: blur(8px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.slide-progress { height: 3px; background: rgba(255,255,255,0.08); border-radius: 999px; }
.slide-progress-bar { height: 100%; background: linear-gradient(90deg, #1428a0, #6f87d6);
  border-radius: 999px; transition: width 200ms ease-out; }
.slide-counter { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 13px; flex-wrap: wrap; }
.slide-counter button {
  background: rgba(255,255,255,0.06); color: var(--mx-stage-fg, #f8fafc);
  border: 1px solid rgba(255,255,255,0.1);
  padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
.slide-counter button:disabled { opacity: 0.35; cursor: not-allowed; }
.slide-counter button:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
.slide-counter .counter { font-variant-numeric: tabular-nums; color: #cbd5e1; }
.slide-counter .sep { color: #475569; }
.slide-help {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: grid; place-items: center; z-index: 50;
}
.slide-help-card {
  background: #0f172a; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  padding: 24px; max-width: 460px; color: #f8fafc;
}
.slide-help-card h2 { margin: 0 0 12px; font-size: 18px; }
.slide-help-card ul { margin: 0; padding: 0; list-style: none; font-size: 14px; line-height: 1.9; }
.slide-help-card kbd {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 4px; padding: 1px 6px; font-family: 'JetBrains Mono', monospace; font-size: 12px;
}
.slide-help-card button {
  margin-top: 16px; background: #1428a0; color: white; border: none;
  padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
@media print {
  .presentation-root { position: static; background: white; color: #0f172a; }
  .slide { page-break-after: always; padding: 24px; min-height: 100vh; }
  .slide-chrome, .slide-help, .slide-strip, .slide-notes, .slide-blank, .slide-watermark { display: none; }
  .slide-title h1 { color: #0a1657 !important; -webkit-text-fill-color: #0a1657; background: none; }
  .slide-section .slide-blocks { color: #0f172a; }
}
`
