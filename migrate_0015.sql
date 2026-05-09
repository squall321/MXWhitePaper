BEGIN;
CREATE TABLE backup_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('full', 'user', 'doc')),
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  hour_utc INT NOT NULL DEFAULT 3,
  format TEXT NOT NULL CHECK (format IN ('json', 'html', 'md', 'docx', 'pptx')),
  target_user_id UUID NULL REFERENCES users(id),
  target_doc_slug TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ NULL,
  next_run_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NULL REFERENCES backup_schedules(id) ON DELETE SET NULL,
  scope TEXT NOT NULL,
  format TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  doc_count INT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_backup_runs_started ON backup_runs(started_at DESC);
UPDATE alembic_version SET version_num='0015_backups';
COMMIT;
