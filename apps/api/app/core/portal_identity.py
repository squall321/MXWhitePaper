# 포털 소속 · 플랫폼 권한을 믿는 두 길 — 게이트웨이 위임 호출의 서명된 헤더 검증과 진입 토큰 클레임 읽기
"""CONTRACTS §9 · §2-10.

- 게이트웨이 위임 호출 — `X-Heax-User-Affiliation`(퍼센트 인코딩) + `X-Heax-Aff-Proof`, `X-Heax-User-Plat`(`plat:` 만 정렬 ·
  쉼표, quote safe=",:") + `X-Heax-Plat-Proof`. 증명은 `v1.<exp>.<hex hmac>` 이고 서명 대상은 **인코딩 전** `v1|<email>|<값>|<exp>`
  (HMAC-SHA256, 위임 비밀 — HWAXMcpGateway `_aff_proof` · `_plat_proof` 와 글자 하나까지 같아야 한다). email 은 게이트웨이가 위임
  토큰을 받을 때 실은 그 글자 그대로다(위임 토큰의 `eml`).
- 브라우저 진입 토큰 — `affiliation` 클레임(없으면 칸이 없다) · `groups` 의 `plat:` 항목(포털이 그 순간 센 합성 그룹).

평문 헤더만 · 서명 틀림 · 만료 · 다른 이메일이면 None — 요청을 거부하지 않고 그 값을 **없는 것으로** 본다(닫힌 쪽).
까닭만 남기고 값(소속 · 이메일)은 로그에 남기지 않는다.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from collections.abc import Mapping
from typing import Any
from urllib.parse import unquote

log = logging.getLogger(__name__)

AFF_HEADER = "x-heax-user-affiliation"
AFF_PROOF_HEADER = "x-heax-aff-proof"
PLAT_HEADER = "x-heax-user-plat"
PLAT_PROOF_HEADER = "x-heax-plat-proof"


def secret_tag(secret: str) -> str:
    """위임 비밀의 지문 — 위임 토큰에 실어 두면 비밀을 바꾸는 순간 그 전에 나간 토큰이 모두 죽는다."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]


def _proof_ok(secret: str, email: str, value: str, proof: str, now: float) -> bool:
    version, _, rest = proof.partition(".")
    exp_s, _, sig = rest.partition(".")
    if version != "v1" or not exp_s.isdigit() or not sig:
        return False
    if int(exp_s) <= now:
        return False
    want = hmac.new(secret.encode("utf-8"), f"v1|{email}|{value}|{exp_s}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, sig)


def verified_affiliation(
    headers: Mapping[str, str], *, secret: str, email: str, now: float | None = None,
) -> str | None:
    raw, proof = headers.get(AFF_HEADER), headers.get(AFF_PROOF_HEADER)
    if not raw or not secret:
        return None
    if not proof:
        log.info("portal affiliation header without proof — ignored")
        return None
    aff = unquote(raw)
    if not aff or not _proof_ok(secret, email, aff, proof, time.time() if now is None else now):
        log.warning("portal affiliation proof rejected (signature · expiry · email)")
        return None
    return aff


def verified_plat(
    headers: Mapping[str, str], *, secret: str, email: str, now: float | None = None,
) -> list[str] | None:
    raw, proof = headers.get(PLAT_HEADER), headers.get(PLAT_PROOF_HEADER)
    if not raw or not secret:
        return None
    if not proof:
        log.info("portal plat header without proof — ignored")
        return None
    # 게이트웨이와 같은 순서로 — unquote → 쉼표로 나눔 → 정렬 → 다시 이음. 중복을 지우면 서명 대상이 달라진다.
    items = sorted(p.strip() for p in unquote(raw).split(",") if p.strip())
    if not items or not _proof_ok(secret, email, ",".join(items), proof, time.time() if now is None else now):
        log.warning("portal plat proof rejected (signature · expiry · email)")
        return None
    return [p for p in items if p.startswith("plat:")]


def claims_portal_access(claims: Mapping[str, Any]) -> tuple[str | None, list[str]]:
    """진입 토큰 → (소속 또는 None, plat: 목록). 진입 토큰은 포털 키로 서명돼 있어 그대로 믿는다."""
    aff = claims.get("affiliation")
    groups = claims.get("groups")
    plat = sorted({g for g in groups if isinstance(g, str) and g.startswith("plat:")}) if isinstance(groups, list) else []
    return (aff.strip() if isinstance(aff, str) and aff.strip() else None), plat
