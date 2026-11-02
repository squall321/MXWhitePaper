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

## 2026-11-02 — upload_image_bytes (포털 hwaxportal-a5 요청 · figure_to_doc)

- **http 모드에만 싣는다.** 게이트웨이가 7일 보관한 그림(`fig_<ref>`)을 그 사람 위임 Bearer 로 올리는 서버 쪽 길이다. stdio(PC)에
  실으면 모델이 `upload_image_base64` 의 256KB 캡(모델 토큰 보호)을 비켜 가는 길이 된다 — 그래서 `local_tool` 의 거울 `gateway_tool`.
- **크기 캡은 API 하나(init 의 `IMAGE_MAX_BYTES`, 20MB).** 툴킷이 따로 캡을 두면 두 값이 어긋난다. init 이 PUT 전에 거부한다.
- **svg 거부.** API 가 Pillow 로 WebP 로 다시 굽는데 Pillow 는 svg 를 못 읽어 finalize 가 422 를 내고 staging 이 남는다.
  `extract_pptx_images` 가 svg 를 건너뛰는 것과 같은 까닭. 게이트웨이도 'PNG 로' 로 거부한다(포털 회신).
- **sha256 은 툴킷이 검사한다** — 게이트웨이 저장소 → MCP 사이에서 바뀐 바이트를 API 를 부르기 전에 잡는다. `upload_bytes` 가
  init 에 싣는 sha256 은 받은 바이트로 다시 계산한 값이라, 검사하지 않으면 다른 그림이 그 해시로 dedup 될 일은 없지만 잘못 온 그림이
  조용히 들어간다.
- **presigned PUT 은 MCP 프로세스가 한다.** 호출자는 MinIO 에 닿을 필요가 없다. API 의 `MINIO_PUBLIC_ENDPOINT` 는 start.sh 가 api
  인스턴스에 `http://127.0.0.1:<port>` 로 주고 MCP 는 같은 인스턴스 안에서 돈다(dev 확인: API 프로세스 env `http://127.0.0.1:9000`).
- **배포는 git 만.** 툴킷은 어떤 sif 에도 굽지 않는다 — 박스는 `/workspace/dist/llm-docx-toolkit` 체크아웃에서 돈다. cae00 은
  update-all 뒤 mxwp-mcp 재기동(서버가 server.py 를 뜰 때 한 번 읽는다). Drive 이미지 불필요.
- **live 시험은 dev 에서 skip 된다** — `051acc3` 이후 무토큰 admin 폴백이 닫혀 `_issue_live_token` 이 401. 사람 명의 토큰을 따로
  만드는 것은 이 세션 권한 밖이라(신원 승인 없음) 진짜 끝에서 끝은 포털 세션의 `figure_to_doc` 수락 시험으로 한다.
