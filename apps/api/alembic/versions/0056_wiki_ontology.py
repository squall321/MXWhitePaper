# 위키 온톨로지 — 술어 표(첫 판) · 유형 · 술어 제안 → 승인 · 바깥 어휘 대응 · doc_triples 위키 칸 · 지운 문서의 triple 정리(docs/llm-wiki W5)
"""wiki predicates · ontology moderation · doc_triples wiki columns (W5, CONTRACTS §2-6).

- wiki_predicates — 첫 판 18 가지(SCHEMA-DRAFT §5)를 approved 로 넣는다. 문서 사이 관계 열 가지(app/lib/relationship_types.py)는
  그대로 두고 이 표가 공학 개체 사이 관계를 더한다. 이름은 'A 는 …' 다음에 [[B]] 를 앞에 두고 읽는다 — `[[B]] 의 일부다`.
  초안에서 그렇게 읽히지 않던 이름 몇은 고쳤다(context-notes WK-D44).
- 유형 · 술어 모두 status 에 rejected 를 더하고 decided_at · decision_note(거절 까닭)를 둔다 — 용어집과 같은 길(제안 → admin 승인).
- wiki_entity_types.ext_axes — 바깥 어휘 대응(SCHEMA-DRAFT §4 표의 축 이름 · 외부 id 칸). 값(사내 코드)은 박스에서 받는다.
- doc_triples — predicate_key · source_ids · changeset_id · wiki_status 를 더하고 source 에 'wiki' 를 더한다. 주어 · 목적어는 지금처럼 slug.
- wiki_log 의 op 에 `ontology`(유형 · 술어 제안 · 결정, 별칭, 합치기 제안)를 더한다.
- 문서를 지우면 그 slug 를 주어 · 목적어로 쓰던 triple 도 지운다(트리거). 이미 남은 것은 주어가 없는 것만 지운다 — 목적어는 아직
  안 쓴 문서를 가리킬 수 있다(만들기가 slug 를 검사하지 않는다).
"""
from __future__ import annotations

import json
from collections.abc import Sequence

from alembic import op

revision: str = "0056_wiki_ontology"
down_revision: str | Sequence[str] | None = "0055_wiki_reviewer"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (key, 이름, 역, 정의역, 치역, 대칭) — SCHEMA-DRAFT §5. 빈 정의역 · 치역은 '아무 유형'(same-as 는 같은 유형끼리 — 코드가 본다).
_PREDICATES = [
    ("part-of", "의 일부다", "를 포함한다", ["part"], ["part", "product-model"], False),
    ("variant-of", "의 파생이다", "를 파생으로 가진다", ["product-model"], ["product-model"], False),
    ("uses-material", "를 재료로 쓴다", "에 쓰인다", ["part"], ["material"], False),
    ("supplied-by", "에서 공급받는다", "를 공급한다", ["part"], ["supplier"], False),
    ("has-failure-mode", "를 불량 유형으로 가진다", "에서 일어난다", ["part", "product-model"], ["failure-mode"], False),
    ("caused-by", "때문에 일어난다", "를 일으킨다", ["failure-mode", "field-case"], ["mechanism", "failure-mode"], False),
    ("observed-in", "에서 관찰됐다", "를 관찰한 사례다", ["failure-mode"], ["field-case"], False),
    ("reproduced-by", "에 의해 재현됐다", "를 재현한다", ["failure-mode"], ["sim-case"], False),
    ("simulated-with", "로 해석했다", "를 해석 사례로 가진다", ["sim-case"], ["sim-type"], False),
    ("tested-by", "로 시험했다", "를 시험한다", ["part", "product-model", "countermeasure"], ["reliability-test"], False),
    ("mitigated-by", "로 막았다", "를 막는다", ["failure-mode"], ["countermeasure"], False),
    ("verified-by", "로 효과를 확인했다", "의 효과를 확인한다", ["countermeasure"],
     ["sim-case", "reliability-test", "field-case"], False),
    ("about-model", "에 관한 것이다", "를 사례로 가진다", ["field-case", "sim-case"], ["product-model"], False),
    ("about-part", "에 관한 것이다", "를 사례로 가진다", ["field-case", "sim-case"], ["part"], False),
    ("in-stage", "에 속한다", "를 가진다", ["sim-case", "field-case", "product-model"], ["dev-stage"], False),
    ("in-project", "에 속한다", "를 가진다", ["sim-case", "field-case", "product-model"], ["project"], False),
    ("correlates-with", "와 맞대 본 결과가 있다", "와 맞대 본 결과가 있다", ["sim-case", "field-case"],
     ["sim-case", "field-case"], True),
    ("same-as", "와 같은 개체다", "와 같은 개체다", [], [], True),
]

