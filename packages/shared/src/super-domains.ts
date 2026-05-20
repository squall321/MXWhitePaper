export interface SuperDomain {
  id: string
  label: string  // 영어 fallback. i18n key 는 home.domain.<id>
  emoji: string
  tags: string[]
  paletteVar: string
}

export const SUPER_DOMAINS: SuperDomain[] = [
  { id: 'mobile',   label: 'Mobile',   emoji: '📱',
    tags: ['mobile'],                                  paletteVar: '--graph-domain-mobile' },
  { id: 'software', label: 'Software', emoji: '💻',
    tags: ['software', 'programming', 'architecture'], paletteVar: '--graph-domain-software' },
  { id: 'hardware', label: 'Hardware', emoji: '🔧',
    tags: ['semiconductor', 'electronics', 'display'], paletteVar: '--graph-domain-hardware' },
  { id: 'telecom',  label: 'Telecom',  emoji: '📡',
    tags: ['telecom'],                                 paletteVar: '--graph-domain-telecom' },
]

export const NOISE_TAGS = new Set([
  '템플릿', '미팅', 'faq', 'intro', 'sample', 'namu-archive', 'imported-bulk',
])
