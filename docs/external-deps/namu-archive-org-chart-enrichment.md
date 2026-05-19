# Namu_Archive 에 위임할 작업 — org-chart 데이터 채우기

> **이 문서는 MXWhitePaper 외부 프로젝트 (`/data/Namu_Archive`) 에 요청하는 일거리**.
> Namu_Archive 의 ETL 출력 (out/upload/*.json + *.docx) 을 풍부화 한 다음
> MXWhitePaper 가 다시 import. 본 mxwp repo 에서는 *작업 명세서* 만 보관.
>
> **새 세션 권장**: `cd /data/Namu_Archive && claude` 로 들어가서 이 문서 보고 진행.

---

## 발견 (mxwp 쪽에서 확인됨)

본 mxwp 사이트에 Namu_Archive bulk import (319 docx) 완료 후 *모든* doc 본문 끝에
의미 없는 `Widget: org-chart` placeholder paragraph 가 박혀 있었음 (315/318 doc).

### 원인 분석

1. Namu_Archive PLAN.md 에 따르면 *org-chart 는 marker 필수 widget* (autodetect 안 됨)
2. `widget-integrity-pass-*` 의 widget_markers 패턴 `Widget: <type> (variant)` 한 줄
3. Namu_Archive 의 export 단계가 *모든 docx 끝*에 `Widget: org-chart` 를 *visible* 텍스트로 박음
4. 그러나 *해당 marker 다음에 와야 할 실제 org-chart 데이터 (테이블, 노드 리스트 등) 가 없음*
5. 결과: mxwp import 가 marker 를 풀지 못하고 plain paragraph 로 흡수 → 본문 noise
6. mxwp 쪽에서는 `examples/namu-archive-bulk/strip-noise-blocks.py` 로 *제거* 만 함

### 데이터로 확인된 사실

- `entry_kind: family` 인 doc 45 개 — 시리즈/계열 문서 (예: "AMD/GPU/RX 5000 시리즈")
- title prefix 매칭 (`<family-title>/` 가 prefix) 으로 자식 발견 시도 → **318 doc 안에서 3 family 만 자식 발견** (`삼성 엑시노스/9 시리즈`, `퀄컴 스냅드래곤/8XX 라인업`, `퀄컴 스냅드래곤/S 시리즈` — 각 1 child)
- 즉 **318 doc 의 hierarchy 데이터가 거의 부재** — Namu_Archive ETL 단계에서 family-children 관계 추출 안 됨

## 사용자 의도

> "옵션 A2 를 해야하지 않을까 — 필요한 링크가 부족하면 더 찾아서 만들기까지 해야할 것 같은데"

즉:
1. family doc 들의 *자식* 정보를 Namu_Archive 측에서 추가 추출
2. 필요시 *추가 doc* 도 수집 (예: 안드로이드 9 파이, RX 5500 등 자식 후보가 318 안에 없으면 새로 수집)
3. org-chart marker 다음에 *실제 자식 리스트 (테이블 또는 노드 데이터)* 박기
4. 풍부화된 출력을 다시 mxwp 에 import → org-chart 가 실제 hierarchy 로 렌더

## Namu_Archive 측 작업 — Plan 초안

### Phase 1 — 진단

1. **HF parquet 의 본문 안에서 hierarchy 추출 시도**
   - 565k 문서 중 family doc 의 본문 텍스트 살피기
   - 본문에 자식 시리즈 / 모델명이 *나열* 되어있을 가능성 (테이블 또는 bullet list 패턴이 평문화 됐을 듯)
   - 패턴: `2010년에 XXX 출시`, `세부 모델: A, B, C` 같은 줄에서 자식 후보 추출
2. **out/sqlite 의 기존 mvp1 결과** 보고 추가 정보 있는지

### Phase 2 — 자식 후보 발굴

1. family doc 본문에서 *자식 title 후보* 추출 (LLM agent 또는 휴리스틱)
2. 후보 중 *HF parquet 에 실제 문서 있는지* 확인 → 있으면 같이 정제 + export
3. *없으면* — 그 시리즈의 child 정보를 family doc 의 메타로만 (자식 doc 생성은 X)

### Phase 3 — org-chart 데이터 박기

Namu_Archive `pipeline/export.py` 수정:
- family doc 인 경우만 `Widget: org-chart` 마커 박기 (concept/product 는 *마커 안 박기* — 현재 모든 doc 에 박는 게 root cause)
- 마커 다음에 *실제 자식 테이블* 또는 *노드 리스트* 박기 — mxwp 의 widget_markers 가 다음 block (table 또는 paragraph) 을 parse 해서 OrgChartBlock 데이터로 변환
- 정확한 마커 형식은 mxwp 의 `widget_markers.py` 와 docx_export 의 `_b_org_chart` 참고

### Phase 4 — 재 ETL → re-import

1. Namu 측에서 풍부화된 .docx + .json 재생성
2. mxwp 측에서 `bash examples/namu-archive-bulk/import-namu-archive.sh --go`
   - `on_conflict: overwrite` 로 변경 (기존 doc 덮어쓰기)
3. mxwp 검색 + 본문에서 org-chart 정상 렌더 확인

## mxwp 측에서 필요한 후속 작업 (Namu 작업 후)

- bulk.yml 의 `on_conflict: skip` → `overwrite` 로 임시 변경
- 재 import 후 다시 `post-link.py` + `strip-noise-blocks.py` (불필요한 noise 가 또 박혔으면)

## 참고 자료

| 파일 | 위치 | 용도 |
|---|---|---|
| Namu_Archive PLAN.md | `/data/Namu_Archive/PLAN.md` | 원본 ETL 계획 |
| Namu pipeline | `/data/Namu_Archive/pipeline/{export,classify,clean}.py` | ETL 코드 |
| Namu out | `/data/Namu_Archive/out/upload/*.docx + *.json` | 현재 출력 (이미 mxwp 에 import 됨) |
| mxwp widget marker spec | `/home/koopark/claude/MXWhitePaper/apps/api/app/services/widget_markers.py` | `Widget: <type>` 마커 + 다음 block 형식 |
| mxwp org-chart marker | `widget_markers.py` 의 `_b_org_chart_marker` (또는 유사) | 정확한 마커 + 데이터 형식 |
| mxwp LLM 입력 룰 | `/home/koopark/claude/MXWhitePaper/docs/llm-input-rules.md` §3.6 | org-chart docx 패턴 |
| mxwp 의 import 보고서 | mxwp commit `e640093` + `ac45e8b` | 첫 import 결과 학습 |

## 위험

| # | 위험 | 대응 |
|---|---|---|
| R1 | family 의 *자식* 정보가 HF 본문에도 부족 | 본문 LLM 추출 + 명시적 안 되면 그 family 는 org-chart 안 박기 |
| R2 | LLM 추출이 false positive (없는 자식 만듬) | dry-run + 수동 검증 또는 score threshold |
| R3 | mxwp 의 widget marker 형식이 정확히 어떤지 docs 명시 부족 | mxwp 의 `widget-roundtrip-strictness` archive 참고 + `widget_markers.py` 코드 직접 보기 |
| R4 | 재 import 시 기존 link/edit 손실 | bulk.yml `on_conflict: version` 으로 버전 보존 |

---

**작성**: 2026-05-19, mxwp 세션에서. Namu_Archive 새 세션 시작 시 본 문서 먼저 읽기.