# 유형 → 바깥 어휘 대응(SCHEMA-DRAFT §4 표). ext_ids — 그 유형의 엔티티가 쓰는 외부 id 칸 이름.
_EXT_AXES = {
    "product-model": {"ra": "축 model", "sp": "plm_model", "other": "DynaForge eng_meta.project",
                      "ext_ids": ["sp_model", "ra_entity"]},
    "project": {"ra": "레코드 project", "sp": "plm_project · plm_task", "other": "StepForge find_plm_task",
                "ext_ids": ["sp_project", "sp_task", "ra_entity"]},
    "dev-stage": {"ra": "축 phase", "sp": "plm_task.task_status", "other": "DynaForge eng_meta.dev_revision",
                  "ext_ids": ["ra_entity"]},
    "part": {"ra": "축 part · bom · 레코드 cae_part", "other": "StepForge 부품 역할 16(attrs.part_role)",
             "ext_ids": ["bom_code", "ra_entity", "sf_part_role"]},
    "supplier": {"ra": "레코드 supplier", "ext_ids": ["ra_entity"]},
    "material": {"other": "MaterialTwin material", "ext_ids": ["mt_material"]},
    "failure-mode": {"ra": "축 defect · 레코드 failure_mode",
                     "other": "FMEA 고장 모드 · StepForge 고장 모드 7 · SignalForge voc_defects.symptom",
                     "ext_ids": ["ra_entity", "fmea_item"]},
    "mechanism": {"other": "HWAX Risk 메커니즘 52 · 영역 15 · 검출성", "ext_ids": ["risk_mechanism"]},
    "field-case": {"ra": "레코드 incident", "other": "PLM 결함 검색 사례 · SignalForge", "ext_ids": ["plm_case", "ra_entity"]},
    "sim-case": {"ra": "바깥 해석 analysis_runs", "other": "DynaForge impact_reports · stcx 잡 · ste 잡", "ext_ids": []},
    "sim-type": {"ra": "축 sim_type", "other": "DynaForge kind(deep · sphere · impact) · 전각도 · 단일 낙하",
                 "ext_ids": ["ra_entity"]},
    "reliability-test": {"ra": "축 rel_test · 레코드 test_run", "sp": "plm_task.test_kind", "other": "TestScope 시험 항목",
                         "ext_ids": ["ra_entity"]},
    "countermeasure": {"other": "FMEA 개선 조치", "ext_ids": ["fmea_item"]},
    "concept": {"other": "MXWP 용어집 · AIDataHub 분야", "ext_ids": ["aidh_card"]},
}

_LOG_OPS = "'ingest', 'query', 'fileback', 'lint', 'inquire', 'review', 'revert', 'withdraw', 'schema'"  # 0052


