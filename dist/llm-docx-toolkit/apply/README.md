# Apply Rules — Windows automation

> 사용자가 본인 .docx 파일에 MXWhitePaper 입력 룰을 *원클릭으로* 적용하는
> 도구. Word COM 자동화가 DRM/IRM 도 같이 풀어준다 (Word 가 정상 권한으로
> 열어서 .docx 로 다시 저장하는 과정에서 보호 정책이 떨어짐).

## 빠른 사용

1. `apply/targets/` 폴더에 본인 .docx (그리고 옵션으로 .html) 파일들을 넣음.
2. `apply-rules.bat` 더블클릭.
3. PowerShell 창이 뜨고 진행 → 완료 후 `targets/format_report.csv` 확인.

또는 임의의 폴더를 `apply-rules.bat` 에 *드래그&드롭* — 그 폴더가 target 으로 처리됨.

## 무엇이 적용되나

`apply-rules.ps1` 가 각 .docx 에:

| 단계 | 동작 |
|---|---|
| 1 | Word 가 파일 open (DRM/IRM 정책이 있으면 Word 가 정상 권한으로 처리, Save 시 정책 사라짐) |
| 2 | **문서 제목** — 파일명에서 (revision tag 뒤 부분) 추출해 Title 빌트인 속성 + Title 스타일 적용 |
| 3 | **섹션 헤딩** — dotted numbering ("1.", "1.1", "1.1.1") 인식해 Heading N 스타일 자동 적용 (level=점 개수) |
| 4 | **위젯 마커 hidden** — `Widget: <type>` 또는 `위젯: <type>` 으로 시작하는 단락의 폰트를 hidden 으로 변경 (round-trip 안전) |
| 5 | **표 헤더 정상화** — 헤더 행의 bold 제거 + `**label**` / `__label__` 마크다운 wrap 제거 |
| 6 | **플로팅 이미지 inline 화** — text wrap=tight 인 도형을 inline shape 로 변환 (import 가 인식하도록) |
| 7 | **저장 + 검증** — Word 가 다시 저장 (DRM 사라짐) → `mxwp-validator-win32.exe` 가 schema 검증 |

CSV 리포트에 파일별:
- `Status` — `ok` / `error` / `converted` (html→docx) / `convert_error`
- `TitleStyled`, `HeadingsStyled`, `MarkersHidden`, `TablesSeen`,
  `HeaderRowsPlain`, `HeaderTextsCleaned`, `FloatingShapes`,
  `ShapesInlined`, `ShapeInlineFailures`, `NestedTables`
- `SchemaValid` — validator 결과 (`yes` / `no (schema violation)` / `no (parse crashed)` / `skipped`)
- `Warning` — 에러 메시지 또는 nested table 같은 경고

## 옵션 / 고급 사용

PowerShell 직접 실행으로 옵션 지정:

```powershell
.\apply-rules.ps1 -Root "C:\path\to\docs"
.\apply-rules.ps1 -Root "C:\path\to\docs" -ReportPath "C:\reports\out.csv"
.\apply-rules.ps1 -SkipHtml        # .html → .docx 변환 안 함
.\apply-rules.ps1 -SkipValidate    # schema 검증 건너뜀
```

## 요구사항

- Windows 10 / 11 (PowerShell 5.1+ 기본 탑재)
- Microsoft Word 설치 (Office 365 / 2019 / 2021 모두 작동)
- 본 폴더의 형제 위치 `../bin/mxwp-validator-win32.exe` 가 존재해야 검증 작동. CI 빌드 번들에 포함됨.

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| "Word.Application not recognised" | Word 미설치 또는 COM 등록 깨짐 | Office 재설치 또는 수동 등록 `regsvr32` |
| "Access denied" on `.docx` | DRM 이 강해서 Open 도 차단 (예: Azure RMS 사용자 권한 없음) | 그 파일의 정책에 본인 권한 있는지 확인. 본 스크립트는 *open 가능한* 파일만 처리. |
| `format_report.csv` 비어있음 | targets/ 안에 .docx 가 없음 | 파일을 폴더에 넣고 다시 실행 |
| `mxwp-validator.exe not found` | binary 못 찾음 | 본 폴더 형제 `../bin/` 에 binary 있는지 확인 (release bundle 의 표준 layout) |

## DRM 해제 메커니즘

이 스크립트는 별도 DRM 해제 단계가 *없습니다*. 단순히:

1. Word COM 으로 파일을 열고,
2. 같은 경로에 `.Save()`.

대부분의 사내 IRM (Information Rights Management) / Azure Information Protection
정책은 Word 가 정상 권한으로 열어서 저장하면 *해당 사용자가 권한 있는 경우*
정책이 제거된 평문 docx 로 저장됩니다. 강력한 외부 DRM (예: Forcepoint,
FasooDRM 의 보안 컨테이너) 은 이 방식으로는 풀리지 않습니다 — 그런 환경에서는
해당 솔루션 벤더의 해제 API 를 통해 미리 해제 후 본 스크립트 실행 필요.
