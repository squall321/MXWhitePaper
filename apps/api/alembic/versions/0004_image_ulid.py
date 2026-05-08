"""images.ulid — Crockford ULID column for DocumentJSON v1.0 ImageBlock.imageId

Revision ID: 0004_image_ulid
Revises: 0003_images_pending
Create Date: 2026-05-07 11:00:00

DocumentJSON v1.0 의 ImageBlock.imageId 는 Ulid (Crockford 26-char) 인 반면
images.id 는 uuid 였다. 이 둘이 어긋나면 finalize 가 발급하는 image_id 를
FE 가 본문에 넣을 때 Pydantic 검증에서 실패한다. 본 마이그레이션은:

1) images 에 NOT NULL UNIQUE TEXT 컬럼 ulid 추가.
2) 기존 행이 있다면 합성 ULID 로 백필 (Crockford 26-char). pgcrypto 의
   gen_random_bytes 를 써서 base32 인코딩하지 않고, 단순 random hex 를
   Crockford 알파벳에 매핑해 26자 채운다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0004_image_ulid"
down_revision: str | Sequence[str] | None = "0003_images_pending"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1) NULL 허용으로 컬럼 추가
    op.execute("ALTER TABLE images ADD COLUMN IF NOT EXISTS ulid TEXT")

    # 2) 기존 행 백필. 빈 테이블이면 NOTICE 만 남기고 통과.
    #    Crockford alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (32자, I/L/O/U 제외)
    #    pgcrypto.gen_random_bytes(16) 를 16바이트 → 26 base32 chars 로 변환하기보다
    #    단순히 32 알파벳에서 랜덤 26자를 뽑는 PL/pgSQL 함수 1회용 정의.
    op.execute("""
        DO $$
        DECLARE
            r RECORD;
            alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
            new_ulid TEXT;
            i INT;
            row_count INT;
        BEGIN
            SELECT COUNT(*) INTO row_count FROM images WHERE ulid IS NULL;
            IF row_count = 0 THEN
                RAISE NOTICE 'images.ulid backfill: no rows to update';
            ELSE
                FOR r IN SELECT id FROM images WHERE ulid IS NULL LOOP
                    new_ulid := '';
                    FOR i IN 1..26 LOOP
                        new_ulid := new_ulid || substr(alphabet, 1 + (floor(random() * 32))::int, 1);
                    END LOOP;
                    UPDATE images SET ulid = new_ulid WHERE id = r.id;
                END LOOP;
                RAISE NOTICE 'images.ulid backfill: % rows updated', row_count;
            END IF;
        END $$;
    """)

    # 3) NOT NULL + UNIQUE 제약 적용
    op.execute("ALTER TABLE images ALTER COLUMN ulid SET NOT NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS images_ulid_uniq ON images(ulid)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS images_ulid_uniq")
    op.execute("ALTER TABLE images DROP COLUMN IF EXISTS ulid")
