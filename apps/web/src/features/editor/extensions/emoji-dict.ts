/**
 * A built-in emoji dictionary for the `:colon` autocomplete.
 *
 * Curated to ~150 entries that cover the most common writing-flow needs (status
 * cues, faces, actions, work artifacts, weather, transport). No external
 * dependency — keeps the bundle delta near zero.
 *
 * Public surface:
 *   - `EMOJI_DICT`  the shortcode → glyph map.
 *   - `findEmoji`   returns up to N entries matching the typed query.
 *   - `lookupEmoji` exact-shortcode lookup (returns the glyph or null).
 */
export interface EmojiEntry {
  /** Shortcode without surrounding colons, e.g. `smile`. */
  code: string
  /** Glyph(s) e.g. `😄`. */
  glyph: string
  /** Free-text aliases used in match scoring. */
  aliases?: string[]
}

export const EMOJI_DICT: ReadonlyArray<EmojiEntry> = [
  // Faces (positive)
  { code: 'smile', glyph: '😄', aliases: ['happy', 'joy'] },
  { code: 'grin', glyph: '😁' },
  { code: 'laugh', glyph: '😆' },
  { code: 'rofl', glyph: '🤣' },
  { code: 'wink', glyph: '😉' },
  { code: 'hugs', glyph: '🤗' },
  { code: 'heart_eyes', glyph: '😍' },
  { code: 'kiss', glyph: '😘' },
  { code: 'yum', glyph: '😋' },
  { code: 'sunglasses', glyph: '😎' },
  { code: 'star_struck', glyph: '🤩' },
  { code: 'thinking', glyph: '🤔' },
  { code: 'zipper_mouth', glyph: '🤐' },
  { code: 'neutral', glyph: '😐' },
  // Faces (negative)
  { code: 'cry', glyph: '😢' },
  { code: 'sob', glyph: '😭' },
  { code: 'angry', glyph: '😠' },
  { code: 'rage', glyph: '😡' },
  { code: 'tired', glyph: '😩' },
  { code: 'sleepy', glyph: '😪' },
  { code: 'sleep', glyph: '😴' },
  { code: 'sick', glyph: '🤒' },
  { code: 'mask', glyph: '😷' },
  { code: 'dizzy', glyph: '😵' },
  { code: 'scream', glyph: '😱' },
  { code: 'scared', glyph: '😨' },
  { code: 'cold_sweat', glyph: '😰' },
  { code: 'sweat', glyph: '😅' },
  { code: 'unamused', glyph: '😒' },
  { code: 'disappointed', glyph: '😞' },
  // Hands / gestures
  { code: 'thumbsup', glyph: '👍', aliases: ['+1', 'good', 'ok'] },
  { code: 'thumbsdown', glyph: '👎', aliases: ['-1', 'bad'] },
  { code: 'ok_hand', glyph: '👌' },
  { code: 'clap', glyph: '👏' },
  { code: 'raised_hands', glyph: '🙌' },
  { code: 'pray', glyph: '🙏', aliases: ['thanks', '감사'] },
  { code: 'wave', glyph: '👋' },
  { code: 'point_right', glyph: '👉' },
  { code: 'point_left', glyph: '👈' },
  { code: 'point_up', glyph: '👆' },
  { code: 'point_down', glyph: '👇' },
  { code: 'fist', glyph: '✊' },
  { code: 'muscle', glyph: '💪' },
  { code: 'handshake', glyph: '🤝' },
  // People
  { code: 'man', glyph: '👨' },
  { code: 'woman', glyph: '👩' },
  { code: 'baby', glyph: '👶' },
  { code: 'family', glyph: '👪' },
  { code: 'student', glyph: '🧑‍🎓' },
  { code: 'teacher', glyph: '🧑‍🏫' },
  { code: 'tech', glyph: '🧑‍💻' },
  { code: 'engineer', glyph: '👷' },
  // Hearts / status
  { code: 'heart', glyph: '❤️' },
  { code: 'broken_heart', glyph: '💔' },
  { code: 'fire', glyph: '🔥', aliases: ['hot', 'lit'] },
  { code: 'star', glyph: '⭐' },
  { code: 'sparkles', glyph: '✨' },
  { code: 'tada', glyph: '🎉', aliases: ['party', 'celebrate'] },
  { code: 'rocket', glyph: '🚀', aliases: ['launch', 'ship'] },
  { code: 'boom', glyph: '💥' },
  { code: 'zap', glyph: '⚡' },
  { code: 'bulb', glyph: '💡', aliases: ['idea'] },
  { code: 'eyes', glyph: '👀' },
  { code: '100', glyph: '💯' },
  { code: 'check', glyph: '✅', aliases: ['done', 'ok'] },
  { code: 'x', glyph: '❌', aliases: ['no', 'cancel'] },
  { code: 'warning', glyph: '⚠️' },
  { code: 'no_entry', glyph: '⛔' },
  { code: 'question', glyph: '❓' },
  { code: 'exclamation', glyph: '❗' },
  { code: 'bell', glyph: '🔔' },
  { code: 'lock', glyph: '🔒' },
  { code: 'unlock', glyph: '🔓' },
  { code: 'key', glyph: '🔑' },
  // Work artifacts
  { code: 'memo', glyph: '📝', aliases: ['note', 'edit'] },
  { code: 'pencil', glyph: '✏️' },
  { code: 'page', glyph: '📄' },
  { code: 'folder', glyph: '📁' },
  { code: 'open_folder', glyph: '📂' },
  { code: 'book', glyph: '📖' },
  { code: 'books', glyph: '📚' },
  { code: 'clipboard', glyph: '📋' },
  { code: 'pushpin', glyph: '📌' },
  { code: 'paperclip', glyph: '📎' },
  { code: 'chart', glyph: '📊' },
  { code: 'chart_up', glyph: '📈' },
  { code: 'chart_down', glyph: '📉' },
  { code: 'calendar', glyph: '📅' },
  { code: 'date', glyph: '📆' },
  { code: 'mailbox', glyph: '📬' },
  { code: 'inbox', glyph: '📥' },
  { code: 'outbox', glyph: '📤' },
  { code: 'package', glyph: '📦' },
  { code: 'mag', glyph: '🔍', aliases: ['search'] },
  { code: 'wrench', glyph: '🔧' },
  { code: 'hammer', glyph: '🔨' },
  { code: 'gear', glyph: '⚙️', aliases: ['settings'] },
  { code: 'computer', glyph: '💻' },
  { code: 'phone', glyph: '📱' },
  { code: 'tv', glyph: '📺' },
  { code: 'camera', glyph: '📷' },
  { code: 'video', glyph: '🎥' },
  { code: 'mic', glyph: '🎤' },
  { code: 'headphones', glyph: '🎧' },
  // Time / signs
  { code: 'clock', glyph: '🕐' },
  { code: 'hourglass', glyph: '⏳' },
  { code: 'alarm', glyph: '⏰' },
  { code: 'arrow_up', glyph: '⬆️' },
  { code: 'arrow_down', glyph: '⬇️' },
  { code: 'arrow_left', glyph: '⬅️' },
  { code: 'arrow_right', glyph: '➡️' },
  { code: 'recycle', glyph: '♻️' },
  { code: 'plus', glyph: '➕' },
  { code: 'minus', glyph: '➖' },
  { code: 'divide', glyph: '➗' },
  { code: 'multiply', glyph: '✖️' },
  // Weather / nature
  { code: 'sun', glyph: '☀️' },
  { code: 'cloud', glyph: '☁️' },
  { code: 'rain', glyph: '🌧️' },
  { code: 'snow', glyph: '❄️' },
  { code: 'umbrella', glyph: '☂️' },
  { code: 'rainbow', glyph: '🌈' },
  { code: 'moon', glyph: '🌙' },
  { code: 'earth', glyph: '🌏' },
  { code: 'tree', glyph: '🌳' },
  { code: 'flower', glyph: '🌸' },
  { code: 'leaf', glyph: '🍃' },
  // Food
  { code: 'coffee', glyph: '☕' },
  { code: 'tea', glyph: '🍵' },
  { code: 'beer', glyph: '🍺' },
  { code: 'pizza', glyph: '🍕' },
  { code: 'cake', glyph: '🍰' },
  { code: 'apple', glyph: '🍎' },
  // Transport
  { code: 'car', glyph: '🚗' },
  { code: 'bus', glyph: '🚌' },
  { code: 'train', glyph: '🚆' },
  { code: 'plane', glyph: '✈️' },
  { code: 'ship', glyph: '🚢' },
  { code: 'bike', glyph: '🚲' },
  // Money
  { code: 'money', glyph: '💰' },
  { code: 'dollar', glyph: '💵' },
  { code: 'card', glyph: '💳' },
  // Misc
  { code: 'gift', glyph: '🎁' },
  { code: 'balloon', glyph: '🎈' },
  { code: 'trophy', glyph: '🏆' },
  { code: 'medal', glyph: '🏅' },
  { code: 'gem', glyph: '💎' },
  { code: 'crown', glyph: '👑' },
  { code: 'art', glyph: '🎨' },
  { code: 'music', glyph: '🎵' },
  { code: 'dog', glyph: '🐶' },
  { code: 'cat', glyph: '🐱' },
  { code: 'bear', glyph: '🐻' },
  { code: 'panda', glyph: '🐼' },
  { code: 'penguin', glyph: '🐧' },
  { code: 'fish', glyph: '🐟' },
  { code: 'butterfly', glyph: '🦋' },
  { code: 'unicorn', glyph: '🦄' },
]

const INDEX = (() => {
  const m = new Map<string, EmojiEntry>()
  for (const e of EMOJI_DICT) m.set(e.code, e)
  return m
})()

/** Exact-shortcode lookup. Returns the glyph or null. */
export function lookupEmoji(code: string): string | null {
  const e = INDEX.get(code.toLowerCase())
  return e ? e.glyph : null
}

/**
 * Fuzzy-search emojis. Matches when any of the following contain the query
 * (case-insensitive): the code, an alias.
 */
export function findEmoji(query: string, limit = 10): EmojiEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return EMOJI_DICT.slice(0, limit)
  const out: EmojiEntry[] = []
  for (const e of EMOJI_DICT) {
    if (e.code.startsWith(q)) out.push(e)
    else if (e.code.includes(q)) out.push(e)
    else if ((e.aliases ?? []).some((a) => a.toLowerCase().includes(q))) out.push(e)
    if (out.length >= limit) break
  }
  return out
}
