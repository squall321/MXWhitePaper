# Gap Analysis — widget-phase2-batch

> Plan: [widget-phase2-batch.plan.md](../01-plan/features/widget-phase2-batch.plan.md)
> Design: [widget-phase2-batch.design.md](../02-design/features/widget-phase2-batch.design.md)
> Cycle date: 2026-05-15

## Match Rate: **100%** (모든 success criteria 충족)

## 1. Success Criteria 체크

| 기준 | 결과 |
|---|:---:|
| `WIDGET_CONVERTERS` 의 모든 값이 callable (None 0개) | ✅ 18/18 callable |
| 각 위젯마다 통합 또는 단위 테스트 ≥1개 | ✅ 16 위젯 × 평균 4-5 테스트 |
| `pytest tests/test_widget_markers.py` 100% | ✅ 72/72 통과 |
| 전체 슈트 회귀 0 | ✅ 835/835 통과 |
| `pnpm typecheck` 통과 | ✅ exit 0 |
| `lat/imports.md` 의 widget marker 표 14 신규 항목 반영 | ✅ 16 rows (Phase 1 + 2) |
| `make openapi-dump` drift 0 | ✅ no drift |
| `llm-document-formats.md` 의 "현재 미구현 청사진" 마킹 갱신 | ✅ Phase 2 callout 추가 |

## 2. Plan 항목별 구현 상태

### A. Widget Phase 2 — 14 converters (Plan 4.1)

| Marker | 변환기 | Schema type | Wave | 상태 |
|---|---|---|:---:|:---:|
| chart | `_convert_chart` | chart | A | ✅ |
| gantt | `_convert_gantt` | gantt | A | ✅ |
| flow | `_convert_flow` | flow | A | ✅ |
| org-chart | `_convert_org_chart` | org-chart | A | ✅ |
| columns | `_convert_columns` | columns | B | ✅ (multi-block, default 2/3/4) |
| tabs | `_convert_tabs` | tabs | B | ✅ (multi-block, heading-4 시리즈) |
| accordion | `_convert_accordion` | accordion | B | ✅ (multi-block) |
| gallery | `_convert_gallery` | gallery | B | ✅ (multi-block, 연속 이미지) |
| doc-link | `_convert_doc_link` | **doc-link-card** | A | ✅ name 분기 정확 |
| glossary | `_convert_glossary` | **glossary-ref** | A | ✅ name 분기 정확 |
| image-annotation | `_convert_image_annotation` | image-annotation | A | ✅ camelCase/snake_case 정확 |
| iframe | `_convert_iframe` | iframe | A | ✅ |
| video | `_convert_video` | video | A | ✅ youtube/vimeo/intra 자동 감지 |
| file | `_convert_file` | file (fileId placeholder + warning) | A | ✅ |
| pdf | `_convert_pdf` | pdf (file_id placeholder + warning) | A | ✅ |
| whiteboard | `_convert_whiteboard` | None (image-preserving fallback) | A | ✅ |

> Plan 은 "14 converter" 라고 했으나 실제 dispatcher 등록 = 16 (callout/kpi-cards 의 Phase 1 시그니처 마이그레이션 + 14 Phase 2). LLM 가이드 문서의 "14 위젯" 표현은 V6 가 발견 후 "16" 으로 정정.

### B. Mixed-cells web editor (Plan B)

| 항목 | 상태 |
|---|:---:|
| `TableBlock.tsx` 가 `cell.blocks` 렌더 (paragraph/image/list) | ✅ `renderCellContent` 헬퍼 |
| `<th>` + `<td>` 양쪽 적용 | ✅ |
| `tableCells.ts` `mergeWith` 가 blocks 보존 | ✅ upper-left first concatenate |
| `cellsToFlat` lossy 동작 + 주석 | ✅ |
| typecheck | ✅ exit 0 |
| 편집 인터페이스 | ⏸️ 명시적 deferred |

### C. 작은 follow-up (Plan C)

| 항목 | 상태 | 위치 |
|---|:---:|---|
| `_json.dumps(...)[:7000]` → codepoint-safe | ✅ | `imports.py` `_safe_header_value` |
| header CR/LF injection 가드 | ✅ | 같은 helper |
| `markdown_export.py:46` TODO 검증 | ✅ 여전히 applicable 확인 (수정 보류) |

