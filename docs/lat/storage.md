# Storage lat — 이미지 / 파일 업로드 + MinIO

> S3 호환 객체 저장 (apptainer 의 `mxwp_minio`) 위에 이미지 파이프라인을
> 얹은 레이어. 핵심: **sha256 dedup**, **presigned PUT 2-step**, **WebP 3 사이즈**,
> **EXIF 제거**.
>
> 연관 lat: [[imports]] (zip 안 이미지 pre-pass) · [[export]] (image_resolver) ·
> [[core]] (인증)

## Endpoints

| Method | Path | 인증 | 역할 |
|---|---|---|---|
| POST | `/api/v1/uploads/image/init` | editor+ | presigned PUT URL 발급 (단수 `image`) |
| POST | `/api/v1/uploads/image/finalize` | editor+ | upload 완료 → 이미지로 등록 |
| GET | `/api/v1/images/{identifier}` | reader+ | 이미지 메타 + URL 3개 (uploads 가 아니라 별도 `images` 라우터) |
| POST | `/api/v1/files/presign-put` | editor+ | 일반 파일 업로드용 presigned PUT |
| POST | `/api/v1/files/finalize` | editor+ | 일반 파일 완료 |
| GET | `/api/v1/files/{file_id}/download` | reader+ | 파일 다운로드 (서명 URL 리다이렉트) |

라우터: [[src/app/routers/uploads.py]] (이미지), [[src/app/routers/files.py]] (일반 파일).
공통 서비스: [[src/app/services/upload_service.py]].

## Buckets (MinIO)

| 키 (settings) | 기본값 | 용도 |
|---|---|---|
| `minio_bucket_images` | `mxwp-images` | 이미지 (영구) + staging |
| `minio_bucket_files` | `mxwp-files` | 일반 파일 |
| `minio_bucket_backups` | `mxwp-backups` | 스냅샷 (see [[snapshots]]) |
| `minio_bucket_exports` | (빈값 = files 재사용) | export artifacts |

MinIO 클라이언트는 [[src/app/storage/minio_adapter.py]] 에서 `internal_client()` /
`public_client()` 분리. internal 은 컨테이너 간 직접 호출 (`http://mxwp_minio:9000`),
public 은 외부 도메인 (`https://files.example.com`) — presigned URL 이 사용자
브라우저에 가야 하므로 public_client 가 서명.

## 이미지 업로드 2-step 흐름 ★

```text
FE                              API                              MinIO
 │                               │                                 │
 │── POST /uploads/images/init──►│                                 │
 │     {filename, mime, bytes}   │                                 │
 │                               │── ulid + presigned PUT URL ────►│ (uploads/<id>/...)
 │◄── {upload_id, put_url} ──────│                                 │
 │                                                                 │
 │── PUT (직접) ───────────────────────────────────────────────────►│
 │      (presigned URL, 15 분 유효)                                 │
 │                                                                 │
 │── POST /uploads/images/finalize ─►│                              │
 │     {upload_id}                   │                              │
 │                                   │── GET (staging) ────────────►│
 │                                   │◄── raw bytes ────────────────│
 │                                   │── Pillow process            │
 │                                   │── sha256 dedup chk          │
 │                                   │── PUT 3 WebP (perm/<sha>/…)─►│
 │                                   │── DELETE staging ───────────►│
 │                                   │── images INSERT             │
 │◄── {ulid, urls{thumb,view,orig}} ─│                              │
```

