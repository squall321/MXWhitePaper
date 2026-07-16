# Chat lat — 대화형 저작 + 코퍼스 검색 (메인 페이지)

> 모듈 목적: `/`(메인) 채팅에서 대화로 백서를 **생성/증분**하고 코퍼스를 **검색**한다.
> vLLM(OpenAI 호환)을 config 로 잡고 미설정/실패 시 mock 폴백 (플레이북 §8).
> 연관 lat: [[core]] (auth/config), [[documents]] (create/replace), [[graph]] (검색은 meili).

## 데이터 흐름

```
FE features/chat/api.ts  ──POST /api/v1/chat (SSE)──►  routers/chat.py
   fetch+ReadableStream        require_editor           │ ctx{actor_id,email,role}
   프레임: tool_call/                                    ▼
   tool_result/token/         services/chat_agent.py: run()
   error/done                   ├ llm_client.is_live() → _run_llm (OpenAI tool-calling)
   ChatView.tsx 렌더            └ else                 → _run_mock (휴리스틱, 실 도구 시연)
                                     도구 4종 ──► document_service / meili_indexer 직접 호출
```

## 핵심 진입점

| 무엇 | 어디 |
| --- | --- |
| SSE 엔드포인트 (`POST /api/v1/chat`) | [[src/app/routers/chat.py#chat]] — editor, rate 20/min, dev 폴백(ai.py 미러) |
| 에이전트 루프 + mock + SSE 프레임 | [[src/app/services/chat_agent.py#run]] / `_run_llm` / `_run_mock` |
| OpenAI 호환 호출 (도구 포함) | [[src/app/services/llm_client.py#complete]] / `is_live` |
| 도구 4종 | `chat_agent._tool_search_corpus` / `_tool_get_document` / `_tool_create_document` / `_tool_append_section` |
| DocumentJSON 조립 (방어 정규화) | `chat_agent._build_documentjson` + `_normalize_sections/_paragraphs` |
| FE 스트림 클라이언트 | [[src/features/chat/api.ts#streamChat]] (SSE 파서) |
| FE UI (메시지/도구 카드) | [[src/features/chat/ChatView.tsx]] |
| 페이지 (메인/보조) | `src/pages/Chat.tsx` (index) · `src/pages/Help.tsx` (`/help`) |

## Endpoints

| 메서드 · 경로 | 권한 | 반환 |
| --- | --- | --- |
| `POST /api/v1/chat` | editor | `text/event-stream` — tool_call·tool_result·token·error·done |

body: `{messages: [{role:'user'\|'assistant', content}]}` (1~50개).

## 설정 (env, [[core]] Settings)

`CHAT_ENABLED`(기본 true) · `LLM_BACKEND`(mock|openai) · `LLM_BASE_URL`(예 `http://ip:port/v1`)
· `LLM_MODEL` · `LLM_API_KEY`. mock 이면 실 LLM 없이 도구 흐름 시연.

## Gotchas

- **도구는 서비스 레이어 직접 호출** (HTTP 왕복 없음): create=`document_service.create_document`,
  append=`replace_document`(ETag=`make_etag(id,version)`), 검색=`meili_indexer.search`(role 필터).
- **create_document 는 status='draft' 로 생성**된다 ([[documents]] insert_document). 검색·위키 목록에
  뜨려면 발행 필요 — `POST /api/v1/documents/{slug}/transition {"status":"published"}`.
  발행/편집 후 검색 반영은 이제 자동이다 (transition·run_post_save_hooks 가 reindex 전에
  `documents_flat_v` matview 를 refresh — 2026-07 fix). **다만 대량 백필**(예: 이미 draft 로
  쌓인 수십~수백 건을 한꺼번에 발행)은 `python -m app.scripts.reindex` (컨테이너 안, `.env` source)
  로 전체 재색인하는 게 빠르고 확실하다.
- **mock 폴백은 "출력 시작 전"에만** — `_run_llm` 이 프레임을 낸 뒤 실패하면 `started` 플래그로
  mock 재실행 대신 error+done 으로 닫는다 (이중 생성 방지).
- FE `renderText` 는 링크 스킴을 화이트리스트(내부 `/` · http/https)한다 — LLM 토큰의 `javascript:` 방어.
- slug 자동생성: `_slugify(title)` (한글은 `chat-doc` 폴백), 충돌 시 `-<hex>` 재시도.
