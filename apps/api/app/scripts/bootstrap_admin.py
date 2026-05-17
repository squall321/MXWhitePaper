"""Create the very first admin user from env so production can boot
without relying on the dev-mode auto-admin fallback.

Idempotent: if any active admin already exists, it just logs and exits 0.

Usage (inside the api container):

    apptainer exec instance://mxwp_api bash -lc '
      cd /workspace/apps/api &&
      BOOTSTRAP_ADMIN_EMAIL=admin@samsung.com \\
      BOOTSTRAP_ADMIN_PASSWORD=Init!Setup2026 \\
      python3 -m app.scripts.bootstrap_admin
    '

Exit codes:
  0 — admin created OR already existed (idempotent)
  2 — required env vars missing
  3 — DB / unexpected failure
"""
from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import text

# Load .env so DATABASE_URL etc. are visible when run as a one-shot.
from app.scripts._env import load_env

load_env()

from app.core.db import session_scope  # noqa: E402
from app.core.security import hash_password  # noqa: E402


async def _main_async() -> int:
    email = (os.environ.get("BOOTSTRAP_ADMIN_EMAIL") or "").strip()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD") or ""
    name = (os.environ.get("BOOTSTRAP_ADMIN_NAME") or "Bootstrap Admin").strip()

    if not email or not password:
        print(
            "error: BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set",
            file=sys.stderr,
        )
        return 2

    async with session_scope() as s, s.begin():
        existing = await s.execute(
            text(
                "SELECT 1 FROM users "
                "WHERE role = 'admin' AND is_active = TRUE LIMIT 1"
            )
        )
        if existing.scalar_one_or_none() is not None:
            print("admin already exists — skip")
            return 0

        # Email collision (race or a previous attempt that didn't promote
        # to admin) — surface explicitly rather than silently INSERT.
        dup = await s.execute(
            text("SELECT 1 FROM users WHERE LOWER(email) = LOWER(:e) LIMIT 1"),
            {"e": email},
        )
        if dup.scalar_one_or_none() is not None:
            print(
                f"error: email already in use ({email}); "
                "promote that user manually or pick another address",
                file=sys.stderr,
            )
            return 3

        await s.execute(
            text("""
                INSERT INTO users (email, name, password_hash, role, is_active)
                VALUES (:e, :n, :ph, 'admin', TRUE)
            """),
            {"e": email, "n": name, "ph": hash_password(password)},
        )
    print(f"created admin: {email}")
    return 0


def main() -> int:
    try:
        return asyncio.run(_main_async())
    except Exception as exc:
        print(f"bootstrap_admin failed: {exc!r}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