핵심 함수:
- `init_upload()` — [[src/app/services/upload_service.py#init_upload]]
- `finalize_upload()` — [[src/app/services/upload_service.py#finalize_upload]]
- `_process_image_bytes()` — [[src/app/services/upload_service.py#_process_image_bytes]]
- `_put_permanent_objects()` — [[src/app/services/upload_service.py#_put_permanent_objects]]

## 이미지 처리 파이프라인 (Pillow)

`_process_image_bytes(raw)`:

1. **EXIF strip** — 새 Image 에 paste → 메타데이터 미보존
2. **3 사이즈 생성** — `THUMB_MAX_WIDTH` / `VIEW_MAX_WIDTH` / 원본
3. **WebP 인코딩** — 모두 `.webp` (quality=`WEBP_QUALITY`, method=4)
4. **Dominant color** — 50×50 thumbnail → 채널 평균 → `#rrggbb` (FE 플레이스홀더용)
5. 결과: `{thumb_bytes, view_bytes, orig_bytes, width, height, dominant_color}`

상수 (모듈 상단):
- `THUMB_MAX_WIDTH` — thumbnail 가로 (리스트/카드용)
- `VIEW_MAX_WIDTH` — 본문 표시용
- `WEBP_QUALITY` — 인코딩 품질

## sha256 dedup ★

영구 객체 prefix: `_permanent_prefix(sha256)` →
`<sha256[:2]>/<sha256[2:4]>/<sha256>/`. 같은 sha 가 들어오면 객체를 다시
올리지 않고 기존 ULID 재사용.

찾기 흐름:
1. `finalize_upload()` 가 staging 객체 fetch 후 `hashlib.sha256(raw).hexdigest()`
2. `_find_image_by_sha256()` → 매치하면 그 row 반환 + 새 INSERT 생략
3. 매치 없으면 위 3-WebP 업로드 + `_insert_image()` INSERT

이 덕분에:
- 같은 그림을 여러 문서가 참조해도 객체는 1개
- docx/pptx import 시 동일 이미지가 여러 문서에 박혀 있어도 한 번만 저장

## images 테이블

| 컬럼 | 비고 |
|---|---|
| `id` | UUID PK (`gen_random_uuid()` default) |
| `ulid` | UNIQUE TEXT — Crockford ULID, DocumentJSON `ImageBlock.imageId` 가 참조 |
| `sha256` | unique — dedup 키 |
| `original_name` | 클라이언트가 보낸 파일명 (200자 컷) |
| `mime_type` | `image/png` 등 |
| `size_bytes` | 원본 raw 크기 |
| `width`, `height` | px |
| `dominant_color` | `#rrggbb` |
| `storage_keys` | JSON `{thumb, view, orig}` MinIO 키 |
| `uploaded_by` | user ULID |
| `created_at` | |

`_row_to_image()` 가 row → dict 변환 (`_public_urls_for_sha()` 로 URL 3 개 attach).

## 라우터 측 호출

### Direct upload (FE 가 직접)
[[src/app/routers/uploads.py#upload_image_init]] →
[[src/app/routers/uploads.py#upload_image_finalize]]. FE 가 init 으로 URL 받고
PUT 한 뒤 finalize. 일반적 패턴.

### Server-side bulk (imports)
[[imports]] 의 `_preprocess_zip_images()` 는 다른 경로 — staging 단계를
건너뛰고 raw bytes 를 *직접* `_process_image_bytes()` + `_put_permanent_objects()`
로 흘려보낸다. 그래서:
- presigned URL 발급 X
- `_insert_pending()` 안 함
- 이미지마다 즉시 commit (한 docx 안 다른 이미지의 실패가 성공한 것을 롤백 X)

### Round-trip mode
[[src/app/services/docx_roundtrip.py]] 에선 `image_uploader=None` 이라
[[imports]] 의 `_preprocess_zip_images()` 가 호출되지 *않고*, import 가 메모리에서
이미지를 잡아 export 로 직결. MinIO/DB 무접근.

## Presigned URL 만료

기본 15 분. settings:
- `upload_presign_ttl_seconds` (init 의 PUT URL)
- `download_presign_ttl_seconds` (downloads 의 GET URL)

만료된 staging 객체는 `_purge_expired_pending()` 가 정리 (cron 또는 manual).

## 일반 파일 (uploads ≠ images)

[[src/app/routers/files.py]] 는 이미지가 아닌 첨부 (PDF, ZIP 등) 용. 차이점:
- WebP 변환 안 함, 원본 그대로 저장
- 사용자별 rate-limit 적용 (`_check_rate_limit`)
- `files` 테이블 별도 (스키마는 [[apps/api/alembic/versions]] 참고)
- 다운로드는 `/files/{id}/download` → 서명된 GET URL 로 302 리다이렉트

## Gotchas

1. **WebP 만 저장** — 원본 PNG/JPG 는 저장되지 않음. 무손실 보존이 필요한
   경우 (예: 도면 원본) 이라면 별도 attachments 흐름을 쓰거나 정책 변경 필요.
2. **EXIF 제거**는 의도된 동작 — 위치/카메라 정보 누출 방지. 보존이 필요하면
   `_process_image_bytes()` 에서 strip 단계 skip 옵션 추가 필요.
3. **`storage_keys` 는 dict 직렬화** — old row 에 `{thumb: …}` 만 있고 view/orig
   누락이면 응답에서 missing key 가 나옴. migration 필요 시 [[src/app/scripts]]
   확인.
4. **MinIO 의 list_objects_v2 는 정렬 미보장** — `_fetch_staged_object()` 가
   `LastModified` 로 가장 최근만 사용 (한 upload_id 에 객체 1 개라 정상이지만
   재시도/장애로 여러 개 쌓이는 케이스 방어).
5. **dedup 충돌**: 두 클라이언트가 같은 sha 를 동시에 finalize → 첫 INSERT 후
   둘째는 unique violation. 현재는 둘째 caller 가 첫 row 를 재조회해 반환하는
   방어 코드 없음 — 매우 드물지만 race 가능. 필요 시 `ON CONFLICT DO NOTHING
   RETURNING` 으로 강화.
6. **internal_client() vs public_client()** — 둘이 다른 호스트네임이라
   internal 로 발급한 presigned URL 을 외부에서 못 씀. 헷갈리면 디버그 어려움.
7. **`uploaded_by` 는 hard FK** (`NOT NULL REFERENCES users(id)`) — 사용자
   삭제 시 ON DELETE 정책이 없어 row 가 남는 게 아니라 *사용자 삭제 자체가
   실패한다.* 사용자 정리 전에 images.uploaded_by 를 다른 사용자로 reassign
   해야 함.

## Settings

| 키 | 기본 | 의미 |
|---|---|---|
| `minio_endpoint` | — | 컨테이너 간 (e.g. `http://mxwp_minio:9000`) |
| `minio_public_endpoint` | — | presigned URL 의 호스트 (외부 도메인) |
| `minio_access_key`, `minio_secret_key` | — | 자격증명 |
| `minio_bucket_images` | `mxwp-images` | |
| `image_max_bytes` | — | 단일 이미지 사이즈 캡 |

> presign TTL (`_PRESIGN_TTL_SECONDS = 600`, 10 분) 과 region
> (`"us-east-1"`, AWS SDK 요구로 하드코딩) 은 환경변수가 아니라
> [[src/app/storage/minio_adapter.py]] 의 module-level 상수다. 변경하려면
> 코드 수정 필요.

## 테스트 지도

| 파일 | 무엇 |
|---|---|
| [[src/tests/test_uploads.py]] | init/finalize 2-step 흐름 |
| [[src/tests/test_files.py]] | 일반 파일 |
| [[src/tests/test_imports.py]] | docx 안 이미지 → MinIO pre-pass |
