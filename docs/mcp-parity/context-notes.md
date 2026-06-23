# MCP 파리티 컨텍스트 노트 (mxwp-mcp ↔ ReportArchive)

> 목표 — mxwp-mcp 를 ReportArchive MCP 수준으로, **그림 전송 포함** 동등하게.
> RA 레퍼런스: `~/claude/ReportArchive/mcp_server/`.

## 핵심 설계 결정

- **이미지 전송 3-경로를 RA 와 동형으로 맞춘다**
  - `upload_image_from_url(url)` — 서버가 직접 URL fetch → MinIO. RA `upload_from_url` 미러.
    바이트가 모델/클라이언트를 안 거쳐 크기 제약 없음. **SSRF 가드 필수** (사설/내부 IP 차단).
  - `upload_image_base64(filename, data_base64)` — 작은 이미지(≤256KB) base64. RA `upload_file` 미러.
    Claude Desktop 은 임의 로컬 경로를 못 읽으므로 base64 가 Desktop 의 유일한 로컬 경로.
  - `upload_image(path)` — 기존 유지. Claude Code(파일시스템 접근) 용.
- **extract_pptx_images(path|url)** — RA 미러. pptx 안의 그림만 분해해 image_id 리스트.
  MXWP 는 import_file 이 통째 변환하므로, "그림만" 뽑는 별도 도구를 추가.
- **Claude skill 추가** — `dist/llm-docx-toolkit/mcp/skill/mxwp/SKILL.md`. RA SKILL.md 처럼
  도구 목록 + 워크플로 + 항상-초안 원칙. allowed-tools `mcp__mxwp*`.
- **transport (HTTP) 도 파리티 대상** — RA 는 streamable-http(원격 register-once). MXWP 는
  stdio 바이너리만 있었음. **정정 (2026-06-23)**: cae00 는 *오프라인이 아니라* corp
  TLS-intercept 환경이다 — 빌드 시 npm/Docker-Hub pull 만 깨지고 **런타임 네트워크는 정상**.
  따라서 HTTP MCP 서버(Python, npm 무관)를 cae00 에서 호스팅 가능. stdio 를 택한 이유였던
  "오프라인" 전제는 틀렸음. HTTP transport 를 파리티로 추가한다 — 같은 mxwp-mcp 에
  `--http`(streamable-http) 모드 + 요청별 Bearer 헤더→토큰 forwarding (RA `_forward_headers`
  미러) + in-app UI 가 `claude mcp add --transport http` 명령 제공 + systemd 템플릿.
  stdio(로컬 바이너리)와 HTTP(호스팅) 둘 다 지원 — 사용자는 register-once 로 더 편해진다.
  단 이미지-파리티 워크플로(server.py/api_client.py 수정 중)와 파일 충돌 피해 그 *다음* 단계로.

## 왜 서버 엔드포인트가 필요한가

`upload_image_from_url` 은 서버가 URL 을 받아야 한다 (RA 의 `/api/files/from-url`).
MXWP 신규: `POST /api/v1/uploads/image/from-url {url}` — SSRF 가드 → 기존
`upload_service._process_image_bytes` + `_put_permanent_objects` + `_insert_image` 재사용 →
`{image_id, urls, deduped}`. base64 도 같은 파이프라인 재사용.

## 함정

- SSRF — http/https 만, 사설대역(10/172.16-31/192.168/127/169.254/::1) + DNS rebinding 주의.
- 크기 캡 — from-url 은 응답 스트림에 상한(예: 20MB) 둬서 메모리 폭주 방지.
- base64 캡 — RA 는 256KB. 동일 적용.
- 이미지 외 파일(FileBlock) 은 이번 범위 밖 (이미지 전송에 집중).
