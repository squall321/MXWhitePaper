import { useEffect, useMemo, useReducer, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useDocument } from '@/features/document/hooks/useDocument'
import {
  buildSlides,
  navigate as navReducer,
  speakerNotesFor,
  type Slide,
} from './slideMachine'
import { SlideBlockRenderer } from './SlideBlockRenderer'
import { openPresenterChannel } from './presenterChannel'
import { splitSpeakerNotes } from './slideMachine'

/**
 * PresenterView — the secondary popup window.
 *
 * Layout (CSS grid, two columns):
 *   ┌──────────────────┬─────────────────────┐
 *   │                  │  ⏱  현재 시각        │
 *   │  현재 슬라이드     │ ┌─────────────────┐ │
 *   │                  │ │ 다음 슬라이드     │ │
 *   │                  │ │ 미리보기          │ │
 *   │                  │ └─────────────────┘ │
 *   │                  │  발표자 메모         │
 *   └──────────────────┴─────────────────────┘
 *
 * Shares slide index with the main window via `openPresenterChannel()`. The
 * presenter window is read-only as far as document fetching is concerned —
 * it loads the same doc by slug and binds to slide index updates.
 *
 * Local key handling: ←/→/Space/PageUp/PageDown/Home/End rebroadcast to keep
 * both windows in sync (the audience window is the source of truth, but the
 * presenter can also drive navigation without alt-tabbing).
 */
