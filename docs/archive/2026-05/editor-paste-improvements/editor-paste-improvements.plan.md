# Plan — editor-paste-improvements

> 에디터 붙여넣기 (paste) UX 개선. plain text 의 계층 목록/헤딩/문단을
> DocumentJSON 블록으로 자동 분해한다.

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| **Problem** | plain text 를 붙이면 `1. ` 번호목록·`- ` 불릿·들여쓰기 계층·여러 문단이 전부 무시되고 한 덩어리 paragraph 로 들어간다. 사용자가 일일이 블록을 쪼개야 한다. HTML 붙여넣기는 `htmlToBlocks` 가 처리하지만, 메모장·터미널·코드 등에서 온 plain text 는 무대책. |
| **Solution** | `htmlToBlocks` 의 짝이 되는 순수 함수 `textToBlocks(text)` 신규 — plain text 를 분석해 list/heading/paragraph 블록 배열로 변환. SimpleStackEditor·InlineTextBlockEditor 의 paste 핸들러가 이걸 호출. 테이블 paste 의 탭/콤마 정규화는 이미 `csv-paste.ts` 가 처리 — 검증만. |
| **Function · UX · Effect** | Word 의 번호 목록을 헤딩 아래 붙이면 list 블록 (nested depth) 으로 자동 펼쳐짐. 여러 문단을 붙이면 각각 paragraph 블록. `# `/`## ` markdown 헤딩도 heading 블록. InlineText 안에서도 여러 줄 paste 시 블록 분해. |
| **Core Value** | "복사 → 붙여넣기" 한 번으로 구조가 보존된다. 외부 문서를 옮겨오는 마찰이 크게 줄어든다. |

## 1. Overview

### 1.1 Purpose

plain text 붙여넣기를 구조 인식하도록. 4 가지 (사용자 확정):
1. 계층 목록 (`1. ` `- ` `* ` `•` + 탭/공백 들여쓰기) → list 블록 (nested).
2. 여러 줄/문단 → paragraph 블록 여럿. markdown 헤딩 (`# `~`#### `) → heading 블록.
3. 테이블 블록 paste 의 탭/콤마 구분자 일관성 — 검증 (이미 csv-paste 가 정규화).
4. InlineTextBlockEditor 안에서 multi-line/목록 paste → 블록 분해 (parent 위임).

### 1.2 Out of Scope

- markdown 전체 파서 (링크 `[](){}`, 강조 `**`, 코드펜스 등) — 헤딩/목록/문단만.
  단, 인라인 강조는 기존 HTML paste 경로가 담당하므로 plain text 에선 무시.
- 표를 plain text 로 붙이는 것 — 이미 `looksLikeCsv` 분기가 처리.
- 이미지/첨부 paste — 기존 ImageDropzone 경로 유지.

### 1.3 Decisions (사용자 확정)

- 4 아이템 모두 이번 사이클.
- list 의 depth 표현은 기존 컨벤션 (`"  "` 2칸 prefix per depth) 을 따른다 —
  `htmlToBlocks` 의 `collectListItems` 와 동일하게.
- 테이블은 이미 동작 → 회귀 테스트만 추가.

## 2. Functional Requirements

### 2.1 `textToBlocks(text)` — plain text → 블록 (신규 순수 함수)

위치: `apps/web/src/features/editor/paste/textToBlocks.ts`

입력: clipboard 의 `text/plain` 문자열.
출력: `{ blocks: Block[] }` — `htmlToBlocks` 와 같은 형태.

변환 규칙 (줄 단위 스캔):

| 줄 패턴 | 결과 |
| --- | --- |
| `1. ` `1) ` `1) ` 등 번호 prefix | number list item |
| `- ` `* ` `• ` `· ` bullet prefix | bullet list item |
| `[ ] ` `[x] ` checkbox prefix | check list item |
| 줄 앞 탭 / 2·4칸 공백 | 들여쓰기 depth (item prefix `"  "` × depth) |
| `# ` ~ `#### ` (markdown ATX) | heading-1 ~ heading-4 블록 |
| 빈 줄 | 블록 경계 (목록/문단 끊김) |
| 그 외 텍스트 줄 | paragraph 블록 (연속 줄은 한 문단으로 합침? — 빈 줄로만 분리) |

연속된 같은 style 의 list item 은 **하나의 list 블록**으로 묶음. style 이 바뀌면
(번호↔불릿) 새 list 블록. 들여쓰기는 depth prefix 로.

