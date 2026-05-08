import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useDocument } from '@/features/document/hooks/useDocument'
import {
  buildSlides,
  keyToNav,
  navigate as navReducer,
  type Slide,
} from '@/features/presentation/slideMachine'
import { SlideBlockRenderer } from '@/features/presentation/SlideBlockRenderer'

/**
 * Presentation mode — one section per slide, keyboard-driven.
 *
 * Routes
 * ------
 *   /present/:slug              → flat (title + level-1 sections only)
 *   /present/:slug?nested=1     → also one slide per level-2 subsection
 *
 * Keyboard
 * --------
 *   →, Space, n, PageDown   next
 *   ←, p, PageUp            prev
 *   Home / End              first / last
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

  const slides = useMemo<Slide[]>(
    () => (data ? buildSlides(data.document, { nested }) : []),
    [data, nested],
  )

  const [index, dispatch] = useReducer(
    (state: number, action: Parameters<typeof navReducer>[2]) =>
      navReducer(state, slides.length, action),
    0,
  )
  const [helpOpen, setHelpOpen] = useState(false)

  const exit = useCallback(() => {
    if (slug) navigate(`/docs/${slug}`)
    else navigate('/')
  }, [navigate, slug])

  // Keyboard handler — global, ignores modifier-only events.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        exit()
        return
      }
      if (ev.key === '?') {
        ev.preventDefault()
        setHelpOpen((v) => !v)
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
  }, [exit])

  if (!slug) return <p style={{ color: 'white', padding: 24 }}>missing slug</p>
  if (isPending)
    return <p style={{ color: 'white', padding: 24 }}>불러오는 중…</p>
  if (isError || !data)
    return (
      <p style={{ color: 'white', padding: 24 }}>
        문서를 불러오지 못했습니다.
      </p>
    )

  const total = slides.length
  // `index` is reducer-clamped, but TS sees `slides[number]` as possibly
  // undefined under noUncheckedIndexedAccess. Guard explicitly.
  const slide = slides[index] ?? slides[0]
  if (!slide) {
    return (
      <p style={{ color: 'white', padding: 24 }}>
        렌더할 슬라이드가 없습니다.
      </p>
    )
  }
  const progress = total > 1 ? ((index + 1) / total) * 100 : 100

  return (
    <div className="presentation-root">
      <style>{PRESENTATION_CSS}</style>
      <article className="slide" data-kind={slide.kind} aria-live="polite">
        <SlideContent slide={slide} />
      </article>

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
              <li><kbd>→</kbd> / <kbd>Space</kbd> / <kbd>n</kbd> — 다음</li>
              <li><kbd>←</kbd> / <kbd>p</kbd> — 이전</li>
              <li><kbd>Home</kbd> — 처음</li>
              <li><kbd>End</kbd> — 끝</li>
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

function SlideContent({ slide }: { slide: Slide }) {
  if (slide.kind === 'title') {
    return (
      <div className="slide-body slide-title">
        <h1>{slide.title}</h1>
        {slide.summary && <p className="slide-summary">{slide.summary}</p>}
        <div className="slide-meta">
          {slide.meta.path && <span>{slide.meta.path}</span>}
          {slide.meta.confidentiality && (
            <span className="badge">{slide.meta.confidentiality}</span>
          )}
          {slide.meta.tags.slice(0, 5).map((t) => (
            <span key={t} className="tag">#{t}</span>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="slide-body slide-section">
      <header className="slide-heading">
        {slide.number && <span className="num">{slide.number}</span>}
        <h2>{slide.title}</h2>
      </header>
      <div className="slide-blocks">
        {slide.section.blocks.map((block) => (
          <SlideBlockRenderer key={block.id} block={block} />
        ))}
      </div>
    </div>
  )
}

const PRESENTATION_CSS = `
.presentation-root {
  position: fixed; inset: 0; background: #050817; color: #f8fafc;
  display: grid; grid-template-rows: 1fr auto; overflow: hidden;
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI',
               'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
}
.slide {
  display: grid; place-items: center; padding: 56px 80px;
  overflow: auto; animation: slideFade 200ms ease-out;
}
@keyframes slideFade { from { opacity: .25; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .slide { animation: none; }
}
.slide-body { width: 100%; max-width: 1200px; }
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
  font-size: clamp(36px, 4.5vw, 56px); margin: 0; line-height: 1.15; color: #f8fafc;
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
.slide-chrome {
  display: grid; grid-template-rows: auto auto; gap: 6px; padding: 12px 24px 16px;
  background: rgba(5, 8, 23, 0.85); backdrop-filter: blur(8px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.slide-progress { height: 3px; background: rgba(255,255,255,0.08); border-radius: 999px; }
.slide-progress-bar { height: 100%; background: linear-gradient(90deg, #1428a0, #6f87d6);
  border-radius: 999px; transition: width 200ms ease-out; }
.slide-counter { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 13px; }
.slide-counter button {
  background: rgba(255,255,255,0.06); color: #f8fafc; border: 1px solid rgba(255,255,255,0.1);
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
  padding: 24px; max-width: 420px; color: #f8fafc;
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
  .slide-chrome, .slide-help { display: none; }
  .slide-title h1 { color: #0a1657 !important; -webkit-text-fill-color: #0a1657; background: none; }
  .slide-section .slide-blocks { color: #0f172a; }
}
`