export function PresenterViewPage() {
  const { slug } = useParams<{ slug: string }>()
  const [params] = useSearchParams()
  const nested = params.get('nested') === '1'
  const { data, isPending, isError } = useDocument(slug)

  const slides = useMemo<Slide[]>(() => {
    if (!data?.document) return []
    try {
      return buildSlides(data.document, { nested })
    } catch {
      return []
    }
  }, [data, nested])

  const [index, dispatch] = useReducer(
    (state: number, action: Parameters<typeof navReducer>[2]) =>
      navReducer(state, slides.length, action),
    0,
  )
  const total = slides.length

  // Channel sync: receive index updates from the main window, send our own
  // navigation events so both stay aligned.
  useEffect(() => {
    const channel = openPresenterChannel()
    const unsub = channel.subscribe((msg) => {
      if (msg.total !== total && total > 0) {
        // Total mismatch usually means doc not yet loaded on one side; clamp.
      }
      dispatch({ type: 'goto', index: msg.index })
    })
    return () => {
      unsub()
      channel.close()
    }
  }, [total])

  // Broadcast our own index changes (so the main window follows).
  useEffect(() => {
    if (total === 0) return
    const channel = openPresenterChannel()
    channel.post({ index, total, ts: Date.now() })
    channel.close()
  }, [index, total])

  // Local key handling.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      switch (ev.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
          ev.preventDefault()
          dispatch({ type: 'next' })
          return
        case 'ArrowLeft':
        case 'PageUp':
          ev.preventDefault()
          dispatch({ type: 'prev' })
          return
        case 'Home':
          ev.preventDefault()
          dispatch({ type: 'first' })
          return
        case 'End':
          ev.preventDefault()
          dispatch({ type: 'last' })
          return
        case 'Escape':
          ev.preventDefault()
          window.close()
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Live clock — updates once a second.
  const [now, setNow] = useState<Date>(new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  if (!slug) return <PresenterError msg="슬러그가 없습니다" />
  if (isPending) return <PresenterStatus msg="불러오는 중…" />
  if (isError || !data) return <PresenterError msg="문서를 불러오지 못했습니다" />
  if (total === 0) return <PresenterStatus msg="슬라이드가 없습니다" />

  const current = slides[index] ?? slides[0]!
  const next = index + 1 < total ? slides[index + 1] : null
  const notes = speakerNotesFor(current)

  return (
    <div className="presenter-root" data-testid="presenter-root">
      <style>{PRESENTER_CSS}</style>
      <section className="pv-current" aria-label="현재 슬라이드">
        <div className="pv-current-inner">
          <SlideMini slide={current} />
        </div>
        <footer className="pv-current-footer">
          {index + 1} / {total}
        </footer>
      </section>
      <aside className="pv-side">
        <div className="pv-clock" aria-label="현재 시각">
          <span className="pv-clock-time">{formatClock(now)}</span>
        </div>
        <div className="pv-next">
          <h3>다음 슬라이드 미리보기</h3>
          <div className="pv-next-card">
            {next ? <SlideMini slide={next} compact /> : <p className="pv-empty">(끝)</p>}
          </div>
        </div>
        <div className="pv-notes">
          <h3>발표자 메모</h3>
          <div className="pv-notes-body" data-testid="presenter-notes">
            {notes ? (
              notes.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p className="pv-empty">메모 없음</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SlideMini({ slide, compact = false }: { slide: Slide; compact?: boolean }) {
  if (slide.kind === 'title') {
    return (
      <div className={`pv-slide-mini${compact ? ' pv-slide-mini-compact' : ''}`}>
        <h1>{slide.title || '(제목 없음)'}</h1>
        {slide.summary && <p className="pv-summary">{slide.summary}</p>}
      </div>
    )
  }
  const allBlocks = Array.isArray(slide.section?.blocks) ? slide.section.blocks : []
  const { body } = splitSpeakerNotes(allBlocks)
  // In the compact (next-slide) preview, only show first 3 blocks to keep it
  // glanceable.
  const blocks = compact ? body.slice(0, 3) : body
  return (
    <div className={`pv-slide-mini${compact ? ' pv-slide-mini-compact' : ''}`}>
      <header>
        {slide.number && <span className="pv-num">{slide.number}</span>}
        <h2>{slide.title || '(제목 없음)'}</h2>
      </header>
      <div className="pv-blocks">
        {blocks.map((b) => (
          <SlideBlockRenderer key={b.id ?? Math.random().toString(36)} block={b} />
        ))}
      </div>
    </div>
  )
}

function PresenterStatus({ msg }: { msg: string }) {
  return (
    <div style={{ padding: 24, color: '#cbd5e1', background: '#050817', minHeight: '100vh' }}>
      {msg}
    </div>
  )
}
function PresenterError({ msg }: { msg: string }) {
  return (
    <div style={{ padding: 24, color: '#fca5a5', background: '#050817', minHeight: '100vh' }}>
      {msg}
    </div>
  )
}

function formatClock(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

const PRESENTER_CSS = `
.presenter-root {
  position: fixed; inset: 0; background: #050817; color: #f8fafc;
  display: grid; grid-template-columns: 2fr 1fr; gap: 12px; padding: 12px;
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.pv-current {
  display: grid; grid-template-rows: 1fr auto; gap: 8px; min-height: 0;
  background: #0f172a; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 16px; overflow: hidden;
}
.pv-current-inner { overflow: auto; min-height: 0; }
.pv-current-footer {
  text-align: right; font-variant-numeric: tabular-nums; color: #94a3b8; font-size: 13px;
}
.pv-side {
  display: grid; grid-template-rows: auto auto 1fr; gap: 12px; min-height: 0;
}
.pv-clock {
  background: #0f172a; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 12px 16px; text-align: center;
}
.pv-clock-time { font-size: 36px; font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', monospace; color: #a5b4fc; }
.pv-next, .pv-notes {
  background: #0f172a; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 12px 16px; min-height: 0;
  display: grid; grid-template-rows: auto 1fr; gap: 8px;
}
.pv-next h3, .pv-notes h3 { margin: 0; font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
.pv-next-card { overflow: auto; }
.pv-notes-body { overflow: auto; font-size: 14px; line-height: 1.6; color: #e2e8f0; }
.pv-notes-body p { margin: 0 0 8px; }
.pv-empty { color: #64748b; font-style: italic; }
.pv-slide-mini { color: #f8fafc; }
.pv-slide-mini h1 { font-size: 28px; margin: 0 0 6px; }
.pv-slide-mini h2 { font-size: 20px; margin: 0; }
.pv-slide-mini header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.pv-num { color: #6f87d6; font-family: 'JetBrains Mono', monospace; font-size: 14px; }
.pv-summary { color: #cbd5e1; }
.pv-blocks { font-size: 14px; line-height: 1.5; color: #cbd5e1; }
.pv-slide-mini-compact h2 { font-size: 16px; }
.pv-slide-mini-compact .pv-blocks { font-size: 12px; }
`
