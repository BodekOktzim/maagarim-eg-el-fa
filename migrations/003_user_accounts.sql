CREATE TABLE IF NOT EXISTS user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  search_count BIGINT NOT NULL DEFAULT 0,
  CHECK (status IN ('active', 'blocked', 'deleted')),
  CHECK (char_length(username) BETWEEN 2 AND 80)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  remember_me BOOLEAN NOT NULL DEFAULT false,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS access_code_user_grants (
  access_code_id UUID NOT NULL REFERENCES access_codes(id),
  user_id UUID NOT NULL REFERENCES user_accounts(id),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (access_code_id, user_id)
);

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS max_users INTEGER;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS validity_start_at TIMESTAMPTZ;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS max_searches BIGINT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS search_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS password_ciphertext TEXT;

CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON user_accounts(status);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_code_grants_user ON access_code_user_grants(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_code_grants_code ON access_code_user_grants(access_code_id);
