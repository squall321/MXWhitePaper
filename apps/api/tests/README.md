# API tests

## Running

The Apptainer image does not put `pytest` on `PATH`. Always invoke via the module:

```bash
apptainer exec instance://mxwp_api /bin/sh -c \
  "cd /workspace/apps/api && python3 -m pytest -q"
```

(NOT `pytest -q` — that fails with "command not found" in the image.)

## Layout

| File | What it covers |
| --- | --- |
| `test_health.py` | `/healthz` smoke |
| `test_orgs.py` | Sprint 1 org tree |
| `test_documents.py` | Sprint 1/2 GET/POST/PUT/DELETE + ETag |
| `test_section_numbering.py` | renumber + level rules |
| `test_wiki_link_extractor.py` | `[[slug#anchor|display]]` parsing |
| `test_section_patch.py` | Sprint 4 PATCH /sections/:id |
| `test_block_patch.py` | Sprint 4 PATCH /blocks/:id + insert/move/delete |
| `test_section_reorder.py` | Sprint 4 POST /sections/reorder |

## Conventions

- Each editor-test re-PUTs the seed JSON at the top of `_get(ac)` so tests are
  isolated. Do not assume previous test state.
- ULID-like IDs in tests use Crockford base32 (`0-9`, `A-H`, `J`, `K`, `M`, `N`, `P-T`, `V-Z`).
- All editor endpoints require `If-Match: W/"<doc_id>-<version>"` (412 otherwise).
- The `X-MXWP-Change-Log` header (≤80 chars, `[A-Za-z0-9._:\-\s]`) is stored as
  the `change_log` for the resulting `document_versions` row.
