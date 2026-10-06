CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  secret_ciphertext TEXT,
  label TEXT,
  validity_kind TEXT NOT NULL DEFAULT 'unlimited',
  validity_seconds BIGINT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_used_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  use_count BIGINT NOT NULL DEFAULT 0,
  login_count BIGINT NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CHECK (validity_kind IN ('fixed', 'unlimited')),
  CHECK (status IN ('active', 'revoked', 'deleted')),
  CHECK (validity_seconds IS NULL OR validity_seconds > 0)
);

CREATE TABLE IF NOT EXISTS access_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_codes(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CHECK (status IN ('active', 'revoked'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS login_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  access_code_id UUID REFERENCES access_codes(id),
  access_session_id UUID REFERENCES access_sessions(id),
  admin_id UUID REFERENCES admin_accounts(id),
  ip TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID REFERENCES admin_accounts(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_codes_status ON access_codes(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_access_sessions_token ON access_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_access_sessions_code ON access_sessions(access_code_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_code ON login_events(access_code_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS secret_ciphertext TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_access_codes_expires ON access_codes(expires_at);
