import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { encryptSecret, hashSecret, verifySecret, hashToken, requestIp, userAgent, verifyTurnstile } from "./access-auth";

const USER_COOKIE = "__Host-maagarim_user";
const SESSION_SECONDS = 30 * 60;
const REMEMBER_SECONDS = 90 * 24 * 60 * 60;
type User = { id: string; username: string; status: string; created_at: Date; last_login_at: Date | null };
type UserSession = User & { session_id: string; session_expires_at: Date; remember_me: boolean };
function cookieOptions(maxAge: number) { return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: maxAge * 1000 }; }
function clearCookie(res: Response) { res.clearCookie(USER_COOKIE, cookieOptions(0)); }
function setCookie(res: Response, token: string, maxAge: number) { res.cookie(USER_COOKIE, token, cookieOptions(maxAge)); }
function cookie(req: Request) { return String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${USER_COOKIE}=`))?.slice(USER_COOKIE.length + 1); }
function normalizeUsername(username: string) { return username.trim().toLocaleLowerCase("en-US"); }
function validUsername(username: string) { return username.length >= 3 && username.length <= 32 && !/[^\u0590-\u05FFa-zA-Z0-9_.-]/.test(username); }

export async function createUser(pool: Pool, req: Request, input: { username: string; password: string; turnstileToken?: string }) {
  const username = input.username.trim();
  if (!validUsername(username)) throw new Error("שם המשתמש צריך להכיל 3–32 תווים: אותיות, ספרות, נקודה, מקף או קו תחתון.");
  if (input.password.length < 8 || input.password.length > 128) throw new Error("הסיסמה חייבת להכיל 8–128 תווים.");
  if (!(await verifyTurnstile(input.turnstileToken, requestIp(req)))) throw new Error("האימות האנושי נכשל.");
  try {
    return (await pool.query<{ id: string; username: string }>("INSERT INTO user_accounts(username, username_normalized, password_hash, password_ciphertext) VALUES($1,$2,$3,$4) RETURNING id, username", [username, normalizeUsername(username), await hashSecret(input.password), encryptSecret(input.password)])).rows[0];
  } catch (error) { if (String(error).includes("user_accounts_username_normalized_key")) throw new Error("שם המשתמש כבר קיים."); throw error; }
}

async function sessionUser(pool: Pool, req: Request): Promise<UserSession | null> {
  const token = cookie(req); if (!token) return null;
  const result = await pool.query<UserSession>("SELECT u.id, u.username, u.status, u.created_at, u.last_login_at, s.id AS session_id, s.expires_at AS session_expires_at, s.remember_me FROM user_sessions s JOIN user_accounts u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() LIMIT 1", [hashToken(token)]);
  const user = result.rows[0];
  if (!user || user.status !== "active") { await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token)]); return null; }
  await pool.query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [user.session_id]); return user;
}

export async function loginUser(pool: Pool, req: Request, res: Response, input: { username: string; password: string; rememberMe?: boolean; turnstileToken?: string }) {
  if (!(await verifyTurnstile(input.turnstileToken, requestIp(req)))) throw new Error("האימות האנושי נכשל.");
  const result = await pool.query<User & { password_hash: string }>("SELECT id, username, status, created_at, last_login_at, password_hash FROM user_accounts WHERE username_normalized = $1 LIMIT 1", [normalizeUsername(input.username)]);
  const user = result.rows[0];
  if (!user || user.status !== "active" || !(await verifySecret(input.password, user.password_hash))) throw new Error("שם המשתמש או הסיסמה שגויים.");
  const remember = Boolean(input.rememberMe); const lifetime = remember ? REMEMBER_SECONDS : SESSION_SECONDS; const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO user_sessions(user_id, token_hash, remember_me, expires_at, ip, user_agent) VALUES($1,$2,$3,now() + ($4 * interval '1 second'),$5,$6)", [user.id, hashToken(token), remember, lifetime, requestIp(req), userAgent(req)]);
  await pool.query("UPDATE user_accounts SET last_login_at = now(), updated_at = now() WHERE id = $1", [user.id]); setCookie(res, token, lifetime);
  return { username: user.username, expiresAt: new Date(Date.now() + lifetime * 1000).toISOString() };
}
export async function logoutUser(pool: Pool, req: Request, res: Response) { const token = cookie(req); if (token) await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token)]); clearCookie(res); }

async function activeGrant(pool: Pool, userId: string) {
  const result = await pool.query("SELECT c.id, c.label, c.status, c.expires_at, c.validity_kind, c.validity_seconds, c.max_users, c.max_searches, c.search_count FROM access_code_user_grants g JOIN access_codes c ON c.id = g.access_code_id WHERE g.user_id = $1 AND c.status = 'active' AND c.deleted_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()) AND (c.expires_at IS NULL OR c.expires_at > now()) ORDER BY g.activated_at DESC LIMIT 1", [userId]);
  const code = result.rows[0]; if (!code) return null; return { ...code, active: code.max_searches == null || Number(code.search_count) < Number(code.max_searches) };
}
export async function getAccount(pool: Pool, req: Request) { const user = await sessionUser(pool, req); if (!user) return { authenticated: false, user: null, access: null }; return { authenticated: true, user: { id: user.id, username: user.username, status: user.status, createdAt: user.created_at, lastLoginAt: user.last_login_at }, session: { expiresAt: user.session_expires_at, rememberMe: user.remember_me }, access: await activeGrant(pool, user.id) }; }

export async function activateAccessCode(pool: Pool, req: Request, input: { code: string }) {
  const user = await sessionUser(pool, req); if (!user) throw new Error("נדרשת התחברות משתמש.");
  const candidates = (await pool.query<{ id: string; code_hash: string; max_users: number | null; expires_at: Date | null; validity_seconds: number | null }>("SELECT id, code_hash, max_users, expires_at, validity_seconds FROM access_codes WHERE status = 'active' AND deleted_at IS NULL")).rows;
  const matched = (await Promise.all(candidates.map(async (candidate) => ({ candidate, valid: await verifySecret(input.code.trim(), candidate.code_hash) })))).find(({ candidate, valid }) => valid && (!candidate.expires_at || candidate.expires_at.getTime() > Date.now()))?.candidate;
  if (!matched) throw new Error("קוד הגישה שגוי או שפג תוקפו.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM access_code_user_grants WHERE access_code_id = $1 AND user_id = $2", [matched.id, user.id]);
    if (!existing.rowCount) {
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM access_code_user_grants WHERE access_code_id = $1", [matched.id]);
      if (matched.max_users != null && Number(count.rows[0]?.count ?? 0) >= matched.max_users) throw new Error("הקוד כבר בשימוש על ידי מספר המשתמשים המרבי.");
      const grantExpiry = matched.expires_at ?? (matched.validity_seconds ? new Date(Date.now() + Number(matched.validity_seconds) * 1000) : null);
      await client.query("INSERT INTO access_code_user_grants(access_code_id, user_id, expires_at) VALUES($1,$2,$3)", [matched.id, user.id, grantExpiry]);
    }
    await client.query("UPDATE access_codes SET use_count = use_count + 1, first_used_at = COALESCE(first_used_at, now()), last_used_at = now(), updated_at = now() WHERE id = $1", [matched.id]); await client.query("COMMIT"); return { success: true, accessCodeId: matched.id };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function authorizeUser(pool: Pool, req: Request, options: { consumeQuota: boolean }) {
  const user = await sessionUser(pool, req); if (!user) throw new Error("נדרשת התחברות משתמש."); if (user.status !== "active") throw new Error("המשתמש חסום.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = (await client.query("SELECT c.id, c.max_searches, c.search_count FROM access_code_user_grants g JOIN access_codes c ON c.id = g.access_code_id WHERE g.user_id = $1 AND c.status = 'active' AND c.deleted_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()) AND (c.expires_at IS NULL OR c.expires_at > now()) ORDER BY g.activated_at DESC FOR UPDATE", [user.id])).rows;
    const code = rows.find((row) => row.max_searches == null || Number(row.search_count) < Number(row.max_searches)); if (!code) throw new Error("אין הרשאת חיפוש פעילה או שמכסת החיפושים הסתיימה.");
    if (options.consumeQuota && code.max_searches != null) await client.query("UPDATE access_codes SET search_count = search_count + 1, updated_at = now() WHERE id = $1 AND search_count < max_searches", [code.id]);
    await client.query("COMMIT"); return { user, code };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export function requireUser(pool: Pool) { return async (req: Request, res: Response, next: NextFunction) => { try { const user = await sessionUser(pool, req); if (!user) { res.status(401).json({ error: "נדרשת התחברות משתמש." }); return; } if (user.status !== "active") { res.status(403).json({ error: "המשתמש חסום." }); return; } (req as Request & { accountUser?: UserSession }).accountUser = user; next(); } catch (error) { next(error); } }; }
export function requireUserSearch(pool: Pool, consumeQuota = false) { return async (req: Request, res: Response, next: NextFunction) => { try { const result = await authorizeUser(pool, req, { consumeQuota }); (req as Request & { accountUser?: UserSession; accountAccess?: unknown }).accountUser = result.user; (req as Request & { accountAccess?: unknown }).accountAccess = result.code; next(); } catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "החיפוש חסום." }); } }; }
export { USER_COOKIE };
