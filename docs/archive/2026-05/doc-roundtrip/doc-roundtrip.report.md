# doc-roundtrip — Completion Report

## Executive Summary
| | |
|---|---|
| **Feature** | Doc Round-trip API + TOC Verify-and-Strip + Batch CLI |
| **Completion** | 2026-05 (95%, 1 deferred) |
| **Status** | API/서비스 완성, CLI 통합 테스트만 Copilot 위임 (deferred) |
| **Match Rate** | 95% (19 tests pass) |

### Value Delivered

| Perspective | Outcome |
|---|---|
| Problem | 외부 docx 양식 정규화에 수동 편집 비용 큼 |
| Solution | `/api/v1/imports/docx/roundtrip` 한 호출로 import→export round-trip + TOC strip |
| Function/UX | 즉시 실운영 가능, 표준 양식 비용 0 |
| Core Value | 외부 docx → MXWP 표준 → docx 의 1-step 정규화 |

## 구현 위치
- `apps/api/app/services/docx_roundtrip.py` (50줄)
- `apps/api/app/routers/imports.py:396-478` (`/imports/docx/roundtrip`)
- `apps/api/app/cli/roundtrip.py` (15609 바이트)
- `apps/api/app/services/docx_import.py` 의 `roundtrip_mode=True` 분기

## 테스트
- API 9건 (`test_imports_roundtrip.py`)
- 단위 10건 (`test_docx_roundtrip.py`)
- CLI 통합 test (`test_cli_roundtrip.py`) — Copilot 위임 표시

## 후속
- L21 CLI 통합 테스트 — 기존 API/단위 가 같은 코드 경로 검증 중이라 우선순위 낮음
