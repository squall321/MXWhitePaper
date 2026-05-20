"""Mirror of packages/shared/src/super-domains.ts — keep in sync.

If you change SUPER_DOMAINS in TS, update this file too.
"""
from dataclasses import dataclass

@dataclass(frozen=True)
class SuperDomain:
    id: str
    label: str
    emoji: str
    tags: tuple[str, ...]
    palette_var: str

SUPER_DOMAINS: list[SuperDomain] = [
    SuperDomain('mobile',   'Mobile',   '📱', ('mobile',),                                  '--graph-domain-mobile'),
    SuperDomain('software', 'Software', '💻', ('software', 'programming', 'architecture'),  '--graph-domain-software'),
    SuperDomain('hardware', 'Hardware', '🔧', ('semiconductor', 'electronics', 'display'),  '--graph-domain-hardware'),
    SuperDomain('telecom',  'Telecom',  '📡', ('telecom',),                                 '--graph-domain-telecom'),
]

NOISE_TAGS: frozenset[str] = frozenset({
    '템플릿', '미팅', 'faq', 'intro', 'sample', 'namu-archive', 'imported-bulk',
})

def by_id(domain_id: str) -> SuperDomain | None:
    return next((d for d in SUPER_DOMAINS if d.id == domain_id), None)
