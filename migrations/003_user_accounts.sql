CREATE TABLE IF NOT EXISTS user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CHECK (status IN ('active', 'blocked', 'deleted')),
  CHECK (char_length(username) BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  remember_me BOOLEAN NOT NULL DEFAULT false,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS access_code_users (
  access_code_id UUID NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (access_code_id, user_id)
);

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS max_users INTEGER;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_access_code_users_user ON access_code_users(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON user_accounts(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_accounts_username_ci ON user_accounts (lower(username));