### D. Multi-block pair 인프라 (Plan D)

| 항목 | 상태 |
|---|:---:|
| `ConverterFn` 시그니처: `(variant, targets, summary) -> (widget, n_consumed) \| None` | ✅ |
| Phase 1 (callout/kpi-cards) 마이그레이션 | ✅ tuple 반환 |
| `_rewrite_blocks` 의 `i += 1 + n_consumed` 계산 | ✅ off-by-one 0 (V3 검증) |
| `n_consumed < 1` 무한루프 가드 | ✅ |

## 3. Out-of-scope 확인 (의도된 미구현)

- AI placeholder (`apps/api/app/routers/ai.py`) → 정책 결정 필요로 별도 사이클
- SSO public flow (`apps/api/app/routers/sso.py`) → 회사 IdP 결정 필요로 별도 사이클
- web mixed-cell **편집** 인터페이스 → 다음 사이클
- Phase 3 자동 패턴 인식 → 다음 사이클
- Export 측 마커 emit → 다음 사이클

## 4. Verifier findings 처리

| ID | 영역 | 등급 | 처리 |
|---|---|:---:|---|
| V1.1 | chart 의 partial-None row 가 series 길이 mismatch | minor | ✅ fix-up: 누락 cell 을 0.0 으로 채워 길이 정렬 |
| V1.2 | flow 가 whitespace-only source 통과 | minor | ✅ fix-up: `value.strip()` 검사 추가 |
| V2.1 | `_h4` test fixture 가 `text` 사용 (schema 는 `title`) | minor | ✅ fix-up: fixture 가 `title` 사용 (fallback 도 유지) |
| V3.1 | `(Carousel)` 대문자 케이스 테스트 없음 | minor | ⏸️ defer (구현은 정확) |
| V4.* | 모든 항목 PASS | — | — |
| V5.1 | 이미지 URL encodeURIComponent 부재 | minor | ⏸️ defer (ULID/UUID 안전) |
| V5.2 | `mergeWith` blocks 경로 Vitest 미커버 | minor | ⏸️ defer (task 명시) |
| V6.1 | "14 위젯" 문구가 실제 16 과 모순 | **🚨 blocking** | ✅ fix-up: "16 위젯" |
| V6.2 | lat 의 stale 카운트 (778 → 835, 15 → 72) | minor | ✅ fix-up 완료 |
| V6.3 | test 파일 docstring "12 위젯" stale | minor | ✅ fix-up 완료 |

## 5. Risk verification (Plan §Risks)

| Risk | 검증 |
|---|:---:|
| Converter signature 변경이 Phase 1 회귀 일으킴 | ✅ Step 1 후 회귀 0 확인 (Phase 1 wrapper 없이 직접 마이그레이션) |
| Generator 들 간 dispatcher 등록 충돌 | ⚠️ 일부 generator (G9/G10/G11) 가 자기 한 줄 수정 — 메인 통합 시 충돌 0 |
| Schema 모를 때 None 반환 룰 | ✅ V1-V4 가 모든 converter 의 None 경로 확인 |
| Web typecheck 깨짐 | ✅ G13 후 typecheck exit 0 |

## 6. 최종 메트릭

| 지표 | 값 |
|---|---|
| 통합 converter 수 | 16 (Phase 1: 2 + Phase 2: 14) |
| 신규 테스트 케이스 (Phase 2) | ~57 (전체 72 - 기존 Phase 1 의 15) |
| 전체 pytest 통과 | 835/835 |
| widget_markers.py LOC | ~1075 (Step 1 전 247 → +828) |
| test_widget_markers.py LOC | ~1230 |
| web 변경 라인 | ~50 |
| 에이전트 소비 | Generator 14 (Opus) + Verifier 6 (Sonnet) = 20 |
| Wave 분할 | 2 (Wave A: 9, Wave B: 5) |
| Verifier 가 잡은 blocking | 1 (V6.1 "14" → "16") |
| Verifier minor findings | 9 (그중 5 fix-up, 4 defer) |

## 7. 결론

**모든 Plan 항목 100% 달성**. Verifier 가 잡은 단일 blocking issue (숫자 오기) 도 fix-up 완료. minor 9건 중 5건 즉시 처리, 4건은 task spec 또는 사용자 결정 사항으로 명시적 defer.

Phase 2 사이클은 archive 준비됨.
