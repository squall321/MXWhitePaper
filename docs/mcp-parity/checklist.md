# MCP 파리티 체크리스트 (그림 전송 포함)

## 서버 (API)
- [ ] `POST /api/v1/uploads/image/from-url` — SSRF 가드 + URL fetch(≤20MB) → 기존 이미지 파이프라인 → {image_id, urls, deduped}
- [ ] config: `image_from_url_max_bytes` (기본 20MB)
- [ ] pytest: from-url 정상 / 사설IP 차단 / 비이미지 거부 / 대용량 거부

## MCP 도구 (이미지 전송 파리티)
- [ ] `upload_image_from_url(url)` — 위 엔드포인트 호출
- [ ] `upload_image_base64(filename, data_base64)` — 작은 이미지 base64 (≤256KB), 기존 init/put/finalize 재사용
- [ ] `extract_pptx_images(path)` — pptx 에서 이미지만 추출 → image_id 리스트
- [ ] `upload_image(path)` 유지 (Claude Code)
- [ ] mcp/tests: from-url(live, mock 서버), base64(live), extract(live) — 정리 포함

## Claude skill
- [ ] `dist/llm-docx-toolkit/mcp/skill/mxwp/SKILL.md` — 도구 목록 + 워크플로 + 항상-초안 + 이미지 3경로 안내

## 문서
- [ ] mcp/README.md — 이미지 전송 3경로 + skill 안내 추가
- [ ] docs/lat/storage.md — from-url 엔드포인트 1줄

## 검증
- [ ] api pytest 전체 + mcp tests + 바이너리 재빌드 + stdio tools/list 신규 도구 노출
- [ ] commit + push + archive

## HTTP transport 파리티 (이미지-파리티 다음 단계)
> cae00 는 오프라인이 아님 (TLS-intercept) — HTTP MCP 서버 호스팅 가능. RA 와 동등화.
- [ ] mxwp-mcp 에 `--http` 모드 (FastMCP streamable-http) 추가, stdio 와 공존
- [ ] 요청별 Authorization Bearer 헤더 → 토큰 (env 대신 per-request) — RA `_forward_headers` 미러
- [ ] systemd 서비스 템플릿 (infra/systemd 또는 deploy)
- [ ] in-app UI: `claude mcp add --transport http <url> --header "Authorization: Bearer <tok>"` 명령 제공
- [ ] mcp/README: HTTP 등록 절 추가
