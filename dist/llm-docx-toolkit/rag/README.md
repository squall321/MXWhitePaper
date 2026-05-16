# RAG Index — LLM-aware MXWhitePaper rule retrieval

Local retrieval-augmented context for any LLM that drafts MXWhitePaper docx
content. Three swappable backends; same chunks.jsonl, same query CLI.

## Layout

```
rag/
├── README.md
├── _lock.py            # index.lock schema + source hash bookkeeping
├── retriever.py        # backend interface + Chunk / Hit dataclasses
├── chunker.py          # rules + schema + examples → chunks.jsonl (G1)
├── _bm25.py            # keyword backend (G2)
├── _st.py              # sentence-transformer backend (G3, default)
├── _openai.py          # OpenAI embedding backend (G4)
├── cli.py              # `mxwp-rules` entry point (G5)
├── chunks.jsonl        # produced by `mxwp-rules index` (gitignored)
├── embeddings.npz      # produced for st backend (gitignored)
├── bm25.json           # produced for bm25 backend (gitignored)
└── index.lock          # source-hash manifest, committed for verification
```

## CLI

```
mxwp-rules query "callout 만드는 법"            # default backend = st
mxwp-rules query --backend bm25 --k 3 "..."
mxwp-rules query --backend openai "..."
mxwp-rules index --backend st --rebuild         # rebuild chunks + embeddings
mxwp-rules check                                # verify index.lock against sources
```

## Sync guarantee

Every widget / import-rule change forces an index rebuild via four layers:

1. **CI rebuild + lock check** — workflow regenerates chunks/embeddings on
   every push that touches `widget_markers.py`, `docx_import.py`,
   `document.json`, `llm-input-rules.md`, or this folder. Build fails if
   the regenerated lock differs from the committed one.
2. **Path-filter trigger** — same files on the workflow's `paths:` list so
   no irrelevant push wastes CI minutes.
3. **Pre-commit hook** — local widget-source changes block the commit
   unless the rag index lock matches.
4. **Runtime stale check** — the validator binary loads index.lock and
   compares its baked source hashes against an embedded fingerprint;
   stale toolkit prints a loud warning and exits non-zero on `query`.

The lock schema is owned by `_lock.py`; the runtime check by `cli.py`.
