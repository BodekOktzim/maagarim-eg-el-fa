import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { promisify } from "node:util";
import { parse as parseCookie } from "cookie";
import type { Pool, QueryResult } from "pg";

const scrypt = promisify(scryptCallback);
const ACCESS_COOKIE = "__Host-maagarim_access";
const ADMIN_COOKIE = "__Host-maagarim_admin";
const SESSION_TTL_SECONDS = 60 * 30;
const ADMIN_TTL_SECONDS = 60 * 60 * 8;

type AccessRecord = { id: string; code_hash: string; label: string | null; validity_kind: string; validity_seconds: string | number | null; status: string; expires_at?: Date | null };
type SessionRecord = { id: string; access_code_id: string; expires_at: Date | null; revoked_at: Date | null; code_status: string };
type AdminRecord = { id: string; email: string; password_hash: string; status: string; user_id?: string | null };

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function requestIp(req: Request) { return String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim().slice(0, 200); }
function userAgent(req: Request) { return String(req.headers["user-agent"] ?? "").slice(0, 1000); }
function cookieOptions(maxAgeSeconds?: number) { return { httpOnly: true, secure: true, sameSite: "none" as const, path: "/", ...(maxAgeSeconds == null ? {} : { maxAge: maxAgeSeconds * 1000 }) }; }
function clearCookie(res: Response, name: string) { res.clearCookie(name, cookieOptions(0)); }
function setCookie(res: Response, name: string, value: string, maxAge?: number) { res.cookie(name, value, cookieOptions(maxAge)); }

