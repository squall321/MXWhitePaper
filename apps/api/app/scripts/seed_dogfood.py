"""Cycle 13 dogfood seed — generate 100 realistic MX 사업부 white-paper docs.

매 실행이 멱등(`ON CONFLICT (slug) DO UPDATE`)이며, --purge 모드는
`dogfood` 태그가 붙은 문서만 안전하게 제거한다.

Run:
  apptainer exec instance://mxwp_api /bin/sh -c \\
    "cd /workspace/apps/api && python3 -m app.scripts.seed_dogfood"

Options:
  --count N    생성 문서 수 (기본 100)
  --purge      dogfood 태그가 붙은 문서를 모두 archive 후 hard-delete
  --no-refresh refresh_links / reindex 단계 생략
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import random
from datetime import datetime, timezone
from typing import Any

import ulid
from sqlalchemy import text

from app.scripts._env import load_env

load_env()

from app.core.db import session_scope  # noqa: E402

# ────────────────────────── 부서 트리 ──────────────────────────
# realistic Korean names + ASCII slug. parts 까지 ~30+.
ORG_TREE: dict[str, Any] = {
    "division": {"slug": "mx", "name": "MX 사업부"},
    "teams": [
        {
            "slug": "finance", "name": "재무팀",
            "groups": [
                {"slug": "accounting", "name": "회계그룹", "parts": [
                    {"slug": "closing", "name": "결산파트"},
                    {"slug": "tax", "name": "세무파트"},
                    {"slug": "ap-ar", "name": "AP/AR파트"},
                ]},
                {"slug": "fpa", "name": "FP&A그룹", "parts": [
                    {"slug": "budget", "name": "예산파트"},
                    {"slug": "forecast", "name": "예측파트"},
                ]},
                {"slug": "treasury", "name": "재무그룹", "parts": [
                    {"slug": "cash", "name": "자금파트"},
                    {"slug": "fx", "name": "외환파트"},
                ]},
            ],
        },
        {
            "slug": "marketing", "name": "마케팅팀",
            "groups": [
                {"slug": "brand", "name": "브랜드그룹", "parts": [
                    {"slug": "brand-strategy", "name": "브랜드전략파트"},
                    {"slug": "creative", "name": "크리에이티브파트"},
                ]},
                {"slug": "growth", "name": "그로스그룹", "parts": [
                    {"slug": "performance", "name": "퍼포먼스마케팅파트"},
                    {"slug": "crm", "name": "CRM파트"},
                    {"slug": "lifecycle", "name": "라이프사이클파트"},
                ]},
                {"slug": "digital", "name": "디지털그룹", "parts": [
                    {"slug": "seo", "name": "SEO파트"},
                    {"slug": "social", "name": "소셜미디어파트"},
                ]},
            ],
        },
        {
            "slug": "engineering", "name": "개발팀",
            "groups": [
                {"slug": "platform", "name": "플랫폼그룹", "parts": [
                    {"slug": "backend", "name": "백엔드파트"},
                    {"slug": "frontend", "name": "프론트엔드파트"},
                    {"slug": "mobile", "name": "모바일파트"},
                ]},
                {"slug": "infra", "name": "인프라그룹", "parts": [
                    {"slug": "devops", "name": "DevOps파트"},
                    {"slug": "sre", "name": "SRE파트"},
                ]},
                {"slug": "data", "name": "데이터그룹", "parts": [
                    {"slug": "data-eng", "name": "데이터엔지니어링파트"},
                    {"slug": "ml", "name": "머신러닝파트"},
                ]},
                {"slug": "qa", "name": "QA그룹", "parts": [
                    {"slug": "test-auto", "name": "테스트자동화파트"},
                    {"slug": "manual-qa", "name": "수동QA파트"},
                ]},
            ],
        },
        {
            "slug": "design", "name": "디자인팀",
            "groups": [
                {"slug": "product-design", "name": "프로덕트디자인그룹", "parts": [
                    {"slug": "ux", "name": "UX파트"},
                    {"slug": "ui", "name": "UI파트"},
                ]},
                {"slug": "design-system", "name": "디자인시스템그룹", "parts": [
                    {"slug": "tokens", "name": "토큰파트"},
                    {"slug": "components", "name": "컴포넌트파트"},
                ]},
            ],
        },
        {
            "slug": "hr", "name": "인사팀",
            "groups": [
                {"slug": "talent", "name": "탤런트그룹", "parts": [
                    {"slug": "recruiting", "name": "리쿠르팅파트"},
                    {"slug": "onboarding", "name": "온보딩파트"},
                ]},
                {"slug": "people-ops", "name": "피플옵스그룹", "parts": [
                    {"slug": "compensation", "name": "보상파트"},
                    {"slug": "culture", "name": "조직문화파트"},
                    {"slug": "ld", "name": "L&D파트"},
                ]},
            ],
        },
    ],
}

# ────────────────────────── Phrase pools (한국어) ──────────────────────────
PARA_POOL = [
    "본 문서는 MX 사업부 내 표준 운영 절차를 정리한 것이다. 모든 구성원은 본 문서의 내용을 숙지해야 한다.",
    "프로세스의 일관성과 품질 확보를 위해, 각 단계별 산출물과 책임자를 명확히 정의한다.",
    "최근 6개월 간 누적된 운영 데이터를 바탕으로 핵심 지표를 도출하였으며, 이는 분기별로 재검토된다.",
    "이슈가 발견될 경우 즉시 담당자에게 보고하고 슬랙 #ops 채널에 공유한다.",
    "본 가이드는 신규 입사자뿐 아니라 기존 구성원의 리프레시 학습 자료로도 활용 가능하다.",
    "표준 템플릿은 사내 위키의 공통 자산 페이지에 보관되며, 누구나 PR 형태로 개선 제안할 수 있다.",
    "정책 위반 시 1차 경고 → 2차 시정조치 → 3차 인사위원회 회부 절차를 따른다.",
    "고객 데이터 처리 시에는 사내 보안수칙과 PII 마스킹 가이드를 반드시 준수한다.",
    "변경된 내용은 매 분기 정기 리뷰에서 최종 승인된 후 본 문서에 반영된다.",
    "팀 간 협업이 필요한 사안은 사전에 공동 소유자(co-owner)를 지정하고 RACI 표를 명시한다.",
    "운영 자동화 범위는 점진적으로 확장 중이며, 수기 단계는 6개월 단위로 재검토된다.",
    "핵심 의사결정은 의사결정 일지에 동시 기록하여 향후 유사 상황의 참고 자료로 활용한다.",
]

LIST_POOL = [
    ["사전 점검 항목 확인", "체크리스트 출력", "담당자 사인", "결재 라인 진행"],
    ["주간 회고 작성", "지표 대시보드 갱신", "다음 주 목표 정렬", "리스크 공유"],
    ["요구사항 정리", "기술 스펙 초안", "리뷰", "승인", "착수"],
    ["수집 → 정제 → 적재 → 분석 → 시각화", "각 단계 SLA 1시간 이내"],
    ["보안 패치 적용", "취약점 스캔", "결과 리포트 보관", "후속 조치 추적"],
]

CALLOUT_POOL = [
    ("info", "사내 보안 정책에 따라 외부 공유 금지."),
    ("warn", "본 절차는 분기별로 재검토되며, 임의 수정 시 audit log 에 기록된다."),
    ("tip", "테이블 정렬 헤더를 클릭하면 컬럼 단위로 정렬된다."),
    ("danger", "고객 PII 가 포함될 수 있으므로 외부 메일 송부 시 마스킹 필수."),
    ("info", "본 문서는 [[onboarding-guide|온보딩 가이드]]와 함께 학습하는 것을 권장한다."),
]

QUOTE_POOL = [
    ("우리가 측정하지 않는 것은 개선될 수 없다.", "Peter Drucker"),
    ("단순함은 궁극의 정교함이다.", "Leonardo da Vinci"),
    ("문서가 곧 시스템이다.", "MX 엔지니어링 원칙"),
    ("프로세스보다 사람, 도구보다 신뢰.", "MX 조직문화 헌장"),
]

CODE_POOL = [
    ("python", "def month_end(records):\n    total = sum(r.amount for r in records if r.posted)\n    return round(total, 2)\n"),
    ("typescript", "export function diffDays(a: Date, b: Date): number {\n  return Math.floor((+a - +b) / 86400000);\n}\n"),
    ("sql", "SELECT date_trunc('month', closed_at) AS m, COUNT(*)\nFROM closings\nGROUP BY 1 ORDER BY 1 DESC LIMIT 12;\n"),
    ("bash", "#!/usr/bin/env bash\nset -euo pipefail\ncurl -fsSL \"$API/health\" | jq .status\n"),
    ("yaml", "kpis:\n  - name: dso\n    target: 30\n  - name: dpo\n    target: 45\n"),
]

MATH_POOL = [
    "ROI = \\frac{\\text{순이익}}{\\text{투자비용}} \\times 100",
    "CAC = \\frac{\\text{마케팅비용}}{\\text{신규고객수}}",
    "LTV = ARPU \\times \\frac{1}{\\text{Churn Rate}}",
    "DSO = \\frac{\\text{매출채권}}{\\text{매출}} \\times 365",
    "NPS = \\%\\text{Promoter} - \\%\\text{Detractor}",
]

MERMAID_POOL = [
    "flowchart LR\n  A[요청 접수] --> B{유효성 검증}\n  B -->|OK| C[처리]\n  B -->|실패| D[반려]\n  C --> E[완료 통지]",
    "flowchart TD\n  Plan --> Design --> Implement --> Verify --> Release\n  Verify -->|결함| Implement",
    "sequenceDiagram\n  사용자->>API: 로그인\n  API->>DB: 조회\n  DB-->>API: 결과\n  API-->>사용자: 토큰",
]

CHART_TITLES = ["월별 추이", "분기별 비교", "팀별 현황", "주요 지표 변화", "Top 5 카테고리"]

TABLE_TEMPLATES = [
    {"headers": ["단계", "담당", "기한"],
     "rows": [["요청", "팀장", "D-5"], ["검토", "리드", "D-3"], ["승인", "임원", "D-1"]]},
    {"headers": ["항목", "기준", "비고"],
     "rows": [["보안 등급", "Internal", "전 직원 열람"],
              ["보존 기간", "5년", "법정 보존"],
              ["폐기 절차", "DRP", "DPO 승인 필요"]]},
    {"headers": ["KPI", "목표", "실적"],
     "rows": [["월결산 일수", "5", "4.6"], ["이상치 건", "0", "1"], ["감사 지적", "0", "0"]]},
    {"headers": ["환경", "URL", "비고"],
     "rows": [["dev", "https://dev.example.local", "내부망"],
              ["staging", "https://stg.example.local", "QA"],
              ["prod", "https://example.com", "고객용"]]},
]

# 문서 카테고리별 템플릿 — (카테고리, 제목 prefix list, 태그 풀)
DOC_CATEGORIES = [
    ("프로세스", ["월결산 프로세스", "분기결산 프로세스", "채용 프로세스",
                "배포 프로세스", "이슈 대응 프로세스", "구매 발주 프로세스",
                "성과 평가 프로세스", "온보딩 프로세스", "장애 대응 프로세스",
                "예산 수립 프로세스"], ["프로세스", "운영", "표준"]),
    ("가이드", ["코드 리뷰 가이드", "신규 입사자 온보딩 가이드", "스타일 가이드",
              "보안 수칙 가이드", "API 사용 가이드", "디자인 시스템 가이드",
              "데이터 분석 가이드", "Slack 사용 가이드", "Git Flow 가이드",
              "로그 작성 가이드"], ["가이드", "표준"]),
    ("정책", ["휴가 정책", "재택근무 정책", "출장 정책", "보안 정책",
            "데이터 보존 정책", "오픈소스 사용 정책", "외부 공개 정책",
            "AI 활용 정책", "장비 지급 정책", "교육 지원 정책"], ["정책", "규정"]),
    ("회의록", ["월간 마케팅 회의 2026-01", "월간 마케팅 회의 2026-02",
              "엔지니어링 위클리 2026-W14", "엔지니어링 위클리 2026-W15",
              "재무 월간 리뷰 2026-Q1", "디자인 리뷰 2026-04",
              "HR 분기 미팅 2026-Q1", "프로덕트 OKR 정렬 2026-H1",
              "보안 위원회 2026-04", "임원 정기 회의 2026-04"],
     ["회의록"]),
    ("분석 보고서", ["Q1 매출 분석", "사용자 인사이트 보고서",
                "마케팅 ROI 분석", "리텐션 코호트 분석",
                "제품 활성화 분석", "이탈 사용자 분석",
                "성능 회귀 분석", "비용 구조 분석",
                "트래픽 분석 보고서", "고객 NPS 보고서"],
     ["분석", "리포트"]),
    ("기술 문서", ["API 가이드", "데이터 파이프라인 설계", "디자인 시스템 토큰",
                "마이크로서비스 아키텍처", "모바일 앱 빌드 가이드",
                "CI/CD 구성", "Observability 스택", "배포 자동화",
                "스키마 마이그레이션 가이드", "캐시 전략"],
     ["기술", "아키텍처"]),
    ("FAQ", ["출장 FAQ", "인사 FAQ", "보안 FAQ", "급여 FAQ",
           "재택 FAQ", "구매 FAQ", "휴가 FAQ", "장비 FAQ", "교육 FAQ", "퇴사 FAQ"],
     ["FAQ"]),
]

# Glossary 후보 — 약 20% 의 docs 에 1~3 term 부여
GLOSSARY_POOL = [
    ("DSO", "Days Sales Outstanding — 매출채권 회수 평균 일수"),
    ("DPO", "Days Payable Outstanding — 매입채무 결제 평균 일수"),
    ("CAC", "Customer Acquisition Cost — 고객 한 명을 확보하는 데 소요된 비용"),
    ("LTV", "Lifetime Value — 고객 생애 가치"),
    ("NPS", "Net Promoter Score — 추천자 비율 - 비추천자 비율"),
    ("MVP", "Minimum Viable Product — 최소 기능 제품"),
    ("RACI", "책임/실무/협의/통보 — 의사결정 권한 매트릭스"),
    ("R&R", "Roles and Responsibilities — 역할과 책임"),
    ("OKR", "Objective and Key Results — 목표와 핵심결과"),
    ("DRP", "Data Retention Policy — 데이터 보존 정책"),
    ("PII", "Personally Identifiable Information — 개인 식별 정보"),
    ("SLA", "Service Level Agreement — 서비스 수준 협약"),
]

# 슬러그 프리픽스 — 카테고리별
SLUG_PREFIX = {
    "프로세스": "process",
    "가이드": "guide",
    "정책": "policy",
    "회의록": "meeting",
    "분석 보고서": "report",
    "기술 문서": "tech",
    "FAQ": "faq",
}

DEFAULT_TAG_POOL = ["MX", "사내", "표준", "운영", "샘플", "dogfood"]


def _ulid() -> str:
    return str(ulid.new())


def _slugify(prefix: str, title: str, idx: int) -> str:
    """ASCII slug — 한글 제거하고 짧은 hash 부여."""
    h = hashlib.md5(f"{title}-{idx}".encode("utf-8")).hexdigest()[:8]
    base = "".join(c for c in title.lower() if c.isascii() and (c.isalnum() or c == "-"))
    base = base[:30] or "doc"
    return f"{prefix}-{base}-{h}".strip("-")


def _para(text_: str) -> dict[str, Any]:
    return {"type": "paragraph", "id": _ulid(), "text": text_}


def _heading4(title: str) -> dict[str, Any]:
    return {"type": "heading-4", "id": _ulid(), "title": title}


def _list(rng: random.Random) -> dict[str, Any]:
    items = rng.choice(LIST_POOL)
    return {"type": "list", "id": _ulid(),
            "style": rng.choice(["bullet", "number", "check"]),
            "items": list(items)}


def _quote(rng: random.Random) -> dict[str, Any]:
    text_, cite = rng.choice(QUOTE_POOL)
    return {"type": "quote", "id": _ulid(), "text": text_, "cite": cite}


def _callout(rng: random.Random) -> dict[str, Any]:
    variant, text_ = rng.choice(CALLOUT_POOL)
    return {"type": "callout", "id": _ulid(), "variant": variant, "text": text_}


def _code(rng: random.Random) -> dict[str, Any]:
    lang, code = rng.choice(CODE_POOL)
    return {"type": "code", "id": _ulid(), "language": lang, "code": code}


def _math(rng: random.Random) -> dict[str, Any]:
    return {"type": "math", "id": _ulid(), "expression": rng.choice(MATH_POOL),
            "display": "block"}


_TABLE_ENDPOINTS = [
    ("/api/v1/widgets/table/region-breakdown", {"period": "2026-Q1"}),
    ("/api/v1/widgets/table/sales-summary",    {"days": 30}),
    ("/api/v1/widgets/launch/galaxy-flip-2026/tasks", {}),
    ("/api/v1/widgets/launch/galaxy-flip-2026/timeline", {}),
    ("/api/v1/widgets/launch/galaxy-watch-2026/tasks", {}),
    ("/api/v1/widgets/launch/galaxy-buds-2026/timeline", {}),
]


def _table(rng: random.Random) -> dict[str, Any]:
    endpoint, params = rng.choice(_TABLE_ENDPOINTS)
    return {
        "type": "data-source", "id": _ulid(),
        "endpoint": endpoint,
        "params": dict(params),
        "render": "table",
        "refreshInterval": 600,
    }



# Dogfood-time KPI / chart / table blocks now reference real widget
# endpoints (DB-backed) instead of random inline values. Variety
# across docs comes from rotating which widget is used. No mock data
# anywhere — the same fact tables populate every block.
_KPI_ENDPOINTS = [
    "/api/v1/widgets/kpi-finance-daily-summary",
    "/api/v1/widgets/kpi/finance.month-end-progress.percent",
    "/api/v1/widgets/kpi/sales.q1-2026.total",
    "/api/v1/widgets/kpi/sales.q1-2026.target-attainment",
]
_CHART_ENDPOINTS = [
    ("/api/v1/widgets/chart/sales-trend", {"team": "finance", "days": 30}),
    ("/api/v1/widgets/chart/sales-trend", {"team": "sales", "days": 30}),
    ("/api/v1/widgets/chart/sales-trend", {"team": "engineering", "days": 60}),
    ("/api/v1/widgets/chart/month-end-progress", {}),
    ("/api/v1/widgets/launch/galaxy-flip-2026/forecast", {}),
    ("/api/v1/widgets/launch/galaxy-watch-2026/forecast", {}),
    ("/api/v1/widgets/launch/galaxy-buds-2026/forecast", {}),
]


def _kpi(rng: random.Random) -> dict[str, Any]:
    return {
        "type": "data-source", "id": _ulid(),
        "endpoint": rng.choice(_KPI_ENDPOINTS),
        "params": {},
        "render": "kpi-cards",
        "refreshInterval": 300,
    }


def _chart(rng: random.Random) -> dict[str, Any]:
    endpoint, params = rng.choice(_CHART_ENDPOINTS)
    return {
        "type": "data-source", "id": _ulid(),
        "endpoint": endpoint,
        "params": dict(params),
        "render": "chart",
        "refreshInterval": 300,
    }


def _flow(rng: random.Random) -> dict[str, Any]:
    return {"type": "flow", "id": _ulid(), "engine": "mermaid",
            "source": rng.choice(MERMAID_POOL)}


def _accordion(rng: random.Random) -> dict[str, Any]:
    items = []
    for q, a in [("연차는 어떻게 신청하나요?",
                  "사내 그룹웨어에서 [신청] → [승인] 절차를 따른다."),
                 ("출장비는 언제 정산되나요?",
                  "출장 종료 후 7영업일 이내 정산해야 한다."),
                 ("재택근무 신청 절차는?",
                  "팀장 승인 후 그룹웨어에 등록한다.")]:
        items.append({"label": q, "blocks": [_para(a)]})
    return {"type": "accordion", "id": _ulid(), "items": items}


# ────────────────────────── 문서 생성 ──────────────────────────
def _pick_blocks(category: str, rng: random.Random,
                 link_slugs: list[str]) -> list[dict[str, Any]]:
    """카테고리에 적합한 4~6개 블록을 골라 반환."""
    blocks: list[dict[str, Any]] = []
    para_text = rng.choice(PARA_POOL)
    if rng.random() < 0.7 and link_slugs:
        target = rng.choice(link_slugs)
        para_text += f" 자세한 내용은 [[{target}]] 를 참고한다."
    blocks.append(_para(para_text))

    builders = {
        "프로세스": [_table, _list, _callout, _chart],
        "가이드": [_para, _callout, _list, _heading4],
        "정책": [_table, _para, _callout],
        "회의록": [_list, _quote, _para, _callout],
        "분석 보고서": [_chart, _kpi, _table, _math],
        "기술 문서": [_code, _flow, _table, _math],
        "FAQ": [_accordion, _para, _callout],
    }
    for builder in builders.get(category, [_para, _list]):
        if builder is _para:
            blocks.append(_para(rng.choice(PARA_POOL)))
        elif builder is _heading4:
            blocks.append(_heading4(rng.choice(["주요 원칙", "핵심 체크리스트", "참고 사항"])))
        else:
            blocks.append(builder(rng))
        if len(blocks) >= rng.randint(4, 6):
            break
    return blocks


def _build_section(level: int, number: str, title: str,
                   category: str, rng: random.Random,
                   link_slugs: list[str], depth: int = 0) -> dict[str, Any]:
    sec: dict[str, Any] = {
        "id": _ulid(),
        "number": number,
        "level": level,
        "title": title,
        "blocks": _pick_blocks(category, rng, link_slugs),
        "subsections": [],
    }
    return sec


def _build_document(idx: int, title: str, category: str,
                    part: dict[str, Any],
                    rng: random.Random,
                    link_slugs: list[str],
                    base_tags: list[str]) -> dict[str, Any]:
    slug = _slugify(SLUG_PREFIX[category], title, idx)
    doc_id = _ulid()

    section_count = rng.randint(1, 3)
    sections = []
    for s_i in range(section_count):
        sec = _build_section(1, str(s_i + 1),
                             f"{rng.choice(['개요','상세 절차','참고 자료','부록'])} {s_i+1}",
                             category, rng, link_slugs)
        # 50% 확률로 level 2 추가, 그 중 30% 는 level 3 까지.
        if rng.random() < 0.5:
            sub_count = rng.randint(1, 2)
            for s2 in range(sub_count):
                sub2 = _build_section(2, f"{s_i+1}.{s2+1}",
                                      rng.choice(["세부 단계", "예시", "체크리스트", "주의사항"]),
                                      category, rng, link_slugs)
                if rng.random() < 0.3:
                    sub3 = _build_section(3, f"{s_i+1}.{s2+1}.1",
                                          rng.choice(["케이스 A", "표준 양식", "FAQ"]),
                                          category, rng, link_slugs)
                    sub2["subsections"].append(sub3)
                sec["subsections"].append(sub2)
        sections.append(sec)

    # tags
    tags = list(set(base_tags + rng.sample(DEFAULT_TAG_POOL, k=rng.randint(1, 3)) + ["dogfood"]))[:5]

    # confidentiality 분포: 80 internal / 15 public / 5 restricted
    r = rng.random()
    confidentiality = "internal" if r < 0.80 else ("public" if r < 0.95 else "restricted")

    # glossary — 20% 확률
    glossary: list[dict[str, str]] = []
    if rng.random() < 0.20:
        for term, definition in rng.sample(GLOSSARY_POOL, k=rng.randint(1, 3)):
            glossary.append({"term": term, "definition": definition})

    # 일부 일부러 미작성 슬러그 가리키기 (red link) — 10%
    related = []
    if rng.random() < 0.30 and link_slugs:
        for s in rng.sample(link_slugs, k=min(2, len(link_slugs))):
            related.append({"slug": s, "relation": rng.choice(["참고", "선행", "후속", "유사"])})
    if rng.random() < 0.10:
        related.append({"slug": "phantom-future-doc", "relation": "참고"})

    doc: dict[str, Any] = {
        "schema_version": "1.0",
        "id": doc_id,
        "slug": slug,
        "title": title,
        "summary": f"{title} — MX 사업부 dogfood 시드 문서.",
        "metadata": {
            "division": "MX",
            "team": part["team_name"],
            "group": part["group_name"],
            "part": part["name"],
            "owners": ["admin@mx.local"],
            "reviewers": [],
            "tags": tags,
            "category": category,
            "confidentiality": confidentiality,
        },
        "sections": sections,
        "related_documents": related,
        "glossary": glossary,
        "references": [],
        "see_also": [],
    }
    return doc


# ────────────────────────── 부서 트리 보장 ──────────────────────────
async def _ensure_org_tree(s) -> list[dict[str, Any]]:
    """returns flat parts list with team/group context."""
    parts_out: list[dict[str, Any]] = []

    div = ORG_TREE["division"]
    await s.execute(text("""
        INSERT INTO divisions (slug, name) VALUES (:s, :n)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    """), {"s": div["slug"], "n": div["name"]})
    div_id = (await s.execute(text(
        "SELECT id FROM divisions WHERE slug = :s"), {"s": div["slug"]})).scalar_one()

    for team in ORG_TREE["teams"]:
        await s.execute(text("""
            INSERT INTO teams (division_id, slug, name) VALUES (:d, :s, :n)
            ON CONFLICT (division_id, slug) DO UPDATE SET name = EXCLUDED.name
        """), {"d": div_id, "s": team["slug"], "n": team["name"]})
        team_id = (await s.execute(text(
            "SELECT id FROM teams WHERE division_id=:d AND slug=:s"
        ), {"d": div_id, "s": team["slug"]})).scalar_one()

        for grp in team["groups"]:
            await s.execute(text("""
                INSERT INTO groups (team_id, slug, name) VALUES (:t, :s, :n)
                ON CONFLICT (team_id, slug) DO UPDATE SET name = EXCLUDED.name
            """), {"t": team_id, "s": grp["slug"], "n": grp["name"]})
            grp_id = (await s.execute(text(
                "SELECT id FROM groups WHERE team_id=:t AND slug=:s"
            ), {"t": team_id, "s": grp["slug"]})).scalar_one()

            for pt in grp["parts"]:
                await s.execute(text("""
                    INSERT INTO parts (group_id, slug, name) VALUES (:g, :s, :n)
                    ON CONFLICT (group_id, slug) DO UPDATE SET name = EXCLUDED.name
                """), {"g": grp_id, "s": pt["slug"], "n": pt["name"]})
                part_id = (await s.execute(text(
                    "SELECT id FROM parts WHERE group_id=:g AND slug=:s"
                ), {"g": grp_id, "s": pt["slug"]})).scalar_one()
                parts_out.append({
                    "id": str(part_id),
                    "slug": pt["slug"],
                    "name": pt["name"],
                    "group_slug": grp["slug"],
                    "group_name": grp["name"],
                    "team_slug": team["slug"],
                    "team_name": team["name"],
                })
    return parts_out


# ────────────────────────── DB upsert ──────────────────────────
async def _upsert_document(s, doc: dict[str, Any], part_id: str, owner_id: str) -> str:
    body_json = json.dumps(doc, ensure_ascii=False)
    row = (await s.execute(text("""
        INSERT INTO documents (slug, part_id, title, summary, status,
                                content_json, owner_id, schema_ver, version)
        VALUES (:slug, :part, :title, :summary, 'published',
                CAST(:body AS JSONB), :owner, '1.0', 1)
        ON CONFLICT (slug) DO UPDATE SET
            title = EXCLUDED.title,
            summary = EXCLUDED.summary,
            content_json = EXCLUDED.content_json,
            part_id = EXCLUDED.part_id,
            updated_at = NOW()
        RETURNING id
    """), {
        "slug": doc["slug"], "part": part_id, "title": doc["title"],
        "summary": doc.get("summary"), "body": body_json, "owner": owner_id,
    })).first()
    doc_id = str(row[0])
    # version 1 보장
    await s.execute(text("""
        INSERT INTO document_versions (document_id, version, content_json, edited_by, change_log)
        VALUES (:d, 1, CAST(:body AS JSONB), :u, 'dogfood-seed')
        ON CONFLICT (document_id, version) DO NOTHING
    """), {"d": doc_id, "body": body_json, "u": owner_id})

    # tags upsert
    from app.repos import document_repo
    await document_repo.replace_document_tags(
        s, document_id=doc_id, tag_names=doc["metadata"]["tags"])
    return doc_id


# ────────────────────────── refresh / reindex ──────────────────────────
async def _refresh_links(s) -> int:
    from app.repos import document_repo
    from app.services.wiki_link_extractor import extract_wiki_links
    rows = (await s.execute(text("""
        SELECT id, content_json FROM documents WHERE status != 'archived'
    """))).all()
    total = 0
    for row in rows:
        content = row[1]
        if isinstance(content, str):
            content = json.loads(content)
        links = extract_wiki_links(content)
        n = await document_repo.replace_links_for_document(
            s, source_doc_id=str(row[0]), links=links)
        total += n
    return total


async def _reindex_meili() -> dict[str, Any]:
    try:
        from app.search import meili_indexer
        meili_indexer.ensure_index()
        async with session_scope() as s:
            try:
                await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))
            except Exception as e:
                print(f"  ⚠ matview refresh: {e}")
            return await meili_indexer.reindex_all(s)
    except Exception as e:
        print(f"  ⚠ reindex skipped: {e}")
        return {"indexed": 0, "stats_count": 0, "error": str(e)}


# ────────────────────────── purge ──────────────────────────
async def _purge_dogfood(s) -> int:
    """`dogfood` 태그가 붙은 모든 문서를 hard delete."""
    rows = (await s.execute(text("""
        SELECT d.id, d.slug FROM documents d
        JOIN document_tags dt ON dt.document_id = d.id
        JOIN tags tg ON tg.id = dt.tag_id
        WHERE tg.name = 'dogfood'
    """))).all()
    n = 0
    for row in rows:
        doc_id = str(row[0])
        await s.execute(text("DELETE FROM links WHERE source_doc_id = :d OR target_doc_id = :d"),
                        {"d": doc_id})
        await s.execute(text("DELETE FROM document_versions WHERE document_id = :d"), {"d": doc_id})
        await s.execute(text("DELETE FROM document_tags WHERE document_id = :d"), {"d": doc_id})
        await s.execute(text("DELETE FROM documents WHERE id = :d"), {"d": doc_id})
        n += 1
        print(f"  - purged {row[1]}")
    return n


# ────────────────────────── main ──────────────────────────
async def main(count: int, purge: bool, no_refresh: bool) -> None:
    rng = random.Random(20260508)  # 재현성 있는 시드
    started = datetime.now(timezone.utc).isoformat()
    print(f"▶ dogfood seed start ({started})")

    if purge:
        async with session_scope() as s:
            n = await _purge_dogfood(s)
        print(f"✓ purged {n} dogfood docs")
        if not no_refresh:
            async with session_scope() as s:
                links = await _refresh_links(s)
            print(f"✓ refresh_links → {links} links")
            await _reindex_meili()
        return

    # 1) 부서 트리
    async with session_scope() as s:
        parts = await _ensure_org_tree(s)
        print(f"✓ org tree ensured — parts={len(parts)}")
        owner_id = (await s.execute(text(
            "SELECT id FROM users WHERE email='admin@mx.local' LIMIT 1"))).scalar_one()

    # 2) 100개 (또는 count) 문서 메타 — 카테고리/제목/parts 분배
    plan: list[tuple[str, str, dict[str, Any], list[str]]] = []
    cat_iter_idx = {c[0]: 0 for c in DOC_CATEGORIES}
    for i in range(count):
        category, titles, base_tags = DOC_CATEGORIES[i % len(DOC_CATEGORIES)]
        title_idx = cat_iter_idx[category]
        cat_iter_idx[category] += 1
        title = titles[title_idx % len(titles)]
        if title_idx >= len(titles):
            title = f"{title} (v{title_idx // len(titles) + 1})"
        # 카테고리에 어울리는 part 매핑 — 부분적으로 random 으로 분산
        candidate_parts = parts
        if category == "프로세스":
            candidate_parts = [p for p in parts if p["team_slug"] in ("finance", "engineering", "hr")]
        elif category == "가이드":
            candidate_parts = [p for p in parts if p["team_slug"] in ("engineering", "design", "hr")]
        elif category == "정책":
            candidate_parts = [p for p in parts if p["team_slug"] in ("hr", "finance")]
        elif category == "회의록":
            candidate_parts = parts
        elif category == "분석 보고서":
            candidate_parts = [p for p in parts if p["team_slug"] in ("marketing", "finance", "engineering")]
        elif category == "기술 문서":
            candidate_parts = [p for p in parts if p["team_slug"] in ("engineering", "design")]
        elif category == "FAQ":
            candidate_parts = [p for p in parts if p["team_slug"] in ("hr", "finance")]
        plan.append((category, title, rng.choice(candidate_parts), base_tags))

    # 사전 slug 풀 생성 — wiki link 가 가리킬 후보. 본격 빌드 전에 미리 만들어 둠.
    pre_slugs: list[str] = []
    rng2 = random.Random(20260508)
    for i, (category, title, _, _) in enumerate(plan):
        pre_slugs.append(_slugify(SLUG_PREFIX[category], title, i))

    # 3) build & upsert
    async with session_scope() as s:
        created = 0
        for i, (category, title, part, base_tags) in enumerate(plan):
            link_pool = [s2 for s2 in pre_slugs if s2 != pre_slugs[i]]
            link_pool = rng.sample(link_pool, k=min(3, len(link_pool)))
            doc = _build_document(i, title, category, part, rng, link_pool, base_tags)
            await _upsert_document(s, doc, part["id"], str(owner_id))
            created += 1
            if created % 10 == 0:
                print(f"  ... {created}/{len(plan)} docs upserted")
    print(f"✓ upserted {created} dogfood documents")

    # 4) refresh & reindex
    link_count = 0
    if not no_refresh:
        async with session_scope() as s:
            link_count = await _refresh_links(s)
        print(f"✓ refresh_links → {link_count} links")
        meili = await _reindex_meili()
        print(f"✓ reindex → {meili.get('indexed')} pushed (stats={meili.get('stats_count')})")

    # 5) stats out
    async with session_scope() as s:
        doc_total = (await s.execute(text(
            "SELECT COUNT(*) FROM documents WHERE status != 'archived'"))).scalar_one()
        tag_total = (await s.execute(text("SELECT COUNT(*) FROM tags"))).scalar_one()
        part_total = (await s.execute(text("SELECT COUNT(*) FROM parts"))).scalar_one()
        team_total = (await s.execute(text("SELECT COUNT(*) FROM teams"))).scalar_one()
        glossary_total = (await s.execute(text("""
            SELECT COUNT(*) FROM documents
            WHERE jsonb_array_length(COALESCE(content_json->'glossary', '[]'::jsonb)) > 0
              AND status != 'archived'
        """))).scalar_one()
    print("──────────────── stats ────────────────")
    print(f"  documents  : {doc_total}")
    print(f"  links      : {link_count}")
    print(f"  tags       : {tag_total}")
    print(f"  parts      : {part_total}")
    print(f"  teams      : {team_total}")
    print(f"  docs w/ glossary: {glossary_total}")
    print("✓ dogfood seed done")


def _argparse() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--count", type=int, default=100)
    p.add_argument("--purge", action="store_true")
    p.add_argument("--no-refresh", action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    args = _argparse()
    asyncio.run(main(count=args.count, purge=args.purge, no_refresh=args.no_refresh))
