import { describe, it, expect } from 'vitest'
import {
  computeDragMove,
  shouldPersistOnEnd,
  snap,
  clamp,
  LIFT_OFF,
  MIN_W,
  MAX_W,
  MIN_H,
  MAX_H,
  type ResizeDragInput,
} from '../BlockResizeWrapper'

/**
 * BlockResizeWrapper은 글로벌 `pointermove` / `pointerup` 리스너를 ref 위에
 * 직접 다는 useEffect 흐름이라 jsdom + RTL 없이 `<BlockResizeWrapper />` 의
 * 통합 동작을 시뮬레이션하기 어렵다. (이 워크스페이스는 의도적으로 jsdom
 * 을 들이지 않는다 — `auto-save.test.ts`, `InlineTextBlockEditor.test.tsx`
 * 의 README 주석 참고.)
 *
 * 대신, 컴포넌트의 의사결정을 도맡는 두 순수 함수 `computeDragMove`,
 * `shouldPersistOnEnd` 를 테스트해 Mandate 의 3가지 시나리오를 등가로
 * 검증한다.
 *
 *   - <4px movement on pointerup does NOT call patchBlock
 *       → shouldPersistOnEnd({liftedOff: false}, false) === false
 *   - 24px right-edge drag → snapped 24px width
 *       → computeDragMove(...rightDrag, 24, 0).w === startW + 24
 *   - Esc mid-drag aborts (no patchBlock)
 *       → shouldPersistOnEnd({liftedOff: true}, true) === false
 *
 * `BlockResizeWrapper` 의 `useEffect(onMove)` 와 `endDrag` 는 이 두 함수의
 * 결과만 보고 setState/persist 를 결정하므로, 헬퍼 단위 테스트가 곧
 * 컴포넌트 동작 단위 테스트와 같다.
 */

const baseDrag = (over: Partial<ResizeDragInput> = {}): ResizeDragInput => ({
  kind: 'right',
  startW: 200,
  startH: 200,
  liftedOff: false,
  ...over,
})

describe('snap / clamp 유틸', () => {
  it('snap 은 8px 그리드로 가장 가까운 값을 반환한다', () => {
    expect(snap(0)).toBe(0)
    expect(snap(3)).toBe(0)
    expect(snap(4)).toBe(8)
    expect(snap(11)).toBe(8)
    expect(snap(12)).toBe(16)
    expect(snap(24)).toBe(24)
  })

  it('clamp 은 lo/hi 범위로 잘라낸다', () => {
    expect(clamp(50, MIN_W, MAX_W)).toBe(MIN_W)
    expect(clamp(MIN_W, MIN_W, MAX_W)).toBe(MIN_W)
    expect(clamp(500, MIN_W, MAX_W)).toBe(500)
    expect(clamp(99_999, MIN_W, MAX_W)).toBe(MAX_W)
  })
})

describe('computeDragMove — lift-off threshold (<4px)', () => {
  it('pointer 가 LIFT_OFF 미만이면 liftedOff=false 만 돌려준다 (draft 갱신 안됨)', () => {
    const result = computeDragMove(baseDrag(), 2, 0)
    expect(result.liftedOff).toBe(false)
    expect(result.w).toBeUndefined()
    expect(result.h).toBeUndefined()
  })

  it('정확히 LIFT_OFF (4px) 에 도달하면 liftedOff=true', () => {
    const result = computeDragMove(baseDrag(), LIFT_OFF, 0)
    expect(result.liftedOff).toBe(true)
    // startW=200, dx=4 → snap(204) === 200+8 (rounded UP because 204 > 200+4)
    expect(result.w).toBe(208)
  })
})

describe('computeDragMove — right-edge drag 24px (Mandate 시나리오 #2)', () => {
  it('startW=200 + dx=24 → snap(224) === 224 (3*8)', () => {
    const result = computeDragMove(baseDrag({ kind: 'right' }), 24, 0)
    expect(result.liftedOff).toBe(true)
    expect(result.w).toBe(224)
    // right-edge 드래그는 height 갱신 금지.
    expect(result.h).toBeUndefined()
  })

  it('snap 은 24px 의 정수배를 그대로 통과시킨다 (3 × 8 = 24)', () => {
    expect(snap(24)).toBe(24)
    expect(snap(48)).toBe(48)
  })
})

describe('computeDragMove — corner / bottom 변형', () => {
  it('bottom 드래그는 width 를 건드리지 않는다', () => {
    const result = computeDragMove(baseDrag({ kind: 'bottom' }), 24, 24)
    expect(result.w).toBeUndefined()
    expect(result.h).toBe(200 + 24)
  })

  it('corner 드래그는 width 와 height 모두 갱신한다', () => {
    const result = computeDragMove(baseDrag({ kind: 'corner' }), 16, 24)
    expect(result.w).toBe(200 + 16)
    expect(result.h).toBe(200 + 24)
  })

  it('극단적인 음수 delta 는 MIN 값으로 clamp 된다', () => {
    const result = computeDragMove(baseDrag({ kind: 'corner' }), -5_000, -5_000)
    expect(result.w).toBe(MIN_W)
    expect(result.h).toBe(MIN_H)
  })

  it('극단적인 양수 delta 는 MAX 값으로 clamp 된다', () => {
    const result = computeDragMove(baseDrag({ kind: 'corner' }), 99_999, 99_999)
    expect(result.w).toBe(MAX_W)
    expect(result.h).toBe(MAX_H)
  })
})

describe('shouldPersistOnEnd — patchBlock 호출 결정', () => {
  it('Esc 취소(cancel=true) 일 때는 patchBlock 호출 금지', () => {
    expect(shouldPersistOnEnd(baseDrag({ liftedOff: true }), true)).toBe(false)
  })

  it('lift-off 못 넘은 우발적 클릭은 patchBlock 호출 금지', () => {
    expect(shouldPersistOnEnd(baseDrag({ liftedOff: false }), false)).toBe(
      false,
    )
  })

  it('lift-off 한 정상 드래그 종료는 patchBlock 호출 허용', () => {
    expect(shouldPersistOnEnd(baseDrag({ liftedOff: true }), false)).toBe(true)
  })
})
