# Chat lat — 대화형 저작 + 코퍼스 검색 (메인 페이지)

> 모듈 목적: `/`(메인) 채팅에서 대화로 백서를 **생성/증분**하고 코퍼스를 **검색**한다.
> vLLM(OpenAI 호환)을 config 로 잡고 미설정/실패 시 mock 폴백 (플레이북 §8).
> 위키가 켜져 있으면 같은 화면에 **위키 모드**('위키에 묻기')가 있다 — 서버는 [[wiki#Query]](mock 폴백 없음).
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
| FE 스트림 클라이언트 | [[src/features/chat/api.ts#streamChat]] · [[src/features/chat/api.ts#streamWikiQuery]] (SSE 파서 하나) |
| FE UI (메시지/도구 카드 · 모드) | [[src/features/chat/ChatView.tsx]] |
| 위키 답의 꼬리 (각주 · 남기기 · 질문) | [[src/features/chat/WikiAnswer.tsx#WikiAnswerActions]] · `WikiCitationList` |
| 페이지 (메인/보조) | `src/pages/Chat.tsx` (index) · `src/pages/Help.tsx` (`/help`) |

## Endpoints

| 메서드 · 경로 | 권한 | 반환 |
| --- | --- | --- |
| `POST /api/v1/chat` | editor | `text/event-stream` — tool_call·tool_result·token·error·done |

body: `{messages: [{role:'user'\|'assistant', content}]}` (1~50개).

위키 모드는 `POST /api/v1/wiki/query`(reader · 20/분 · 말 20개까지) · `POST /wiki/fileback` · `POST /wiki/questions` — [[wiki#Query]] ·
[[wiki#Fileback]].

## 위키 모드

| 무엇 | 어떻게 |
| --- | --- |
| 켜짐 | 입력창 위 '백서 만들기 · 위키에 묻기' 고르기 — `useWikiEnabled()`(`/wiki/health`)가 켜졌을 때만. 스트림 도는 동안은 못 바꾼다 |
| 앞 대화 | 말마다 모드를 달고, 보낼 때 **같은 모드의 빈 말 아닌 것만**(위키는 끝 20개). 백서 답이 위키 물음의 앞 대화로 섞이지 않는다 |
| 프레임 | 도구 카드 셋(`wiki_index` · `wiki_search` · `wiki_read`) · `token` · `citation`(답의 `[n]` 을 그 문서로 잇고 아래에 근거 목록 — 문서 · 절 · 원천) · `miss` · `done` |
| 위키에 남기기 | 각주 단 답만(`done.cited > 0`) — 결과(해결됨 · 일부 · 모름)를 골라 `/wiki/fileback`, 각주는 `{n, slug, block_id}`, 범위는 `done.scope`(읽은 근거 모두 — 각주를 덜 단 답도 새지 않는다). 각주 없는 답은 '남기지 않는다' |
| 질문으로 남기기 | MISS 면 `/wiki/questions`(`query_miss` — 나만 본다) |
| 없음 | 오류 · 시간 제한(`done.timeout`) · 묻기 LLM 없음(`done.llm = unset`)이면 꼬리 행동이 없다 |

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
- **색 클래스** — Tailwind 에는 `smsg-{50…900}` 만 있다. `smsg-gray-*` · `smsg-blue-*` · `smsg-surface` 는 `styles/tokens.css` 의 CSS 변수라
  `bg-[var(--smsg-gray-050)]` 꼴로 쓴다(어두운 화면에서 저절로 바뀐다). 클래스 이름으로 쓰면 CSS 가 없어 밝은 화면에서 내 말풍선이
  흰 글자만 남았다(10-24 고침). `pages/Help.tsx` 에는 아직 그 꼴이 남아 있다.
