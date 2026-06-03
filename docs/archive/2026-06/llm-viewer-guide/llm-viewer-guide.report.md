# llm-viewer-guide — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | G3 — LLM viewer 가이드 작성 (외부 LLM 이 DocumentJSON 을 *읽을 때*) |
| **Completion** | 2026-06-03 |
| **Match Rate** | 100% |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | LLM 토킷 가이드 3 종 (input-rules / widgets-via-api / document-formats) 모두 *작성* 방향. RAG 답변이나 Q&A 같은 *읽기* 시나리오에서 LLM 이 block 을 사람-가독으로 어떻게 풀어내야 하는지 표준 없음 |
| Solution | `docs/llm-viewer-guide.md` 신규 — 37 block 별 요약 규칙, Pivot/Slicer 별도 챕터, 인용 식별자 규칙, "절대 하지 말 것" + 자기-체크리스트 |
| Function/UX | 외부 LLM 이 같은 문서를 받아도 일관된 요약 / Q&A / 정확한 인용 |
| Core Value | 작성 ↔ 읽기 양방향 가이드 도달. LLM-driven 보고서 흐름 완결 |

## 변경

- `docs/llm-viewer-guide.md` 신규 — 9 chapter (빠른 요약 / 골격 / block 별 규칙 / PivotTable 6단계 / Slicer / 식별자 / 금지 / 체크리스트 / 관련 문서)
- 핵심 룰:
  - block id 8자 prefix 가 진실의 식별자
  - 숫자/표/차트/피벗은 *데이터* 로 읽고 *사람 단어로* 요약
  - 인터랙티브 widget (slicer/data-source) 의 *시점 의존성* 명시 의무
  - confidentiality 인용 의무
  - figure-index / spacer / hidden marker 무시 의무

## Defer / 후속

- chunker 의 source list 에 `llm-viewer-guide.md` 추가 (RAG 답변에 등장하도록) — 별도 cycle
- 영문 버전 — 본 가이드는 ko 우선

## 누적

| Cycle | commit |
|---|---|
| G1 (Pivot DataSource) | a8e7d68 |
| G2 (Slicer cross-widget) | 9d1d673 |
| **G3 (LLM viewer 가이드)** | 본 사이클 |