엣지: 한 줄짜리 plain text 거나 패턴이 전혀 없으면 → paragraph 1개 (현재 동작 유지).

### 2.2 SimpleStackEditor onPaste 분기 추가

`apps/web/src/features/editor/components/SimpleStackEditor.tsx` 의 `onPaste`:
- 현재 분기: 1) JSON 블록배열 → 2) rich HTML → 3) CSV→테이블 → 4) URL → fallthrough.
- **새 분기 3.5** (CSV 와 URL 사이): plain text 가 list/heading/multi-paragraph
  구조를 가지면 `textToBlocks` 로 변환해 insert.
  - 구조 판정 헬퍼 `looksLikeStructuredText(text)` — list prefix 가 ≥1 줄,
    또는 markdown heading, 또는 빈 줄로 구분된 ≥2 문단.
  - 구조 없으면 (단순 한 줄/한 문단) 기존 fallthrough 유지.
- CSV 분기가 먼저라 표 모양 텍스트는 그대로 표로. 목록과 표는 패턴이 달라 충돌 X.

### 2.3 InlineTextBlockEditor paste 개선

`apps/web/src/features/editor/components/InlineTextBlockEditor.tsx` 의 `onPaste`:
- 현재: `text/html` 없으면 브라우저 기본 (단일 문단).
- 개선: `text/html` 이 없고 `text/plain` 이 구조적 (multi-line/목록) 이면
  `textToBlocks` 로 변환 → 기존 `mxwp:paste-multi-blocks` 이벤트로 parent
  section 에 위임 (HTML multi-block 위임과 동일 경로 재사용).
- 단일 줄 plain text 는 기존대로 inline 삽입.

### 2.4 테이블 paste 검증

`csv-paste.ts` / `tsvPaste.ts` 가 이미 탭·콤마 둘 다 정규화 (`string[][]`).
이번엔 코드 변경 없이 **회귀 테스트만 보강** — TSV/CSV 입력이 동일 테이블
구조로 들어가는지, 혼합 케이스 (탭+콤마) 에서 delimiter 추론이 맞는지.

## 3. Non-Functional Requirements

| 항목 | 수준 |
| --- | --- |
| 순수성 | `textToBlocks` 는 DOM·fetch·전역 상태 없는 순수 함수 (단위 테스트 쉬움). |
| 성능 | 줄 단위 1-pass 스캔 — 수천 줄 paste 도 즉시. |
| 안전 | plain text 라 XSS 무관. ULID 는 각 블록 fresh. |
| 회귀 | 기존 paste 경로 (HTML/CSV/URL/JSON블록) 무변경 — `textToBlocks` 는 새 분기로만 진입. |
| 보수성 | 구조 판정 (`looksLikeStructuredText`) 은 보수적 — 애매하면 기존 단일 문단 동작. |

## 4. 데이터 모델 영향

없음. 기존 블록 타입 (`list`, `heading-1~4`, `paragraph`) 만 생성. list depth 는
기존 `"  "` prefix 컨벤션.

## 5. 작업 분해

| # | 작업 | 파일 |
| --- | --- | --- |
| 1 | `textToBlocks` + `looksLikeStructuredText` 순수 함수 | `paste/textToBlocks.ts` (신규) |
| 2 | SimpleStackEditor onPaste 분기 3.5 | `components/SimpleStackEditor.tsx` |
| 3 | InlineTextBlockEditor onPaste 개선 | `components/InlineTextBlockEditor.tsx` |
| 4 | 테이블 paste 회귀 테스트 | `extensions/__tests__/csv-paste.test.ts` (보강) |
| 5 | `textToBlocks` 단위 테스트 | `paste/__tests__/textToBlocks.test.ts` (신규) |

## 6. 테스트 전략

| 테스트 | 케이스 |
| --- | --- |
| `textToBlocks` 단위 | 번호목록 / 불릿 / 체크박스 / nested 들여쓰기 / markdown 헤딩 / 여러 문단 / 혼합 / 빈 줄 경계 / 단일 줄 (paragraph 1개) |
| SimpleStackEditor | 구조적 텍스트 paste → 블록 여럿 삽입, 단순 텍스트 → 기존 동작 |
| InlineText | multi-line plain text paste → multi-block 이벤트 발생 |
| csv-paste 회귀 | TSV·CSV 동일 결과, 탭/콤마 혼합 delimiter 추론 |

## 7. 배포 / Rollback

순수 FE. 이전 커밋 revert 로 끝. 데이터 영향 없음.