def _arr(items: list[str]) -> str:
    return "ARRAY[" + ", ".join(f"'{x}'" for x in items) + "]::text[]" if items else "'{}'::text[]"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE wiki_predicates (
            key            TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9-]{1,40}$'),
            label_ko       TEXT NOT NULL CHECK (char_length(label_ko) BETWEEN 1 AND 60),
            inverse_ko     TEXT NOT NULL CHECK (char_length(inverse_ko) BETWEEN 1 AND 60),
            domain_types   TEXT[] NOT NULL DEFAULT '{}',
            range_types    TEXT[] NOT NULL DEFAULT '{}',
            is_symmetric   BOOLEAN NOT NULL DEFAULT FALSE,  -- symmetric 은 예약어
            description    TEXT,
            status         TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('approved', 'proposed', 'rejected')),
            proposed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
            approved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
            decided_at     TIMESTAMPTZ,
            decision_note  TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    values = ", ".join(
        f"('{k}', '{label}', '{inv}', {_arr(dom)}, {_arr(rng)}, {'TRUE' if sym else 'FALSE'}, 'approved')"
        for k, label, inv, dom, rng, sym in _PREDICATES)
    op.execute(f"INSERT INTO wiki_predicates (key, label_ko, inverse_ko, domain_types, range_types, is_symmetric, status) "
               f"VALUES {values}")

    op.execute("ALTER TABLE wiki_entity_types DROP CONSTRAINT wiki_entity_types_status_check")
    op.execute("""
        ALTER TABLE wiki_entity_types
            ADD CONSTRAINT wiki_entity_types_status_check CHECK (status IN ('approved', 'proposed', 'rejected')),
            ADD COLUMN decided_at TIMESTAMPTZ,
            ADD COLUMN decision_note TEXT
    """)
    for key, axes in _EXT_AXES.items():
        op.execute(f"UPDATE wiki_entity_types SET ext_axes = '{json.dumps(axes, ensure_ascii=False)}'::jsonb "
                   f"WHERE key = '{key}'")

    op.execute("ALTER TABLE wiki_log DROP CONSTRAINT wiki_log_op_check")
    op.execute(f"ALTER TABLE wiki_log ADD CONSTRAINT wiki_log_op_check CHECK (op IN ({_LOG_OPS}, 'ontology'))")

    op.execute("ALTER TABLE doc_triples DROP CONSTRAINT doc_triples_source_check")
    op.execute("""
        ALTER TABLE doc_triples
            ADD CONSTRAINT doc_triples_source_check CHECK (source IN ('llm', 'manual', 'wiki')),
            ADD COLUMN predicate_key TEXT REFERENCES wiki_predicates(key),
            ADD COLUMN source_ids UUID[] NOT NULL DEFAULT '{}',
            ADD COLUMN changeset_id UUID REFERENCES wiki_changesets(id) ON DELETE SET NULL,
            ADD COLUMN wiki_status TEXT CHECK (wiki_status IN ('proposed', 'accepted', 'retired')),
            ADD CONSTRAINT doc_triples_wiki_cols CHECK (source <> 'wiki' OR (predicate_key IS NOT NULL AND wiki_status IS NOT NULL))
    """)
    op.execute("CREATE INDEX idx_triples_changeset ON doc_triples (changeset_id) WHERE changeset_id IS NOT NULL")

    op.execute("""
        CREATE FUNCTION doc_triples_drop_for_doc() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            DELETE FROM doc_triples WHERE subject_slug = OLD.slug OR object_slug = OLD.slug;
            RETURN OLD;
        END $$
    """)
    op.execute("""
        CREATE TRIGGER trg_doc_triples_drop AFTER DELETE ON documents
            FOR EACH ROW EXECUTE FUNCTION doc_triples_drop_for_doc()
    """)
    op.execute("""
        DELETE FROM doc_triples t WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.slug = t.subject_slug)
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_doc_triples_drop ON documents")
    op.execute("DROP FUNCTION IF EXISTS doc_triples_drop_for_doc()")
    op.execute("DELETE FROM doc_triples WHERE source = 'wiki'")
    op.execute("DROP INDEX IF EXISTS idx_triples_changeset")
    op.execute("""
        ALTER TABLE doc_triples
            DROP CONSTRAINT IF EXISTS doc_triples_wiki_cols,
            DROP COLUMN IF EXISTS wiki_status,
            DROP COLUMN IF EXISTS changeset_id,
            DROP COLUMN IF EXISTS source_ids,
            DROP COLUMN IF EXISTS predicate_key,
            DROP CONSTRAINT doc_triples_source_check,
            ADD CONSTRAINT doc_triples_source_check CHECK (source IN ('llm', 'manual'))
    """)
    op.execute("SET LOCAL mxwp.wiki_purge = 'on'")
    op.execute("DELETE FROM wiki_log WHERE op = 'ontology'")
    op.execute("ALTER TABLE wiki_log DROP CONSTRAINT wiki_log_op_check")
    op.execute(f"ALTER TABLE wiki_log ADD CONSTRAINT wiki_log_op_check CHECK (op IN ({_LOG_OPS}))")
    op.execute("DELETE FROM wiki_entity_types WHERE status = 'rejected'")
    op.execute("""
        ALTER TABLE wiki_entity_types
            DROP COLUMN IF EXISTS decision_note,
            DROP COLUMN IF EXISTS decided_at,
            DROP CONSTRAINT wiki_entity_types_status_check,
            ADD CONSTRAINT wiki_entity_types_status_check CHECK (status IN ('approved', 'proposed'))
    """)
    op.execute("UPDATE wiki_entity_types SET ext_axes = '{}'::jsonb")
    op.execute("DROP TABLE IF EXISTS wiki_predicates")
