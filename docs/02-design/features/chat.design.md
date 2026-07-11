# 대화형 채팅 (agentic 저작 + 코퍼스 검색) — 설계

> 메인 페이지를 "대화로 백서를 만들고 코퍼스를 검색하는" 채팅으로 전환한다.
> 사용 설명은 보조 페이지(`/help`)로 내린다. vLLM 은 config/env 로 주소만 잡고
> 미설정/도달 실패 시 mock 폴백 — HWAX 포털 통합 플레이북 §8 + `triple_extractor` 정책 동일.

## 결정 (2026-07-10 사용자 확정)

1. **채팅 성격**: agentic — AI 가 도구로 DocumentJSON 문서를 생성/증분하고 기존 코퍼스를 검색·인용.
2. **LLM 연결**: env 스텁 + mock 폴백. `LLM_BACKEND=openai`(OpenAI 호환 = vLLM) + `LLM_BASE_URL` + `LLM_MODEL`.
   미설정이면 `mock` — 실 LLM 없이도 UI·도구 흐름이 end-to-end 동작.
3. **라우팅**: `/` = 채팅(메인), `/home` = 기존 위키 홈, `/help` = 사용 설명(보조).

## 백엔드 (`apps/api`)

| 파일 | 책임 |
|---|---|
| `core/config.py` | `chat_enabled`, `llm_backend`, `llm_base_url`, `llm_model`, `llm_api_key` 필드 추가 |
| `services/llm_client.py` | OpenAI 호환 `/chat/completions` 호출(도구 포함). 실패 시 예외 → 상위가 mock 폴백 |
| `services/chat_agent.py` | 시스템 프롬프트 + 도구 4종 + 에이전트 루프 + mock 에이전트. SSE 이벤트 async generator |
| `routers/chat.py` | `POST /api/v1/chat` → `text/event-stream`. auth=editor(문서 생성). dev 폴백=ai.py 미러 |

**도구 4종** (서비스 레이어 직접 호출, HTTP 왕복 없음):
- `search_corpus(query, limit)` → `meili_indexer.search` (role 필터 포함) → [{slug,title,snippet,url}]
- `get_document(slug)` → summary + 섹션 제목 목록
- `create_document(title, summary, sections[])` → `document_service.create_document` (DocumentJSON 서버조립·slug 자동)
- `append_section(slug, heading, paragraphs[])` → `document_service.replace_document` (ETag 재조회)

**SSE 이벤트**: `tool_call`(name,args) · `tool_result`(name,summary,link?) · `token`(최종 답변 조각) · `error` · `done`.

**mock 에이전트** (LLM 미연결): 사용자 메시지 의도 휴리스틱 — "작성/문서/올려/정리" → `create_document`,
그 외 → `search_corpus`. 실제 도구를 태워 end-to-end 를 시연. 응답 앞에 "(mock 모드)" 명시.

## 프론트 (`apps/web`)

| 파일 | 책임 |
|---|---|
| `features/chat/api.ts` | fetch + ReadableStream SSE 파서. `streamChat(messages,{onEvent,signal})` |
| `features/chat/store.ts` | zustand — 메시지 목록·스트리밍 상태 |
| `features/chat/ChatView.tsx` | 메시지 리스트 + 입력 + 도구 카드(문서 생성→링크, 검색→목록) |
| `pages/Chat.tsx` | 메인 페이지 래퍼 |
| `pages/Help.tsx` | 사용 설명(보조) |
| `main.tsx` | index→Chat, `home`→Home, `help`→Help. lazyLogged 등록 |
| nav | 로고/홈 링크가 `/`(채팅)이 되므로 `/home`(위키)·`/help` 진입점 추가 |

## Gotchas

- vLLM 은 OpenAI 호환 — `tools`/`tool_calls` 스펙 사용. mock 은 도달 실패/미설정 시 자동.
- 문서 생성 slug: `slugify(title)` → 충돌 시 `-<suffix>` 재시도. metadata 기본 division/confidentiality 는 settings 값.
- 채팅은 문서를 만들므로 editor 권한. dev 폴백(미인증=admin)에서 즉시 동작.
- 라우터 등록은 `main.py` 의 `ai_router` 뒤.

## 체크리스트

- [ ] config 필드 + `.env.example` 문서화
- [ ] llm_client (openai 호환) + mock 폴백
- [ ] chat_agent (도구 4종 + 루프 + mock)
- [ ] chat 라우터 + main.py 등록
- [ ] pytest (mock: create/search end-to-end)
- [ ] FE api/store/ChatView + Chat/Help 페이지
- [ ] main.tsx 라우팅 재편 + 네비 진입점
- [ ] mock end-to-end 브라우저 확인 · typecheck · lat 동기화(core/documents)
</content>
