# 의미 관계(triple)의 정제된 표준 유형 — predicate/inverse 캐논. 자유텍스트 혼란을
# 줄이고 그래프를 유형별로 질의 가능하게 한다 (graph-triple-ontology).
from dataclasses import dataclass


@dataclass(frozen=True)
class RelationType:
    key: str            # 안정 식별자
    predicate: str      # subject → object 방향 서술
    inverse: str        # object → subject 역방향 서술
    symmetric: bool     # 대칭이면 predicate == inverse
    description: str


# 사내 백서 그래프에 자주 쓰이는 관계. predicate 는 "A 는 B 를 <predicate>" 로
# 읽고, inverse 는 "B 는 A 를 <inverse>" 로 읽는다.
RELATION_TYPES: list[RelationType] = [
    RelationType("premise",      "전제로 한다",   "의 전제가 된다",      False, "A 는 B 를 전제/선행조건으로 한다"),
    RelationType("cites",        "인용한다",      "에 인용된다",         False, "A 가 B 를 인용/참조한다"),
    RelationType("part-of",      "의 일부다",     "를 포함한다",         False, "A 는 B 의 구성요소/일부다"),
    RelationType("is-a",         "의 한 종류다",  "를 일반화한다",       False, "A 는 B 의 하위 유형(is-a)이다"),
    RelationType("supersedes",   "대체한다",      "에 의해 대체된다",    False, "A 가 B 를 대체/폐기한다"),
    RelationType("depends-on",   "의존한다",      "의 기반이 된다",      False, "A 가 동작하려면 B 가 필요하다"),
    RelationType("derived-from", "에서 파생된다", "의 파생물을 낳는다",  False, "A 는 B 에서 유도/파생됐다"),
    RelationType("example-of",   "의 예시다",     "의 예를 가진다",      False, "A 는 B 의 구체적 예시다"),
    RelationType("related-to",   "와 관련있다",   "와 관련있다",         True,  "A 와 B 는 서로 관련있다 (대칭)"),
    RelationType("contrasts",    "와 대비된다",   "와 대비된다",         True,  "A 와 B 는 대조/비교 대상이다 (대칭)"),
]

_BY_PREDICATE = {t.predicate: t for t in RELATION_TYPES}
_BY_KEY = {t.key: t for t in RELATION_TYPES}


def as_dicts() -> list[dict]:
    """API 응답용 직렬화."""
    return [
        {
            "key": t.key,
            "predicate": t.predicate,
            "inverse": t.inverse,
            "symmetric": t.symmetric,
            "description": t.description,
        }
        for t in RELATION_TYPES
    ]


def inverse_for(predicate: str | None) -> str | None:
    """캐논 predicate 면 그 표준 inverse 를, 아니면 None (자유텍스트는 그대로)."""
    if not predicate:
        return None
    t = _BY_PREDICATE.get(predicate.strip())
    return t.inverse if t else None


def by_key(key: str) -> RelationType | None:
    return _BY_KEY.get(key)
