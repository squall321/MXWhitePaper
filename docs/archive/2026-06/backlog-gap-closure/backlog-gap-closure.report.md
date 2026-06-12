# backlog-gap-closure 완료 리포트

> PDCA cycle 완료: 2026-06-12 · commit `2b7e1fa` · match rate 100% · 5월 백로그 HIGH/MED 전 항목 종결

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| 문제 | 5/18-19 백로그의 사용자 가치 항목 (Spreadsheet UX, Gantt UI) 과 MED 잔여가 3주간 미정리 — 일부는 이후 사이클에서 이미 해소됐는지조차 불명 |
| 해결 | 5-scout gap 매트릭스로 "요구 vs 현재 구현" 실측 → 진짜 잔여 7건만 4트랙 병렬 구현 |
| 기능/UX 효과 | 엑셀에서 표 복사→붙여넣기, 수식 자동완성, 행/열 중간 삽입, Gantt bar 드래그·슬라이더·정렬 |
| 핵심 가치 | scout-first 로 중복 구현 0 — DONE 판정 3건 (list-check/flow/safelist) 은 코드 안 만지고 종결 |

## Gap 매트릭스 (scout 실측)

| 백로그 항목 | scout 판정 | 조치 |
| --- | --- | --- |
| H2 Spreadsheet 5요구 | 2 DONE / 3 MISSING | 중간 삽입 UI + 멀티셀 paste + formula 자동완성 구현 |
| H3 Gantt 4요구 | 1 DONE / 2 PARTIAL / 1 MISSING | bar 드래그 + range 슬라이더 + 명시적 정렬 버튼 구현 |
| M1 list-check round-trip | DONE (H7 fix 기구현, 테스트 5종) | 테스트 헤더 주석 drift 만 정정 |
| M2 flow Mermaid | DONE (백로그 전제 stale — 템플릿/치트시트/미리보기 5/8-9 기구현) | 공식 문서 링크 1줄 |
| M1-0518 IframeBlock discriminator | **PARTIAL — 신규 결함 발견** | codegen pattern-2 silent skip fix |
| M3 spacer safelist | DONE (non-issue — dist CSS 에 .h-32 실증) | 작업 없음 |
| M3-0518 MD060 / M4 류 | 보류/obsolete | 백로그에 사유 기록 |

## 핵심 구현

- **Spreadsheet**: `pasteParse.ts` (TSV 우선/quote-aware CSV, 1x1 은 기본 동작), 자동완성은
  dropdown 열림 시 Enter/Tab/Arrow 를 셀 이동보다 먼저 intercept (키 충돌이 작업의 절반),
  중간 삽입은 기존 `insertRow(idx)`+`remapCells` 가 완성돼 있어 UI 버튼만 연결.
- **Gantt**: viewer `GanttBlockView` 에 optional `onTaskPatch` — prop 미지정 (일반 문서 뷰) 시
  read-only 불변, 에디터 프리뷰만 드래그 활성. 가장자리 8px=resize/몸통=move, pointerup 1회
  patch. 정렬은 **명시적 버튼** — 자동 정렬은 export/round-trip 의 task 순서를 암묵 변경하므로 기각.
- **codegen (가장 중요한 발견)**: pattern-2 정규식이 생성 코드 형태와 불일치해 **조용히 skip** —
  Block union 이 의도와 달리 smart union 으로 동작 중이었음. 정규식 교정 + pattern-1 앞으로
  이동 + 두 패턴에 `subn` count + stderr WARN 가드. `Block.model_fields['root'].discriminator
  == 'type'` 실측, 직렬화 경고 0, `pnpm -w schema:gen` idempotent.

## 핵심 인사이트

- **백로그는 신선도가 생명**: 3주 묵은 백로그의 6/12 항목이 stale (이미 구현/전제 변경).
  scout-first 가 중복 구현을 막았다 — 구현보다 정찰이 싼 작업 순서.
- **"경고가 사라짐" ≠ "고쳐짐"**: discriminator 경고는 우연히 (enum 정규화 + smart union
  exact-match) 사라진 것이었고 기제는 깨진 채였다. 후처리 패치에는 반드시 적용-건수 검증을.
- **viewer 에 편집 기능을 넣을 땐 optional prop**: GanttBlockView 의 onTaskPatch 패턴 —
  일반 뷰 회귀 0 을 구조적으로 보장.

## 검증

api pytest **1120 passed** (전체), web vitest 전체 pass (신규 55+: pasteParse 9, interactions 13,
ganttDrag/드래그 32+), tsc clean, schema:gen idempotent, i18n ko/en 키 동기 (13 passed).

## 잔여

- 백로그 LOW 항목 (calculator unit, video thumbnail, file 미리보기, accordion 펼침 정책 등) —
  기능 추가성 손질, 필요 시 별도 사이클.
