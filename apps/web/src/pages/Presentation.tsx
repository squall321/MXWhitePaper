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
import { filterForAudience } from '@/components/blocks/audienceFilter'
import type { SectionLevel2, SectionLevel3 } from '@/types/document'
import { openPresenterChannel } from '@/features/presentation/presenterChannel'
import {
  TRANSITIONS_CSS,
  blockWrapperClass,
  staggerStyle,
  themeAttrs,
} from '@/features/presentation/transitions.css'
import { resolveLayout, type AutoLayoutKind } from '@/features/presentation/autoLayout'
import { patchSection } from '@/features/editor/api'
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
  // presentation-auto-layout 사이클: 사용자가 section.layout 명시 안 했을 때
  // chunk 분석으로 자동 추천 (image-right / two-col 등). 기본 true.
  const [autoLayoutEnabled, setAutoLayoutEnabled] = useState(true)
  // 사용자가 발표 모드에서 즉시 layout 조정 — slide.key → override map.
  // 세션 안에서만 유효 (저장 X, 다음 발표는 default).
  const [layoutOverrides, setLayoutOverrides] = useState<Record<string, AutoLayoutKind>>({})
  // S1: 저장 진행 상태 (slide.key → 'saving'|'saved'|'error') — 토스트 대신
  // toolbar 버튼 label 이 일시적으로 변화.
  const [saveStatus, setSaveStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  // S3 발표 중 블록 hide — 세션 한정 (창 닫으면 사라짐). Set<block.id>.
  // SlideContent 의 cleanBody 가 이 set 으로 추가 필터.
  const [hiddenBlockIds, setHiddenBlockIds] = useState<Set<string>>(() => new Set())
  const [blockPanelOpen, setBlockPanelOpen] = useState(false)

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
          <SlideContent
            slide={slide}
            staggerEnabled={slideStagger}
            autoLayoutEnabled={autoLayoutEnabled}
            layoutOverride={layoutOverrides[slide.key]}
            hiddenBlockIds={hiddenBlockIds}
          />
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
        autoLayoutEnabled={autoLayoutEnabled}
        currentLayout={
          layoutOverrides[slide.key] ??
          (slide.kind === 'section'
            ? (resolveLayout(slide.section, slide.bodyBlocks ?? slide.section?.blocks ?? [], autoLayoutEnabled))
            : 'stack')
        }
        canChangeLayout={slide.kind === 'section'}
        canSaveLayout={
          slide.kind === 'section' &&
          !!slide.section?.id &&
          slide.key in layoutOverrides
        }
        saveStatus={saveStatus[slide.key]}
        onCycleTheme={() => setSetting('slide_theme', cycleTheme(slideTheme))}
        onCycleTransition={() =>
          setSetting('slide_transition', cycleTransition(slideTransition))
        }
        onToggleStagger={() => setSetting('slide_stagger', !slideStagger)}
        onToggleAutoLayout={() => setAutoLayoutEnabled((v) => !v)}
        onChangeLayoutOverride={(next) => {
          setLayoutOverrides((prev) => {
            if (next === '__clear__') {
              const { [slide.key]: _omit, ...rest } = prev
              return rest
            }
            return { ...prev, [slide.key]: next as AutoLayoutKind }
          })
        }}
        hiddenCount={
          slide.kind === 'section'
            ? (slide.bodyBlocks ?? slide.section?.blocks ?? []).filter(
                (b) => b && hiddenBlockIds.has(b.id),
              ).length
            : 0
        }
        onToggleBlockPanel={() => setBlockPanelOpen((v) => !v)}
        onSaveLayout={async () => {
          if (slide.kind !== 'section') return
          const sectionId = slide.section?.id
          const etag = data?.meta?.etag
          const override = layoutOverrides[slide.key]
          if (!slug || !sectionId || !etag || !override) return
          setSaveStatus((p) => ({ ...p, [slide.key]: 'saving' }))
          try {
            await patchSection(slug, sectionId, { layout: override }, etag, 'slide layout 저장 (발표 모드)')
            setSaveStatus((p) => ({ ...p, [slide.key]: 'saved' }))
            // 2초 후 status 클리어
            window.setTimeout(() => {
              setSaveStatus((p) => {
                const { [slide.key]: _omit, ...rest } = p
                return rest
              })
            }, 2000)
          } catch (err) {
            console.warn('[Presentation] save layout failed', err)
            setSaveStatus((p) => ({ ...p, [slide.key]: 'error' }))
          }
        }}
      />

      {blockPanelOpen && slide.kind === 'section' && (
        <SlideBlockPanel
          blocks={(slide.bodyBlocks ?? slide.section?.blocks ?? []).filter(
            (b): b is NonNullable<typeof b> => Boolean(b),
          )}
          hiddenBlockIds={hiddenBlockIds}
          onToggle={(id) => {
            setHiddenBlockIds((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }}
          onClose={() => setBlockPanelOpen(false)}
        />
      )}

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
  autoLayoutEnabled,
  layoutOverride,
  hiddenBlockIds,
}: {
  slide: Slide
  staggerEnabled: boolean
  /** 사용자가 section.layout 명시 안 했을 때 chunk 분석으로 자동 추천 layout
   * 적용. 기본 true — 슬라이드는 평범한 stack 보다 자동 추천이 거의 항상
   * 좋음. 사용자가 chapter-divider toggle 같은 *완전 평범* 원하면 끌 수 있음. */
  autoLayoutEnabled: boolean
  /** Toolbar 의 layout override — 사용자가 즉시 조정. undefined 면 auto
   * resolve. SectionLayoutKind 와 동일 enum. */
  layoutOverride?: AutoLayoutKind
  /** S3 발표 중 hide 토글된 block.id 집합. cleanBody 가 추가 필터. */
  hiddenBlockIds?: Set<string>
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
  // 자동 분할 (buildSlides 의 autoSplit) 결과로 이 슬라이드가 부분 body 만 받은
  // 경우 — bodyBlocks 가 우선. 그러면 subsections walk 도 skip (전체 슬라이드
  // 흐름은 buildSlides 단계에서 이미 펼쳐졌으므로 여기서 다시 펼치면 중복).
  const usingSplit = Array.isArray(slide.bodyBlocks)
  const effectiveBody = usingSplit ? (slide.bodyBlocks as typeof body) : body

  // Layout 결정 우선순위:
  //   1. toolbar override (사용자 즉시 조정 — 가장 강력)
  //   2. section.layout 명시 (사용자가 문서 작성 때 지정)
  //   3. autoLayoutEnabled 면 chunk 분석 자동 추천
  //   4. stack default
  // `title-only` 는 chapter divider 같은 표지 — 본문 hide.
  // 추가 — S3: 발표 중 hide 토글된 블록 제거.
  const cleanBodyForLayout = filterForAudience(
    effectiveBody.filter((b): b is NonNullable<typeof b> => Boolean(b)),
    'slide',
  ).filter((b) => !hiddenBlockIds?.has(b.id))
  const layout: AutoLayoutKind = layoutOverride
    ?? resolveLayout(slide.section, cleanBodyForLayout, autoLayoutEnabled)
  const isTitleOnly = layout === 'title-only'

  // Walk subsections so nested content isn't silently dropped on the
  // slide. Without this, a level-1 slide rendering a section that has
  // level-2 / level-3 subsections shows ONLY its direct blocks, and the
  // user's writing inside subsections vanishes from the deck. We render
  // each subsection as an inline mini-section (h3 + body + recurse).
  const subsections = usingSplit
    ? []
    : (Array.isArray(slide.section?.subsections) ? slide.section.subsections : [])
  // Honor per-block `meta.audience` — already computed for layout above.
  const cleanBody = cleanBodyForLayout

  // 자동 분할된 continuation 슬라이드면 헤딩 옆 작은 chip 으로 N/M 표시.
  // (제목 글자에 섞으면 청자 인지 부담 — chip 으로 분리)
  const isContinuation =
    usingSplit && (slide.continuation ?? 0) > 0 && !!slide.totalContinuations
  const contChipText = isContinuation
    ? `${(slide.continuation ?? 0) + 1}/${slide.totalContinuations}`
    : ''

  // L4 chapter-hero: level-1 section 의 *첫* 슬라이드 (continuation 아님) 은
  // 거대한 챕터 번호 배경 + gradient 강조 헤더. 청자가 챕터 전환을 즉시 인지.
  // continuation 슬라이드와 subsection level-2 슬라이드는 평범 헤더 유지.
  const isChapterHero = !isContinuation && slide.level === 1

  return (
    <div className={`slide-body slide-section${isChapterHero ? ' slide-chapter-hero' : ''}`}>
      <header className="slide-heading">
        {isChapterHero && slide.number && (
          <span className="chapter-bignum" aria-hidden="true">{slide.number}</span>
        )}
        {slide.number && <span className="num">{slide.number}</span>}
        <h2>{slide.title || '(제목 없음)'}</h2>
        {isContinuation && (
          <span className="slide-cont-chip" aria-label={`계속 ${contChipText}`}>
            {contChipText}
          </span>
        )}
      </header>
      {!isTitleOnly && (
        <div className="slide-blocks">
          <SectionLayout
            blocks={cleanBody}
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
          {subsections.map((sub) => (
            <SubsectionInline
              key={sub.id}
              section={sub}
              staggerEnabled={staggerEnabled}
              autoLayoutEnabled={autoLayoutEnabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Renders a subsection inline within its parent slide: small heading +
 * body blocks + recursive descent into deeper subsections. Used so the
 * default (non-`?nested=1`) slide deck preserves all of the document's
 * content, not just direct level-1 blocks.
 *
 * Heading levels:
 *   level 2 → h3
 *   level 3+ → h4 (capped — slides shouldn't get tinier-than-h4 text)
 */
function SubsectionInline({
  section,
  staggerEnabled,
  autoLayoutEnabled,
}: {
  section: SectionLevel2 | SectionLevel3
  staggerEnabled: boolean
  autoLayoutEnabled: boolean
}) {
  const allBlocks = Array.isArray(section?.blocks) ? section.blocks : []
  const { body } = splitSpeakerNotes(allBlocks)
  const cleanBody = filterForAudience(
    body.filter((b): b is NonNullable<typeof b> => Boolean(b)),
    'slide',
  )
  const subs = Array.isArray((section as { subsections?: unknown[] }).subsections)
    ? ((section as { subsections: unknown[] }).subsections as (SectionLevel2 | SectionLevel3)[])
    : []
  // presentation-layout follow-up: heading-only subsection (body=0, child=0)
  // 은 빈 슬라이드 만들지 않음.
  if (cleanBody.length === 0 && subs.length === 0) return null
  // presentation-auto-layout: subsection 도 동일 정책 — section.layout 명시 우선,
  // 없으면 auto 추천.
  const layout = resolveLayout(section, cleanBody, autoLayoutEnabled)
  const number = section.number ?? ''
  const title = section.title ?? ''
  const Heading = section.level === 2 ? 'h3' : 'h4'
  return (
    <section className="slide-subsection">
      <Heading className="slide-subheading">
        {number && <span className="num-sub">{number}</span>}
        {title}
      </Heading>
      {cleanBody.length > 0 && (
        <SectionLayout
          blocks={cleanBody}
          layout={layout as never}
          renderBlock={(block, i) => (
            <div
              className={blockWrapperClass(staggerEnabled)}
              style={staggerStyle(i, staggerEnabled)}
            >
              <SlideBlockRenderer block={block} />
            </div>
          )}
        />
      )}
      {subs.map((s) => (
        <SubsectionInline
          key={s.id}
          section={s}
          staggerEnabled={staggerEnabled}
          autoLayoutEnabled={autoLayoutEnabled}
        />
      ))}
    </section>
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
  autoLayoutEnabled: boolean
  currentLayout: AutoLayoutKind
  canChangeLayout: boolean
  /** S1: override 가 세팅됐고 section.id 가 있으면 저장 가능. */
  canSaveLayout: boolean
  saveStatus?: 'saving' | 'saved' | 'error'
  /** S3: 현 슬라이드에서 hide 된 블록 수 (badge 표시). */
  hiddenCount: number
  onCycleTheme: () => void
  onCycleTransition: () => void
  onToggleStagger: () => void
  onToggleAutoLayout: () => void
  /** 'stack'|'two-col'|... 또는 '__clear__' 로 override 제거. */
  onChangeLayoutOverride: (next: string) => void
  /** S1: 현재 override 를 문서의 section.layout 으로 영구 저장. */
  onSaveLayout: () => void
  /** S3: 블록 표시/숨김 패널 토글. */
  onToggleBlockPanel: () => void
}

function PresentationToolbar({
  theme,
  transition,
  stagger,
  autoLayoutEnabled,
  currentLayout,
  canChangeLayout,
  canSaveLayout,
  saveStatus,
  hiddenCount,
  onChangeLayoutOverride,
  onToggleAutoLayout,
  onSaveLayout,
  onToggleBlockPanel,
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
      <button
        type="button"
        onClick={onToggleAutoLayout}
        aria-pressed={autoLayoutEnabled}
        title="자동 배치 (auto-layout) — 콘텐츠 분석해 2단/이미지좌우 등 자동 선택"
        aria-label={`auto-layout: ${autoLayoutEnabled ? 'on' : 'off'}`}
      >
        {`🪄 자동: ${autoLayoutEnabled ? 'on' : 'off'}`}
      </button>
      <select
        title="현재 슬라이드 배치 강제 변경 (세션 한정)"
        aria-label="현재 슬라이드 배치"
        value={currentLayout}
        disabled={!canChangeLayout}
        onChange={(e) => onChangeLayoutOverride(e.target.value)}
        className="pres-toolbar-select"
        data-pres-layout-select
      >
        <option value="__clear__">↺ 자동 (override 해제)</option>
        <option value="stack">☰ 기본 (세로)</option>
        <option value="two-col">⫴ 2단</option>
        <option value="image-left">⬛︎▤ 이미지 좌</option>
        <option value="image-right">▤⬛︎ 이미지 우</option>
        <option value="full-bleed">◳ 풀블리드</option>
      </select>
      <button
        type="button"
        onClick={onSaveLayout}
        disabled={!canSaveLayout || saveStatus === 'saving'}
        title="현재 슬라이드 layout 을 문서에 영구 저장 (section.layout)"
        aria-label="배치 저장"
        data-pres-save-layout
      >
        {saveStatus === 'saving'
          ? '💾 저장 중…'
          : saveStatus === 'saved'
            ? '✅ 저장됨'
            : saveStatus === 'error'
              ? '⚠️ 실패'
              : '💾 저장'}
      </button>
      <button
        type="button"
        onClick={onToggleBlockPanel}
        title="현재 슬라이드 블록 표시/숨김 패널 열기 (세션 한정)"
        aria-label={`블록 표시/숨김 ${hiddenCount > 0 ? `(${hiddenCount} 숨김)` : ''}`}
        data-pres-block-panel-toggle
      >
        {hiddenCount > 0 ? `🙈 블록 (${hiddenCount})` : '🙈 블록'}
      </button>
    </div>
  )
}

/**
 * S3: 발표 중 현재 슬라이드 블록을 표시/숨김 토글하는 floating panel.
 * 세션 한정 (hiddenBlockIds 는 PresentationPage state). 문서에 저장 안 함 —
 * 발표자가 즉석에서 "이 callout 은 다음 슬라이드에서 보여줄게" 같이 hide 하고
 * 발표 끝나면 자동 복귀.
 */
function SlideBlockPanel({
  blocks,
  hiddenBlockIds,
  onToggle,
  onClose,
}: {
  blocks: Array<{ id: string; type: string }>
  hiddenBlockIds: Set<string>
  onToggle: (id: string) => void
  onClose: () => void
}) {
  return (
    <aside
      className="slide-block-panel"
      role="dialog"
      aria-label="블록 표시/숨김"
      data-pres-block-panel
    >
      <header className="slide-block-panel-head">
        <h3>슬라이드 블록 ({blocks.length})</h3>
        <button type="button" onClick={onClose} aria-label="패널 닫기">
          ✕
        </button>
      </header>
      <ul className="slide-block-panel-list">
        {blocks.map((b) => {
          const hidden = hiddenBlockIds.has(b.id)
          const label = blockShortLabel(b)
          return (
            <li key={b.id} className={hidden ? 'is-hidden' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={() => onToggle(b.id)}
                />
                <span className="slide-block-panel-type">{b.type}</span>
                <span className="slide-block-panel-label">{label}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <footer className="slide-block-panel-foot">
        세션 한정 — 발표 종료 시 자동 복귀
      </footer>
    </aside>
  )
}

/** Best-effort 짧은 라벨 — text/title/caption 우선. */
function blockShortLabel(b: { type: string }): string {
  const rec = b as unknown as Record<string, unknown>
  const pick = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const cand =
    pick(rec['text']) ??
    pick(rec['title']) ??
    pick(rec['caption']) ??
    pick(rec['src']) ??
    pick(rec['url']) ??
    ''
  const trimmed = cand.replace(/\s+/g, ' ').trim()
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed || '(no label)'
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
  /* A4: place-items: start center — 가로 가운데, 세로 위쪽 정렬. 짧은 콘텐츠가
     가운데 박혀 하단 빈 공간 만드는 거슬림 해소 (presentation-layout 사이클).
     단 .slide-title 만 가운데 정렬 유지 (override 아래). */
  display: grid; place-items: start center;
  /* M1 (presentation-mobile cycle): padding 56px 80px 가 mobile 375px 에서
     양쪽 160px 잠식 → 콘텐츠 잘림. viewport 비례 padding 으로 자동 축소.
     padding-top 은 toolbar (top: 12px + ~32px height) 와 콘텐츠 겹침 방지 위해
     min 60px 보장. */
  padding: max(60px, clamp(16px, 5vh, 56px)) clamp(16px, 5vw, 80px) clamp(16px, 5vh, 56px);
  overflow: auto; animation: slideFade 200ms ease-out;
  position: relative;
}
.slide-dense .slide-blocks { font-size: clamp(14px, 1.05vw, 18px); }
@keyframes slideFade { from { opacity: .25; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .slide { animation: none; }
}
/* A5: 1200 → 1440 (16:9 viewport 활용 ↑). 더 작은 화면은 vw 단위로 자연 축소. */
.slide-body { width: 100%; max-width: min(1440px, 92vw); margin: 0 auto; }
.slide-title { text-align: center; align-self: center; }
/* A4 override — title slide 컨테이너만 세로 가운데 (place-items center) 회복. */
.slide:has(.slide-title) { place-items: center; }
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
.slide-section .slide-heading { display: flex; align-items: baseline; gap: clamp(8px, 0.8vw, 16px); margin-bottom: 24px; position: relative; }

/* L4 chapter-hero: level-1 section 의 첫 슬라이드 임팩트 강화 (presentation-
   chapter-divider 사이클).
   - chapter-bignum: 슬라이드 좌상단 배경에 거대한 챕터 번호 (semi-transparent
     gradient). 헤더 글자 위에 깔리되 pointer-events 없음.
   - 헤더 글자는 그 위에 떠 있어 가독성 유지.
   - 본문은 헤더 아래 자연 흐름 — 슬라이드 갯수 늘리지 않음. */
.slide-chapter-hero .slide-heading {
  margin-bottom: 36px;
  padding: 24px 0 16px;
  border-bottom: 2px solid rgba(111, 135, 214, 0.25);
}
.slide-chapter-hero .slide-heading .chapter-bignum {
  position: absolute; left: -16px; top: -32px;
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(120px, 14vw, 220px);
  font-weight: 900;
  background: linear-gradient(135deg, rgba(111, 135, 214, 0.20), rgba(20, 40, 160, 0.08));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  line-height: 0.9;
  pointer-events: none;
  z-index: 0;
  letter-spacing: -0.04em;
}
[data-pres-theme="dark"] .slide-chapter-hero .slide-heading .chapter-bignum {
  background: linear-gradient(135deg, rgba(147, 165, 255, 0.28), rgba(111, 135, 214, 0.08));
  -webkit-background-clip: text; background-clip: text;
}
.slide-chapter-hero .slide-heading .num,
.slide-chapter-hero .slide-heading h2 {
  position: relative; z-index: 1;
}
.slide-chapter-hero .slide-heading h2 {
  font-size: clamp(44px, 5.2vw, 64px);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.slide-section .slide-heading .num {
  font-family: 'JetBrains Mono', monospace; color: #6f87d6;
  /* Scale alongside the h2 (clamp(36, 4.5vw, 56)) so the ratio stays
     readable across small / large screens. ~70% of heading size keeps
     the chapter number prominent without overpowering the title. */
  font-size: clamp(24px, 3.2vw, 40px);
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
/* A7: 시각 블록 (chart/gantt/whiteboard/org-chart/flow) 슬라이드 viewport 가득.
   read-mode 의 작은 h-72 같은 고정 높이로는 1080p 슬라이드를 활용 못 함. */
.slide-section .prose-slide img { max-height: 72vh; width: auto; max-width: 100%; }
.slide-section .prose-slide [data-block-type="chart"],
.slide-section .prose-slide [data-block-type="gantt"],
.slide-section .prose-slide [data-block-type="org-chart"],
.slide-section .prose-slide [data-block-type="whiteboard"],
.slide-section .prose-slide [data-block-type="flow"],
.slide-section .prose-slide [data-block-type="iframe"],
.slide-section .prose-slide [data-block-type="video"],
.slide-section .prose-slide [data-block-type="image-annotation"] { width: 100%; }
/* A3: iframe / video — read-mode 높이 360px 가 슬라이드에선 작아 빈 박스처럼.
   슬라이드에선 viewport 활용으로 확대 (콘텐츠가 외부 URL이라 진짜 로딩은
   외부 사이트 책임). */
.slide-section .prose-slide [data-block-type="iframe"] iframe,
.slide-section .prose-slide [data-block-type="video"] iframe,
.slide-section .prose-slide [data-block-type="video"] video {
  /* M2: mobile 에서 min-height 360 + 65vh 가 너무 큼 (433px = 화면 65%).
     viewport 더 작아지면 자연 축소. */
  height: clamp(220px, 65vh, 720px) !important; width: 100%;
}
.slide-section .prose-slide [data-block-type="chart"] figure,
.slide-section .prose-slide [data-block-type="chart"] > div,
.slide-section .prose-slide [data-block-type="gantt"] figure,
.slide-section .prose-slide [data-block-type="org-chart"] figure,
.slide-section .prose-slide [data-block-type="whiteboard"] figure,
.slide-section .prose-slide [data-block-type="flow"] > div {
  max-height: 72vh; height: auto; min-height: 360px;
}
.slide-section .prose-slide [data-block-type="chart"] .h-72 { height: 60vh; }

/* A2 chip: (계속 N/M) 작은 라벨 — 청자 인지 부담 ↓. */
.slide-cont-chip {
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(12px, 0.9vw, 14px);
  color: #6f87d6;
  background: rgba(99, 130, 255, 0.12);
  padding: 2px 8px; border-radius: 999px;
  align-self: center; margin-left: 8px;
}

/* A6: continuation 슬라이드에 부모 subsection 컨텍스트 — Plan에서 명시했으나
   현재 buildSlides가 section 단위로만 chunk라 subsection 컨텍스트는 inline
   subsection 의 책임. continuation은 *부모 section 자체*의 다음 chunk라
   subsection이 이미 SectionSlide.section 안에 있음. 따라서 별도 fix 불요 —
   audit에서 본 "subsection title 사라짐" 은 사실 nested=1 옵션 시 subsection
   자체가 별개 슬라이드라 발생. nested 옵션 사용자가 의도하면 그대로 유지. */

/* Inline-rendered subsection inside a parent slide.
   Heading (h3) sits ~70% of the parent h2 size; nested subsections (h4)
   step down again. .num-sub mirrors .num at the subheading scale so the
   dotted ordinal stays visually balanced. */
.slide-subsection { margin-top: 32px; }
.slide-subheading {
  display: flex; align-items: baseline; gap: 12px;
  font-size: clamp(22px, 2.4vw, 32px);
  line-height: 1.2;
  color: #cbd5e1;
  margin: 0 0 12px;
  border-left: 3px solid #6f87d6;
  padding-left: 12px;
}
.slide-subheading .num-sub {
  font-family: 'JetBrains Mono', monospace; color: #6f87d6;
  font-size: clamp(16px, 1.8vw, 22px);
}
.slide-subsection h4.slide-subheading {
  font-size: clamp(18px, 2vw, 26px);
  border-left-width: 2px;
}
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