export async function hashSecret(value: string) {
  const salt = randomBytes(16);
  const digest = await scrypt(value, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}
export async function verifySecret(value: string, encoded: string) {
  const [, saltText, digestText] = encoded.split("$");
  if (!saltText || !digestText) return false;
  try {
    const actual = await scrypt(value, Buffer.from(saltText, "base64url"), 64) as Buffer;
    const expected = Buffer.from(digestText, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
function generateAccessCode() { return Array.from({ length: 3 }, () => randomBytes(3).toString("hex").toUpperCase()).join("-"); }
function getCookie(req: Request, name: string) { return parseCookie(req.headers.cookie ?? "")[name]; }
function isProduction() { return process.env.NODE_ENV === "production"; }
function encryptionKey() {
  const configured = process.env.ACCESS_SECRET_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!configured) throw new Error("ACCESS_SECRET_KEY is not configured");
  return createHash("sha256").update(configured).digest();
}
export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1$${iv.toString("base64url")}$${cipher.getAuthTag().toString("base64url")}$${encrypted.toString("base64url")}`;
}
export function decryptSecret(encoded: string) {
  const [, ivText, tagText, dataText] = encoded.split("$");
  if (!ivText || !tagText || !dataText) throw new Error("סיסמה מוצפנת אינה תקינה.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function verifyTurnstile(token: unknown, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    if (isProduction()) throw new Error("CAPTCHA is not configured");
    return true;
  }
  if (typeof token !== "string" || token.length < 10) return false;
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, response: token, remoteip: ip }) });
  if (!response.ok) return false;
  const payload = await response.json() as { success?: boolean };
  return payload.success === true;
}

async function logEvent(pool: Pool, eventType: string, fields: { accessCodeId?: string; accessSessionId?: string; adminId?: string; ip?: string; userAgent?: string; metadata?: unknown }) {
  await pool.query("INSERT INTO login_events(event_type, access_code_id, access_session_id, admin_id, ip, user_agent, metadata) VALUES($1,$2,$3,$4,$5,$6,$7)", [eventType, fields.accessCodeId ?? null, fields.accessSessionId ?? null, fields.adminId ?? null, fields.ip ?? null, fields.userAgent ?? null, fields.metadata ?? {}]);
}

export async function migrateAccessControl(pool: Pool) {
  const sql = await (await import("node:fs/promises")).readFile(new URL("../migrations/002_access_control.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export async function ensureLinkedAdmin(pool: Pool) {
  const user = await pool.query<{ id: string }>("SELECT id FROM user_accounts WHERE lower(username) = 'eliya' AND status = 'active' LIMIT 1");
  if (!user.rows[0]) return { linked: false };
  const existing = await pool.query<{ id: string }>("SELECT id FROM admin_accounts WHERE user_id = $1 LIMIT 1", [user.rows[0].id]);
  if (existing.rows[0]) return { linked: true, userId: user.rows[0].id };
  const email = `linked-${user.rows[0].id}@admin.local`;
  const randomAdminSecretHash = await hashSecret(randomBytes(32).toString("base64url"));
  await pool.query("INSERT INTO admin_accounts(email, password_hash, user_id) VALUES($1,$2,$3) ON CONFLICT (email) DO NOTHING", [email, randomAdminSecretHash, user.rows[0].id]);
  return { linked: true, userId: user.rows[0].id };
}

export async function loginLinkedAdmin(pool: Pool, req: Request, res: Response, userId: string) {
  const result = await pool.query<AdminRecord>("SELECT id, email, password_hash, status, user_id FROM admin_accounts WHERE user_id = $1 AND status = 'active' LIMIT 1", [userId]);
  const admin = result.rows[0];
  if (!admin) return false;
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO admin_sessions(admin_id, token_hash, expires_at, ip, user_agent) VALUES($1,$2,now() + interval '8 hours',$3,$4)", [admin.id, hashToken(token), requestIp(req), userAgent(req)]);
  await pool.query("UPDATE admin_accounts SET last_login_at = now(), updated_at = now() WHERE id = $1", [admin.id]);
  await logEvent(pool, "admin_login", { adminId: admin.id, ip: requestIp(req), userAgent: userAgent(req), metadata: { success: true, loginMethod: "linked_user" } });
  setCookie(res, ADMIN_COOKIE, token, ADMIN_TTL_SECONDS);
  return true;
}

export async function isLinkedAdmin(pool: Pool, userId: string) {
  const result = await pool.query<{ id: string }>("SELECT id FROM admin_accounts WHERE user_id = $1 AND status = 'active' LIMIT 1", [userId]);
  return Boolean(result.rows[0]);
}

export async function loginWithAccessCode(pool: Pool, req: Request, res: Response, input: { password: string; captchaToken?: string }) {
  const ip = requestIp(req);
  if (!(await verifyTurnstile(input.captchaToken, ip))) { await logEvent(pool, "login_failed", { ip, userAgent: userAgent(req), metadata: { reason: "captcha" } }); throw new Error("האימות האנושי נכשל."); }
  const candidates = await pool.query<AccessRecord>("SELECT id, code_hash, label, validity_kind, validity_seconds, status FROM access_codes WHERE status = 'active' AND deleted_at IS NULL");
  let matched: AccessRecord | undefined;
  for (const candidate of candidates.rows) if (await verifySecret(input.password, candidate.code_hash)) { matched = candidate; break; }
  if (!matched) { await logEvent(pool, "login_failed", { ip, userAgent: userAgent(req), metadata: { reason: "invalid" } }); throw new Error("סיסמת הגישה שגויה."); }
  const validity = matched.validity_kind === "fixed" && matched.validity_seconds ? Number(matched.validity_seconds) : null;
  const sessionLifetimeSeconds = validity == null ? undefined : Math.min(SESSION_TTL_SECONDS, validity);
  const expiresAt = sessionLifetimeSeconds == null ? null : new Date(Date.now() + sessionLifetimeSeconds * 1000);
  const token = randomBytes(32).toString("base64url");
  const session = await pool.query<{ id: string }>("INSERT INTO access_sessions(access_code_id, token_hash, expires_at, ip, user_agent) VALUES($1,$2,$3,$4,$5) RETURNING id", [matched.id, hashToken(token), expiresAt, ip, userAgent(req)]);
  await pool.query("UPDATE access_codes SET use_count = use_count + 1, login_count = login_count + 1, first_used_at = COALESCE(first_used_at, now()), last_used_at = now(), updated_at = now() WHERE id = $1", [matched.id]);
  await logEvent(pool, "login_success", { accessCodeId: matched.id, accessSessionId: session.rows[0].id, ip, userAgent: userAgent(req) });
  setCookie(res, ACCESS_COOKIE, token, sessionLifetimeSeconds);
  return { expiresAt: expiresAt?.toISOString() ?? null, label: matched.label };
}

export async function getAccessSession(pool: Pool, req: Request): Promise<SessionRecord | null> {
  const token = getCookie(req, ACCESS_COOKIE);
  if (!token) return null;
  const result = await pool.query<SessionRecord>("SELECT s.id, s.access_code_id, s.expires_at, s.revoked_at, c.status AS code_status FROM access_sessions s JOIN access_codes c ON c.id = s.access_code_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND c.deleted_at IS NULL LIMIT 1", [hashToken(token)]);
  const session = result.rows[0];
  if (!session || session.code_status !== "active" || (session.expires_at && session.expires_at.getTime() <= Date.now())) {
    await pool.query("UPDATE access_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1", [hashToken(token)]);
    return null;
  }
  await pool.query("UPDATE access_sessions SET last_seen_at = now() WHERE id = $1", [session.id]);
  return session;
}

export function requireAccess(pool: Pool) { return async (req: Request, res: Response, next: NextFunction) => { try { const session = await getAccessSession(pool, req); if (!session) { res.status(401).json({ error: "נדרשת סיסמת גישה." }); return; } (req as Request & { accessSession?: SessionRecord }).accessSession = session; next(); } catch (error) { next(error); } }; }

export async function logoutAccess(pool: Pool, req: Request, res: Response) { const token = getCookie(req, ACCESS_COOKIE); if (token) await pool.query("UPDATE access_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token)]); clearCookie(res, ACCESS_COOKIE); }

export async function createAccessCode(pool: Pool, input: { password?: string; label?: string; validitySeconds?: number | null; maxUsers?: number | null }) { const password = input.password?.trim() || generateAccessCode(); if (password.length < 6 || password.length > 128) throw new Error("סיסמת הגישה חייבת להכיל 6 עד 128 תווים."); const maxUsers = input.maxUsers == null ? null : Math.max(1, Math.floor(input.maxUsers)); const codeHash = await hashSecret(password); const secretCiphertext = encryptSecret(password); const kind = input.validitySeconds == null ? "unlimited" : "fixed"; await pool.query("INSERT INTO access_codes(code_hash, secret_ciphertext, label, validity_kind, validity_seconds, max_users) VALUES($1,$2,$3,$4,$5,$6)", [codeHash, secretCiphertext, input.label?.trim() || null, kind, input.validitySeconds, maxUsers]); return { password, validityKind: kind, validitySeconds: input.validitySeconds ?? null, maxUsers }; }

async function getAdmin(pool: Pool, req: Request) { const token = getCookie(req, ADMIN_COOKIE); if (!token) return null; const result = await pool.query<AdminRecord>("SELECT a.id, a.email, a.password_hash, a.status FROM admin_sessions s JOIN admin_accounts a ON a.id = s.admin_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND a.status = 'active' LIMIT 1", [hashToken(token)]); return result.rows[0] ?? null; }
export function requireAdmin(pool: Pool) { return async (req: Request, res: Response, next: NextFunction) => { try { const admin = await getAdmin(pool, req); if (!admin) { res.status(401).json({ error: "נדרשת התחברות מנהל." }); return; } (req as Request & { admin?: AdminRecord }).admin = admin; next(); } catch (error) { next(error); } }; }
export async function loginAdmin(pool: Pool, req: Request, res: Response, input: { email: string; password: string }) { const result = await pool.query<AdminRecord>("SELECT id, email, password_hash, status FROM admin_accounts WHERE lower(email) = lower($1) LIMIT 1", [input.email.trim()]); const admin = result.rows[0]; if (!admin || admin.status !== "active" || !(await verifySecret(input.password, admin.password_hash))) { await logEvent(pool, "admin_login", { ip: requestIp(req), userAgent: userAgent(req), metadata: { success: false } }); throw new Error("פרטי מנהל שגויים."); } const token = randomBytes(32).toString("base64url"); await pool.query("INSERT INTO admin_sessions(admin_id, token_hash, expires_at, ip, user_agent) VALUES($1,$2,now() + interval '8 hours',$3,$4)", [admin.id, hashToken(token), requestIp(req), userAgent(req)]); await pool.query("UPDATE admin_accounts SET last_login_at = now(), updated_at = now() WHERE id = $1", [admin.id]); await logEvent(pool, "admin_login", { adminId: admin.id, ip: requestIp(req), userAgent: userAgent(req), metadata: { success: true } }); setCookie(res, ADMIN_COOKIE, token, ADMIN_TTL_SECONDS); return { email: admin.email }; }
export async function logoutAdmin(pool: Pool, req: Request, res: Response) { const token = getCookie(req, ADMIN_COOKIE); if (token) await pool.query("UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1", [hashToken(token)]); clearCookie(res, ADMIN_COOKIE); }
export async function bootstrapAdmin(pool: Pool, input: { bootstrapSecret: string; email: string; password: string }) { const expected = process.env.ADMIN_BOOTSTRAP_SECRET?.trim(); if (!expected || input.bootstrapSecret !== expected) throw new Error("פרטי bootstrap שגויים."); const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM admin_accounts"); if (Number(count.rows[0]?.count ?? 0) > 0) throw new Error("Admin כבר הוגדר."); if (input.password.length < 12) throw new Error("סיסמת מנהל חייבת להכיל לפחות 12 תווים."); const result = await pool.query<{ id: string; email: string }>("INSERT INTO admin_accounts(email, password_hash) VALUES($1,$2) RETURNING id, email", [input.email.trim().toLowerCase(), await hashSecret(input.password)]); return result.rows[0]; }

export async function listAccessCodes(pool: Pool) { return (await pool.query("SELECT id, label, validity_kind, validity_seconds, max_users, status, created_at, first_used_at, last_used_at, use_count, login_count, revoked_at, (secret_ciphertext IS NOT NULL) AS has_secret FROM access_codes WHERE deleted_at IS NULL ORDER BY created_at DESC")).rows; }
export async function revealAccessCode(pool: Pool, id: string) { const result = await pool.query<{ secret_ciphertext: string | null }>("SELECT secret_ciphertext FROM access_codes WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [id]); const ciphertext = result.rows[0]?.secret_ciphertext; if (!ciphertext) throw new Error("לסיסמה הישנה אין עותק מוצפן להצגה. יש ליצור סיסמה חדשה."); return decryptSecret(ciphertext); }
export async function revokeAccessCode(pool: Pool, id: string, disconnect: boolean) { await pool.query("UPDATE access_codes SET status = 'revoked', revoked_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL", [id]); if (disconnect) await pool.query("UPDATE access_sessions SET revoked_at = now() WHERE access_code_id = $1 AND revoked_at IS NULL", [id]); }
export async function deleteAccessCode(pool: Pool, id: string) { await pool.query("UPDATE access_codes SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1", [id]); }
export async function accessStats(pool: Pool) { const result = await pool.query("SELECT count(*) FILTER (WHERE status='active' AND deleted_at IS NULL)::int AS active_codes, count(*) FILTER (WHERE status='revoked')::int AS revoked_codes, count(*) FILTER (WHERE status='deleted')::int AS deleted_codes FROM access_codes"); const sessions = await pool.query("SELECT count(*)::int AS active_sessions FROM access_sessions WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())"); const events = await pool.query("SELECT count(*) FILTER (WHERE event_type='login_success')::int AS total_logins, count(*) FILTER (WHERE event_type='login_success' AND created_at >= current_date)::int AS today_logins, count(*) FILTER (WHERE event_type='login_failed')::int AS failed_logins FROM login_events"); return { ...result.rows[0], ...sessions.rows[0], ...events.rows[0] }; }
export { ACCESS_COOKIE, ADMIN_COOKIE };
