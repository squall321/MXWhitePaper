/**
 * Activity feature barrel.
 *
 * TODO(profile-tab): No `UserProfile.tsx` page exists yet. When one is added,
 *   reuse `ActivityWidget` (filtered to a single user) by passing
 *   `items={await listMyActivity({ limit: 20 })}` from inside the profile
 *   page's "활동" tab.
 */
export { ActivityWidget } from './ActivityWidget'
export {
  listActivity,
  listMyActivity,
  ACTIVITY_KINDS,
  type ActivityEvent,
  type ActivityKind,
  type ActivityActor,
  type ActivityTarget,
  type ActivityListParams,
  type ActivityListPayload,
} from './api'
export {
  formatRelative,
  initialsFor,
  colorForKey,
  CHIP_OPTIONS,
  kindsForChip,
  type ChipKey,
} from './format'
