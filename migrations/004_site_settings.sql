CREATE TABLE IF NOT EXISTS site_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_settings(setting_key, setting_value) VALUES
  ('access_mode', 'public'),
  ('turnstile_enabled', 'false'),
  ('remember_login_enabled', 'false'),
  ('registration_enabled', 'false')
ON CONFLICT (setting_key) DO NOTHING;
