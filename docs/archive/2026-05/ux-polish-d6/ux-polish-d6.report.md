# ux-polish-d6 — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | D6 — Notification drawer 카테고리 unread + per-row read + AdminGlossaryPending 안전성/시각 폴리시 |
| **Completion** | 2026-05-31 |
| **Match Rate** | 100% (Notification + Admin pending 두 영역) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | Notification drawer: 필터 칩이 "전체/시스템/활동/댓글" 라벨만 보여서 어느 카테고리에 새 알림 있는지 한눈에 안 보임. 한국어 literal 다수 / relative time `ko-KR` 하드코딩. AdminGlossaryPending: 일괄 *승인* 이 confirm 없이 단일 클릭 가능 (실수 위험), progress 가 텍스트만 (시각 피드백 약함), indeterminate 체크박스 시각 표시 약함 |
| Solution | drawer 폴리시 — per-filter unread 카운트 chip + pure helper tallyUnreadByFilter export / per-row inline ✓ mark-read 버튼 (hover/focus 시 노출) / 18 i18n 키 (filter/action/empty/relative time) + categoryLabel + formatRelative 가 t() 받는 시그니처. admin pending 폴리시 — bulk approve ≥3건 일괄 시 window.confirm 게이트 (reject 모달 미러) / progress 옆 progressbar 시각화 (실패 시 amber) / select-all 체크박스 indeterminate 시 ring-2 wrap + aria-checked='mixed' |
| Function/UX | drawer: 댓글 5건 + 시스템 1건 같은 비대칭이 한 글자로 보임. EN locale 자연. 마우스 hover 시 한 알림만 빠르게 읽음 처리. admin: 실수로 50건 승인 위험 차단 + 진행 상황 시각화 + a11y indeterminate 인지 가능 |
| Core Value | D 트랙 마지막 사이클 — 운영 UX 마감 |

## 변경

### 1) Notification drawer (D6-a) — `apps/web/src/features/notifications/components/NotificationDrawer.tsx`

- `tallyUnreadByFilter` pure helper export — `Record<'all'|category, number>` 반환
- `unreadByFilter` useMemo 가 helper 호출
- 필터 chip 각각 unread count badge (선택 시 white-on-smsg, 선택 X 시 red-on-white). 99+ cap
- `NotificationRow` 에 inline ✓ mark-read 버튼 — `group-hover:inline-block` + `e.stopPropagation()` 로 navigate 충돌 회피
- `categoryLabel` → `categoryLabelKey` (i18n key 반환)
- `formatRelative(t, ts, now?)` 시그니처 — locale 받음. `'ko-KR'` 하드코딩 → `undefined` (Intl 기본 locale)
- 모든 한국어 literal → t() 호출

### 2) Notification bell (D6-a) — `apps/web/src/features/notifications/components/NotificationBell.tsx`

- `useT` 도입. label `'알림 N건'`/`'알림'` → `t('notifications.bell.unread', { count })` / `t('notifications.bell.label')`

### 3) i18n — 20 신규 키 ko/en

- bell.unread {count}, bell.label
- drawer.ariaLabel / title / close
- filter.all / system / activity / comment
- action.markAllRead / clearAll / markOneRead
- empty.title / description
- row.unreadDot
- time.justNow / minutesAgo {m} / hoursAgo {h} / yesterday / daysAgo {d}

### 4) Admin pending (D6-b) — `apps/web/src/pages/AdminGlossaryPending.tsx`

- `onBulkApprove` 에 confirm gate: `ids.length >= 3` 시 `window.confirm()` 호출. SSR 환경 (`typeof window === 'undefined'`) 은 통과. RejectReasonModal 이 강제하는 마찰을 destructive approve 쪽에도 미러
- progress 표시: 텍스트 + `<div role="progressbar" aria-valuemin/max/now>` width-percent 바. failed > 0 시 amber, 정상 진행 시 smsg-500
- select-all 체크박스 indeterminate 시각: 부분 선택 시 외곽 `ring-2 ring-smsg-400 ring-offset-1` 래퍼. `aria-checked='mixed'` 으로 SR

### 5) 테스트

- `NotificationDrawer.test.tsx` 신규 4 단위 — tallyUnreadByFilter (빈 리스트, 카테고리 분리, null 방어, 100+ 스케일)
- zustand store 가 SSR `getServerSnapshot` 으로 setState 무시하는 회귀 발견 → pure helper 분리로 우회 (`exported function tallyUnreadByFilter`)
- 기존 NotificationBell.test (4) + Admin pending test (5+) 전체 통과 — 회귀 0

## 검증

- typecheck: clean
- vitest: **2398 / 2398** (+4 신규 tallyUnreadByFilter)
- 빌드 영향 0

## D 트랙 6 사이클 누적 완료

| Cycle | 핵심 | 사이즈 | commit |
|---|---|---|---|
| D1 | FLOW-01 Excalidraw viewer | XL | 25a842b |
| D2 | viewer 16 i18n + 65 키 | M-L | dc6a6e2 |
| D3 | Tabs + OrgChart a11y | M | f3c95af |
| D4 | QuizBlockEditor + FormBlock refactor | M | 887f087 |
| D5 | lat 6 파일 30 drift sweep | M | fb63beb |
| D6 | Notification + Admin pending UX | M | 본 사이클 |

block audit C5 defer 6건 전체 + 추가 4 트랙 회수. 5 사이클 + 1 폴리시 사이클.

## 다음 단계

- D 트랙 종료. 다음 큰 트랙은 사용자 결정에 위임
