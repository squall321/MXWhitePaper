# Archive Index — 2026-05

| Feature | Match Rate | Archived | Path |
| --- | :---: | --- | --- |
| mixed-table-cells | 100% | 2026-05-15 | [mixed-table-cells/](mixed-table-cells/) |
| widget-marker-import (Phase 1) | 100% | 2026-05-15 | [widget-marker-import/](widget-marker-import/) |
| widget-phase2-batch (Phase 2 — 14 widgets + multi-block infra + web render) | 100% | 2026-05-15 | [widget-phase2-batch/](widget-phase2-batch/) |
| widget-export-markers (Cycle X — 4 renderer marker emit + 9 docx widget rework for lossless round-trip + 3 missing functions filled) | 96% | 2026-05-15 | [widget-export-markers/](widget-export-markers/) |
| widget-phase3-autodetect (Cycle Y — marker-less auto-detection: callout/kpi-cards/gallery/gantt) | 100% | 2026-05-15 | [widget-phase3-autodetect/](widget-phase3-autodetect/) |
| web-cell-edit (Cycle Z — TableBlock 의 mixed-cell 풀 인-셀 편집: paragraph/list/image + 모드 토글) | 100% | 2026-05-15 | [web-cell-edit/](web-cell-edit/) |
| widget-polish-batch (5 follow-up 통합: image picker / image-annotation roundtrip / inline format / drag-drop / columns autodetect + pre-existing maintenance fix) | 100% | 2026-05-15 | [widget-polish-batch/](widget-polish-batch/) |
| widget-roundtrip-strictness (전수 검증 → 6 위젯 round-trip 결함 발견 + 3계층 강건한 fix: hidden marker / autodetect / placeholder. 18/18 위젯 lossless. LLM 입력 룰 문서화) | 100% | 2026-05-15 | [widget-roundtrip-strictness/](widget-roundtrip-strictness/) |
| codegen (RAG toolkit for LLM-driven docx generation — 3 swappable backends + MCP server + 4-layer drift guard. v1.0.0 tagged, CI green on 9d856ab) | 100% (25/25 tests, CI green) | 2026-05-16 | [codegen/](codegen/) |
| widget-integrity-pass-1 (4 Explore audit → 9 갭 + zebra 통합 4분할 병렬 픽스: BE export · schema/imageId · FE editor · lat/RAG sync. 신규 26 tests, 회귀 0) | 100% (C1~C14 14/14) | 2026-05-18 | [widget-integrity-pass-1/](widget-integrity-pass-1/) |
| zebra-striping (superseded by widget-integrity-pass-1 — Plan/Design 작성 직후 점검 결과로 상위 사이클에 흡수. 참고용 보존) | superseded | 2026-05-18 | [zebra-striping-superseded/](zebra-striping-superseded/) |
| widget-integrity-pass-2 (점검의 MED 우선순위 10건 통합 픽스: data-source polling · iframe XOR · video 옵션 · pdf/org-chart/gallery docx marker · annotation label · heading4 dropdown · quote editor · glossary-ref 정리. pydantic v2 oneOf 한계 발견 + generate-py.py 후처리 패치 = 재사용 자산) | 100% (C1~C14 14/14) | 2026-05-18 | [widget-integrity-pass-2/](widget-integrity-pass-2/) |
| widget-integrity-pass-3 (MED 잔여 + cleanup 6건: spacer xl · list check round-trip 잠금 · image width 의도 명시 · form/quiz 기본값 학습 · pydantic 경고 제거 · INDEX MD060 fix. 2분할 직접 작업 ~3시간. 1차 89% → G1+G2 follow-up → 100%. **widget integrity 사이클 시리즈 종료**) | 100% (C1~C9 9/9) | 2026-05-19 | [widget-integrity-pass-3/](widget-integrity-pass-3/) |
| chart-xy-line (4-phase: xy-line 데이터 모델 + 엑셀 paste + ECharts toolbar + annotation/dual-y/비선형 fit/error-bar/timestamp/derived + pptx XY_SCATTER export + LTTB downsample. 사용자 9 요구 100%, 147 신규 테스트, 5 에이전트 최대 병렬) | 100% | 2026-05-24 | [chart-xy-line/](chart-xy-line/) |
| zebra-striping-extended (zebra.ts util을 4 신규 블록 — list / kpi-cards / bibliography / figure-index — 으로 확장 + 공통 `<ZebraToggle>` 컴포넌트 + FigureIndexBlockEditor 신설. 6 블록 통합 contract, schema add-only optional. 1 commit, +1534/-111, web 1821/1821 + api 1014/1014. 직접 11-step 순차) | 97% | 2026-05-24 | [zebra-striping-extended/](zebra-striping-extended/) |
| gantt-zebra (7번째 블록 — SVG GanttBlock 의 task row 단위 `<rect fill="#F9FAFB">` zebra. `STRIPE_CLASSES['gantt']` dummy entry로 ZebraToggle exhaustive type 만족. 1 commit, +681/-27, web 1826/1826 + api 1014/1014, ~1시간 (예상 1.5h 대비 33% 효율). row-based widget 7/7 zebra 통합 contract 완성) | 100% | 2026-05-24 | [gantt-zebra/](gantt-zebra/) |
| gantt-darkmode (GanttBlock SVG 5 hex → var(--smsg-...) 토큰화 + figure에 Tailwind dark: 변형. tokens.css `.dark` 자동 치환으로 다크 대응. 새 토큰 신설 X, schema 무변경. 1 commit, +400/-15, web 1828/1828, ~45분 (예상 1h 대비 25% 효율). 토큰 매핑 사전 검증 패턴 확립) | 100% | 2026-05-24 | [gantt-darkmode/](gantt-darkmode/) |
| chart-darkmode (useResolvedTheme hook 신설 + ECharts dispose+init + recharts props 분기. 데이터 시리즈 8색 팔레트는 의미 보존 위해 미변형. ChartBlock + EChartsView 양쪽 다크 대응. 1 commit, +913/-31, web 1838/1838, ~2h. useResolvedTheme 패턴 자산화 — 외부 라이브러리 다크 통합 표준) | 98% | 2026-05-24 | [chart-darkmode/](chart-darkmode/) |
