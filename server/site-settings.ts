import type { Pool } from "pg";

export type AccessMode = "public" | "access_code" | "account";
export type SiteSettings = {
  accessMode: AccessMode;
  turnstileEnabled: boolean;
  registrationEnabled: boolean;
};

const DEFAULTS: SiteSettings = {
  accessMode: "public",
  turnstileEnabled: false,
  registrationEnabled: false,
};

function asBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === "true" || value === "1";
}

export async function getSiteSettings(pool: Pool): Promise<SiteSettings> {
  const result = await pool.query<{ setting_key: string; setting_value: string }>(
    "SELECT setting_key, setting_value FROM site_settings",
  );
  const values = new Map(result.rows.map((row) => [row.setting_key, row.setting_value]));
  const rawMode = values.get("access_mode");
  const accessMode: AccessMode = rawMode === "access_code" || rawMode === "account" ? rawMode : "public";
  return {
    accessMode,
    turnstileEnabled: false,
      registrationEnabled: asBoolean(values.get("registration_enabled"), DEFAULTS.registrationEnabled),
  };
}

export function publicSiteSettings(settings: SiteSettings) {
  return {
    accessMode: settings.accessMode,
    turnstileEnabled: settings.turnstileEnabled,
    registrationEnabled: settings.registrationEnabled,
  };
}

export async function updateSiteSettings(pool: Pool, input: Partial<SiteSettings>) {
  const current = await getSiteSettings(pool);
  const next: SiteSettings = {
    accessMode: input.accessMode === "public" || input.accessMode === "access_code" || input.accessMode === "account" ? input.accessMode : current.accessMode,
    turnstileEnabled: false,
      registrationEnabled: typeof input.registrationEnabled === "boolean" ? input.registrationEnabled : current.registrationEnabled,
  };
  await pool.query(
    "INSERT INTO site_settings(setting_key, setting_value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()",
    ["access_mode", next.accessMode],
  );
  for (const [key, value] of [["turnstile_enabled", next.turnstileEnabled], ["registration_enabled", next.registrationEnabled]] as const) {
    await pool.query(
      "INSERT INTO site_settings(setting_key, setting_value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()",
      [key, String(value)],
    );
  }
  return next;
}
