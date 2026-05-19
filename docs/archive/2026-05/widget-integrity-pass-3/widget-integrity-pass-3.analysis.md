# Widget Integrity Pass 3 — Gap Analysis

> Cycle: widget-integrity-pass-3
> Date: 2026-05-19
> Analyzer: bkit:gap-detector → 1차 89% → G1+G2 패치 → 100%
> Method: lat-first + direct grep

## Match Rate: **100%** (after G1+G2 follow-up)

1차 gap-detector 결과 89% (테스트 누락 G1·G2). 권고대로 즉시 두 테스트 추가 → 모두 통과 → 사이클 closed.

## C1~C9 통과 여부

| # | 기준 | 결과 | 근거 |
|---|---|:---:|---|
| C1a | SpacerBlock schema enum에 xl | ✅ | `document.json:812` — `["sm","md","lg","xl"]`, default md, description에 128px |
| C1b | SpacerBlockEditor xl dropdown | ✅ | `SpacerBlockEditor.tsx:11,17,24,108` |
| C1c | spacer xl 테스트 갱신 (G1) | ✅ | `__tests__/SpacerBlockEditor.test.tsx:46,65` — dropdown text + size=xl→h-32+128px 케이스 추가 |
| C2 | list check round-trip 잠금 | ✅ | `test_docx_roundtrip.py` 끝부분 `test_list_check_roundtrip_known_limitation` + docstring known limitation L14-19 |
| C3 | image width fallback 의도 명시 | ✅ | `docx_export.py:890-895` "DO NOT remove without a data migration pass" 댓글. **plan의 "제거"를 design+do에서 "legacy 호환 위해 유지+명시"로 변경한 결정** — 의도된 차이 |
| C4a | blockDefaults helper | ✅ | `utils/blockDefaults.ts` (60 LOC, SSR-safe) |
| C4b | FormBlockEditor + QuizBlockEditor 통합 | ✅ | Form L32,61,303,318 / Quiz L31,54,301 |
| C4c | blockDefaults 단위테스트 (G2) | ✅ | `utils/__tests__/blockDefaults.test.ts` — 5 케이스 (load fallback, round-trip, partial merge, scope 격리, invalid JSON 안전). vi.stubGlobal로 localStorage mock |
| C5 | pydantic 경고 사라짐 | ✅ | `pyproject.toml:188-190` filterwarnings, BE pytest 시 "warnings summary" 출력 사라짐 검증 완료 |
| C6 | INDEX MD060 fix | ✅ | `docs/archive/2026-05/_INDEX.md:4` `| --- | :---: | --- | --- |` |
| C7 | 회귀 0 | ✅ | BE 168 + FE 1554/1554 (이전 1548 + 신규 6) |
| C8a | lat documents.md | ✅ | SpacerBlock 항목 xl 포함 + pass-3 N1 마크 |
| C8b | LLM rules | ✅ | §2.10 spacer 4 옵션 + pass-3 N1 노트 |
| C8c | dist 복제 md5 일치 | ✅ | `0078546ff5679bc05b91b294cfc48177` 양쪽 동일 |
| C8d | RAG chunks.jsonl 갱신 | ✅ | re-chunked, sha256 `4ef9fe93...`, BM25 `spacer xl 128` → top-1 hit |
| C9 | 보고서 | ✅ | 직접 수행 사이클이라 summary만, 본 analysis로 갈음 |

## 발견된 Gap

**없음.** G1+G2 follow-up으로 100% 통과.

## 추가 관찰 (의도된 차이)

1. **C3 fallback 유지** — Plan은 "fallback 제거"였으나 Design+Do에서 legacy 호환 위해 *유지+명시 댓글*로 변경. Plan §1.5 C3 텍스트와 약간 차이지만 acceptance 기준 통과.
2. **N5 filterwarnings 선택** — discriminator 시도 대신 메시지 prefix 매칭. 라이브러리 한계라 가장 실용적.
3. **테스트 환경 한계** — 본 프로젝트 vitest 가 node 환경 (jsdom 미설치). blockDefaults 테스트는 `vi.stubGlobal('window', ...)` 패턴으로 우회.
4. **사이클 자체 직접 수행** — 작은 cleanup 사이클이라 4분할 에이전트 불필요. ~2시간 직접 작업 + 25분 G1+G2 follow-up.

## 결론

matchRate **100%** → `/pdca report widget-integrity-pass-3` 직행.

## 후속 권고

1. spacer xl tailwind safelist 확인 — `h-32` 클래스가 빌드에 포함되는지 (production 빌드 시 verify)
2. (pass-4 후보) list check style round-trip *진짜 fix* — import 측 ☐ prefix detection 분기 추가
3. (pass-4 후보) spreadsheet 키보드 에디터, gantt UI — 단독 사이클로
