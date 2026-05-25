# Visual Regression lat

> Playwright 기반 시각 회귀 (screenshot diff) PoC 인프라.
> Cycle: visual-regression (2026-05-24).

---

## 목적

코드 패턴 기반 회귀 가드 (`AllBlocksDarkmode.test.ts` 등) 가 잡지 못하는
**실 픽셀 깨짐** 검출. 특히:

- mermaid theme 재초기화가 실제 다이어그램 색을 바꾸나
- recharts Tooltip contentStyle 분기가 적용되나
- ECharts dispose+init 후 axis 색이 올바른가
- SVG token (`var(--smsg-...)`) 가 다크 모드에서 정상 해석되나

단위 테스트는 라이브러리 한계 (recharts SSR width=0, mermaid dynamic
import) 로 검증 불가 → 실 브라우저 렌더 + baseline diff 가 유일한 정직한
방법.

---

## 파일

```
apps/web/
├── tests/e2e/
│   ├── visual-darkmode.spec.ts                                    # 다크모드 light + dark 2 케이스
│   ├── visual-darkmode.spec.ts-snapshots/                         # baseline 2 PNG
│   ├── visual-presentation.spec.ts                                # presentation 4 슬라이드 (NEW: presentation-layout cycle)
│   └── visual-presentation.spec.ts-snapshots/                     # baseline 4 PNG
└── playwright.config.ts                                            # 변경 없음 — testDir './tests/e2e' 그대로
```

---

## 실행

### 라이브 스택 사전 조건
- web: http://localhost:5173/
- api: http://localhost:8800/api/v1/

apptainer instance `mxwp_web`, `mxwp_api`, `mxwp_postgres`, `mxwp_meili`,
`mxwp_minio` 가 떠 있어야 함 (e2e global-setup 이 healthz 체크).

### 명령

```bash
# baseline 비교 (CI 패턴)
cd apps/web
pnpm playwright test tests/e2e/visual-darkmode.spec.ts --project=chromium-desktop

# baseline 갱신 (의도적 시각 변경 후)
pnpm playwright test tests/e2e/visual-darkmode.spec.ts --project=chromium-desktop --update-snapshots

# baseline 검토 (diff 이미지)
# 실패 시 test-results/ 아래 actual/expected/diff PNG 생성
```

### apptainer 안 vs host 실행
chromium 의 system dependencies (libglib, libnss 등) 가 `mxwp_web` 이미지에
*없음*. host 에서 직접 실행:

```bash
cd /home/koopark/claude/MXWhitePaper/apps/web
pnpm playwright test tests/e2e/visual-darkmode.spec.ts --project=chromium-desktop
```

CI 통합 시에는 별도 playwright 이미지 (`mcr.microsoft.com/playwright`) 또는
`apt install libglib2.0-0 ...` 한 컨테이너 필요. 본 PoC 사이클은 host
검증만.

---

## 사례 추가 가이드

1. **새 spec 파일**: `tests/e2e/visual-{topic}.spec.ts`
2. **`page.addInitScript()` 로 mount 전 상태 셋업** (테마 토글, viewport 등)
3. **렌더 settle 대기**: `await page.waitForSelector('article')` + `await page.waitForTimeout(2000)` (mermaid/echarts 비동기 측정)
4. **screenshot**: `await expect(page).toHaveScreenshot('name.png', { fullPage: true, maxDiffPixelRatio: 0.02, animations: 'disabled' })`
5. **첫 실행으로 baseline 생성**: `--update-snapshots`
6. **시각 검토 후 git add** (baseline PNG)
7. **재실행으로 deterministic 확인**

### 사용할 sample slug
- `white-paper-realtime-edit-design` — chart + gantt + flow (mermaid) + table + 기타 — 다크모드 종합 검증
- `01-month-end-closing` — 작은 표 위주
- `10-whiteboard-sample` — 화이트보드 의도 예외 검증
- 더 좁은 사례는 mock document seed 신설 후 사용

---

## Gotchas

- **mermaid random id** — 다이어그램 SVG에 `mermaid-${random}` ID 가 들어가 baseline diff false-positive 가능. **현재 회피**: maxDiffPixelRatio 0.02 (작은 텍스트 변화 흡수). 더 엄격히 가려면 mermaid id를 deterministic 하게 mock 필요 (별도 사이클).
- **font rendering host 의존성** — Pretendard Variable 가 host 시스템 폰트로 fallback 되는 경우 픽셀 다름. CI 안정화 시 font 결정성 docker layer 추가 필요.
- **viewport 단일 (chromium-desktop)** — tablet/mobile 케이스는 baseline 폭증 위험 → PoC 사이클 out-of-scope.
- **animations: 'disabled'** 필수 — transition 진행 중 frame 캡처하면 비결정성.
- **chart-darkmode 의 dispose+init useEffect** — theme 변경 시 chart re-init 시간 ~ms. 2초 waitTimeout 으로 흡수.
- **CI 통합 미완** — 본 사이클 out-of-scope. baseline 안정화 + font 결정성 + container 셋업 후 별도 사이클.

---

## 다음 사이클 (visual-regression-ci)

- GitHub Actions workflow 신설 (`.github/workflows/visual.yml`)
- Playwright Docker image 사용 또는 setup-deps 단계 추가
- PR diff 이미지 자동 첨부 (`peter-evans/comment-pr` 등)
- failure 시 actual/expected/diff artifact 업로드
- 추가 sample 문서 caverage (block-type별)

---

## 사이클 / Plan

- `docs/01-plan/features/visual-regression.plan.md` — PoC 사이클 (2026-05-24)
- archive: `docs/archive/2026-05/visual-regression/`
