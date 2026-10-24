# MCP 파리티 체크리스트 (그림 전송 포함)

> 칸 채움 2026-10-24 — 지은 뒤 비어 있던 칸을 코드 · 커밋으로 대조해 채웠다(LLM 위키 W0, `docs/llm-wiki/request.md` §3).
> 그림 전송은 `e4d31d6`, HTTP transport 는 `c216a25`.

## 서버 (API)
- [x] `POST /api/v1/uploads/image/from-url` — SSRF 가드 + URL fetch(≤20MB) → 기존 이미지 파이프라인 → {image_id, urls, deduped}
- [x] config: `image_from_url_max_bytes` (기본 20MB)
- [x] pytest: from-url 정상 / 사설IP 차단 / 비이미지 거부 / 대용량 거부 — `tests/test_uploads_from_url.py`(+ 리다이렉트 `test_ssrf_redirect.py` `9e1b5dc`)

## MCP 도구 (이미지 전송 파리티)
- [x] `upload_image_from_url(url)` — 위 엔드포인트 호출
- [x] `upload_image_base64(filename, data_base64)` — 작은 이미지 base64 (≤256KB), 기존 init/put/finalize 재사용
- [x] `extract_pptx_images(path)` — pptx 에서 이미지만 추출 → image_id 리스트
- [x] `upload_image(path)` 유지 (Claude Code)
- [x] mcp/tests: from-url(live, mock 서버), base64(live), extract(live) — 정리 포함 — `mcp/tests/test_image_tools.py`

## Claude skill
- [x] `dist/llm-docx-toolkit/mcp/skill/mxwp/SKILL.md` — 도구 목록 + 워크플로 + 항상-초안 + 이미지 3경로 안내

## 문서
- [x] mcp/README.md — 이미지 전송 3경로 + skill 안내 추가
- [x] docs/lat/storage.md — from-url 엔드포인트 1줄

## 검증
- [x] api pytest 전체 + mcp tests + 바이너리 재빌드 + stdio tools/list 신규 도구 노출 — pytest · mcp 시험은 `e4d31d6` 에 기록,
  바이너리 `bin/mxwp-mcp-linux` 는 07-06 재빌드, tools/list 는 2026-10-24 그 바이너리에 stdio 로 물어 확인(도구 29 — 새 셋 포함)
- [ ] commit + push + archive — commit · push 는 됐다(`e4d31d6` · `c216a25`). `docs/archive/` 에 이 사이클 기록이 없다

## HTTP transport 파리티 (이미지-파리티 다음 단계)
> cae00 는 오프라인이 아님 (TLS-intercept) — HTTP MCP 서버 호스팅 가능. RA 와 동등화.
- [x] mxwp-mcp 에 `--http` 모드 (FastMCP streamable-http) 추가, stdio 와 공존
- [x] 요청별 Authorization Bearer 헤더 → 토큰 (env 대신 per-request) — RA `_forward_headers` 미러
- [x] systemd 서비스 템플릿 (infra/systemd 또는 deploy) — `infra/systemd/mxwp-mcp-http.service`
- [x] in-app UI: `claude mcp add --transport http <url> --header "Authorization: Bearer <tok>"` 명령 제공 — `ApiTokens.tsx`
- [x] mcp/README: HTTP 등록 절 추가
