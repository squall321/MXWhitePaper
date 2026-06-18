# pdf-image-upload 완료 리포트

> PDCA cycle 완료: 2026-06-18 · commits `5921ae9` + `5cac82c` · match rate 100%
> PDF import 이미지 실제 MinIO 업로드 + (발견된) fastapi 핀 회귀수정

## Executive Summary

| 관점 | 내용 |
| --- | --- |
| 문제 | PDF import 의 이미지가 placeholder (dangling ULID) — file-import 사이클의 유일한 "절반만 된" 부분 |
| 해결 | docx 의 zip-preprocess 패턴을 PDF 판으로 이식 (fitz 추출→MinIO→sha→ulid 맵) |
| 부수 발견 | pymupdf 영구화 재빌드가 fastapi 0.137/starlette 1.3.1 을 끌어와 router introspection 회귀 — known-good 핀으로 수정 |
| 핵심 가치 | PDF 이미지가 resolvable (GET /images/{id} 200) + cross-doc dedup, 빌드 재현성 확보 |

## A1 — PDF 이미지 실업로드

docx/pptx 는 zip 의 `word/media/` 를 `_preprocess_zip_images` 로 사전 추출→업로드.
PDF 는 zip 이 아니므로 fitz 로 추출하는 PDF 판을 만들었다:

- `pdf_import.extract_pdf_image(doc, xref)` — `doc.extract_image` 로 **원본 임베드
  바이트** 추출. Pixmap 래스터화는 colorspace/alpha 에 따라 바이트가 흔들려 sha 가
  불안정 — preprocess 와 converter 가 같은 helper 를 써야 sha 일치하므로 단일 진입점.
- `_preprocess_pdf_images` (라우터) — `_preprocess_zip_images` 의 PDF 판:
  전 페이지 이미지 추출 → sha256 dedup → Pillow → MinIO put → DB INSERT → sha→ulid 맵.
  `import_pdf` 가 `_build_image_uploader` 주입.
- **기존 버그 수정**: converter 가 `res.get("id") or res.get("ulid")` 를 봤으나
  uploader 는 `{"image_id": ulid}` 반환 (키 불일치 → 항상 placeholder 였음). 원래
  pdf_import 작성 시 들어간 버그를 이번에 발견·수정.
- 검증: ImageBlock.imageId 가 `GET /images/{id}` **200** (resolvable, dangling
  아님 — docx 의 과거 404 버그가 PDF 엔 처음부터 안 생김), 재import 시 동일 id
  (cross-doc dedup). pdf tests 10 (extract_pdf_image / stub uploader / live resolvable).

## 부수 발견 — fastapi 핀 회귀 (내가 낸 것)

이전 "pymupdf 영구화" 작업에서 api.sif 를 재빌드했는데, api.def 의 `fastapi>=0.115`
가 **무핀**이라 재빌드 시 fastapi 0.137 / **starlette 1.3.1** (major 점프) 을 끌어왔다.
starlette 1.x 는 라우터 트리 구조가 바뀌어 `app.router.routes` introspection 이
깨진다 — `include_router(4-route)` 가 1개만 보이고, `test_presence` 의 SSE 라우트
검사가 실패. **런타임 라우팅 자체는 정상** (live API 235 paths 서빙, openapi 정상)
이라 처음엔 놓칠 뻔했다.

수정: known-good `fastapi==0.121.3` (starlette 0.50.0) 로 api.def + pyproject 핀.
재빌드 sif: create_app **303 라우트**, presence **5/5**, 전체 pytest **exit 0**.

## 핵심 인사이트

- **테스트 실패는 런타임 정상과 별개일 수 있다**: live API 가 멀쩡히 서빙해도
  introspection-기반 테스트가 깨지면 그건 진짜 신호 — 검증된 적 없는 major 의존성
  업그레이드의 canary. "live 되니까 OK" 로 넘기지 않은 게 회귀를 잡았다.
- **`>=` 무핀은 재빌드 회귀의 씨앗**: 컨테이너 재빌드마다 최신을 끌어와 major 가
  점프한다. 인프라 의존성은 known-good 핀 + 의도적 업그레이드가 원칙.
- **결정적 바이트 추출**: 같은 이미지를 두 경로(preprocess/converter)에서 뽑을 땐
  반드시 같은 helper — `doc.extract_image` (원본) 가 `Pixmap.tobytes` (래스터)보다
  sha 안정적.
- **격리 검증의 함정**: `apptainer exec` 는 $HOME 을 마운트해 host `~/.local` 가
  샌다. sif 내부 검증은 `--no-mount home --bind` 로. (`--no-home` 은 bind 도 끊음.)

## 검증

pdf tests 10, xlsx 9, presence 5/5, 전체 api pytest exit 0, create_app 303 라우트,
live PDF-with-image import → imageId resolvable 200 + dedup, openapi 235 paths,
fitz/openpyxl sif 베이크 (`--no-mount home` 격리 확인).

## 잔여

- 없음 (A1 종결). file-import 4포맷 (docx/pptx/xlsx/pdf) 모두 이미지 실업로드 완비.
- 운영: 새 api.sif (fastapi 핀 + pymupdf/fitz 베이크) 를 cae00 로 ship (`make ship`).
