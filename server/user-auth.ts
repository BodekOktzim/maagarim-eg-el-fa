import type { Request, Response } from "express";
import type { Pool } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { parse as parseCookie } from "cookie";
import { encryptSecret, decryptSecret, ensureLinkedAdmin, hashSecret, isLinkedAdmin, loginLinkedAdmin, verifySecret, verifyTurnstile } from "./access-auth";

export const USER_COOKIE = "__Host-maagarim_user";
const SHORT_SESSION_SECONDS = 60 * 60 * 24;
const REMEMBER_SESSION_SECONDS = 60 * 60 * 24 * 90;

type UserRecord = { id: string; username: string; password_hash: string; password_ciphertext: string | null; status: "active" | "blocked" | "deleted" };
type UserSession = { id: string; user_id: string; username: string; user_status: UserRecord["status"]; expires_at: Date | null; remember_me: boolean };
type AccessCode = { id: string; code_hash: string; status: string; validity_kind: string; validity_seconds: string | number | null; expires_at: Date | null; max_users: number | null };

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function requestIp(req: Request) { return String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim().slice(0, 200); }
function userAgent(req: Request) { return String(req.headers["user-agent"] ?? "").slice(0, 1000); }
function cookieOptions(maxAgeSeconds?: number) { return { httpOnly: true, secure: true, sameSite: "none" as const, path: "/", ...(maxAgeSeconds == null ? {} : { maxAge: maxAgeSeconds * 1000 }) }; }
function setUserCookie(res: Response, value: string, maxAge?: number) { res.cookie(USER_COOKIE, value, cookieOptions(maxAge)); }
function clearUserCookie(res: Response) { res.clearCookie(USER_COOKIE, cookieOptions(0)); }
function userToken(req: Request) { return parseCookie(req.headers.cookie ?? "")[USER_COOKIE]; }
function cleanUsername(value: string) { return value.trim().replace(/\s+/g, " "); }
function validateUsername(value: string) { if (!value || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("שם המשתמש אינו תקין."); }
const RESERVED_USERNAMES = ["admin", "administrator", "root", "owner", "מנהל", "מנהל מערכת"];

async function logUserEvent(pool: Pool, eventType: string, userId?: string, metadata?: unknown) {
  await pool.query("INSERT INTO login_events(event_type, metadata) VALUES($1,$2)", [eventType, { ...(typeof metadata === "object" && metadata ? metadata : {}), userId: userId ?? null }]);
}

export async function registerUser(pool: Pool, req: Request, res: Response, input: { username: string; password: string; captchaToken?: string }) {
  const username = cleanUsername(input.username);
  validateUsername(username);
  if (RESERVED_USERNAMES.includes(username.toLowerCase())) throw new Error("שם המשתמש שמור למנהל המערכת.");
  if (input.password.length < 8 || input.password.length > 128) throw new Error("הסיסמה חייבת להכיל 8 עד 128 תווים.");
  if (!(await verifyTurnstile(input.captchaToken, requestIp(req)))) throw new Error("האימות האנושי נכשל.");
  const existing = await pool.query("SELECT id FROM user_accounts WHERE lower(username) = lower($1) LIMIT 1", [username]);
  if (existing.rows[0]) throw new Error("שם המשתמש כבר קיים.");
  const admins = await pool.query<{ email: string }>("SELECT email FROM admin_accounts WHERE status = 'active'");
  if (admins.rows.some((admin) => admin.email.split("@")[0].trim().toLowerCase() === username.toLowerCase())) throw new Error("שם המשתמש שמור למנהל המערכת.");
  let result: { rows: Array<{ id: string; username: string }> };
  try {
    result = await pool.query<{ id: string; username: string }>("INSERT INTO user_accounts(username, password_hash, password_ciphertext) VALUES($1,$2,$3) RETURNING id, username", [username, await hashSecret(input.password), encryptSecret(input.password)]);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new Error("שם המשתמש כבר קיים.");
    throw error;
  }
  await logUserEvent(pool, "user_registered", result.rows[0].id);
  return result.rows[0];
}

export async function loginUser(pool: Pool, req: Request, res: Response, input: { username: string; password: string; rememberMe?: boolean; captchaToken?: string }) {
  if (!(await verifyTurnstile(input.captchaToken, requestIp(req)))) throw new Error("האימות האנושי נכשל.");
  const username = cleanUsername(input.username);
  const result = await pool.query<UserRecord>("SELECT id, username, password_hash, password_ciphertext, status FROM user_accounts WHERE lower(username) = lower($1) LIMIT 1", [username]);
  const user = result.rows[0];
  if (!user || user.status !== "active" || !(await verifySecret(input.password, user.password_hash))) throw new Error("שם המשתמש או הסיסמה שגויים.");
  const rememberMe = Boolean(input.rememberMe);
  const expiresAt = new Date(Date.now() + (rememberMe ? REMEMBER_SESSION_SECONDS : SHORT_SESSION_SECONDS) * 1000);
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO user_sessions(user_id, token_hash, expires_at, remember_me, ip, user_agent) VALUES($1,$2,$3,$4,$5,$6)", [user.id, hashToken(token), expiresAt, rememberMe, requestIp(req), userAgent(req)]);
  await pool.query("UPDATE user_accounts SET last_login_at = now(), updated_at = now() WHERE id = $1", [user.id]);
  await logUserEvent(pool, "user_login", user.id, { rememberMe });
  setUserCookie(res, token, rememberMe ? REMEMBER_SESSION_SECONDS : SHORT_SESSION_SECONDS);
  await ensureLinkedAdmin(pool);
  const isAdmin = await isLinkedAdmin(pool, user.id);
  if (isAdmin) await loginLinkedAdmin(pool, req, res, user.id);
  return { id: user.id, username: user.username, expiresAt: expiresAt.toISOString(), rememberMe, isAdmin };
}

export async function getUserSession(pool: Pool, req: Request) {
  const token = userToken(req);
  if (!token) return null;
  const result = await pool.query<UserSession>("SELECT s.id, s.user_id, u.username, u.status AS user_status, s.expires_at, s.remember_me FROM user_sessions s JOIN user_accounts u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL LIMIT 1", [hashToken(token)]);
  const session = result.rows[0];
  if (!session || session.user_status !== "active" || (session.expires_at && session.expires_at.getTime() <= Date.now())) {
    await pool.query("UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1", [hashToken(token)]);
    return null;
  }
  await pool.query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [session.id]);
  return session;
}

export async function logoutUser(pool: Pool, req: Request, res: Response) {
  const token = userToken(req);
  if (token) await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token)]);
  const adminToken = parseCookie(req.headers.cookie ?? "")["__Host-maagarim_admin"];
  if (adminToken) await pool.query("UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(adminToken)]);
  clearUserCookie(res);
  res.clearCookie("__Host-maagarim_admin", cookieOptions(0));
}

export async function activateAccessCode(pool: Pool, req: Request, res: Response, input: { code: string }) {
  const session = await getUserSession(pool, req);
  if (!session) throw new Error("נדרשת התחברות לחשבון.");
  const candidates = await pool.query<AccessCode>("SELECT id, code_hash, status, validity_kind, validity_seconds, expires_at, max_users FROM access_codes WHERE status = 'active' AND deleted_at IS NULL");
  let matched: AccessCode | undefined;
  for (const candidate of candidates.rows) if (await verifySecret(input.code.trim(), candidate.code_hash)) { matched = candidate; break; }
  if (!matched) throw new Error("קוד הגישה שגוי.");
  if (matched.expires_at && matched.expires_at.getTime() <= Date.now()) throw new Error("קוד הגישה פג תוקף.");
  const existing = await pool.query<{ user_id: string }>("SELECT user_id FROM access_code_user_grants WHERE access_code_id = $1 AND (expires_at IS NULL OR expires_at > now())", [matched.id]);
  if (!existing.rows.some((row) => row.user_id === session.user_id) && matched.max_users != null && existing.rows.length >= matched.max_users) throw new Error("הקוד כבר בשימוש על ידי מספר המשתמשים המרבי.");
  const expiresAt = matched.expires_at ?? (matched.validity_kind === "fixed" && matched.validity_seconds ? new Date(Date.now() + Number(matched.validity_seconds) * 1000) : null);
  await pool.query("INSERT INTO access_code_user_grants(access_code_id, user_id, expires_at) VALUES($1,$2,$3) ON CONFLICT (access_code_id, user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at", [matched.id, session.user_id, expiresAt]);
  await logUserEvent(pool, "access_code_activated", session.user_id, { accessCodeId: matched.id });
  return { active: true, expiresAt: expiresAt?.toISOString() ?? null };
}

export async function getUserAccess(pool: Pool, req: Request) {
  const session = await getUserSession(pool, req);
  if (!session) return { session: null, access: null };
  const access = await pool.query("SELECT c.id, c.label, g.expires_at FROM access_code_user_grants g JOIN access_codes c ON c.id = g.access_code_id WHERE g.user_id = $1 AND c.status = 'active' AND c.deleted_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()) ORDER BY g.activated_at DESC LIMIT 1", [session.user_id]);
  return { session, access: access.rows[0] ?? null };
}

export async function requireUserAccess(pool: Pool, req: Request) { const state = await getUserAccess(pool, req); if (!state.session) throw new Error("נדרשת התחברות לחשבון."); if (!state.access) throw new Error("נדרשת הרשאת גישה."); return state; }

export async function listUsers(pool: Pool) { return (await pool.query("SELECT u.id, u.username, u.status, u.created_at, u.last_login_at, u.search_count, count(DISTINCT s.id) FILTER (WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()))::int AS active_sessions, count(DISTINCT g.access_code_id)::int AS access_codes FROM user_accounts u LEFT JOIN user_sessions s ON s.user_id = u.id LEFT JOIN access_code_user_grants g ON g.user_id = u.id AND (g.expires_at IS NULL OR g.expires_at > now()) WHERE u.status <> 'deleted' GROUP BY u.id ORDER BY u.created_at DESC")).rows; }
export async function setUserStatus(pool: Pool, id: string, status: "active" | "blocked" | "deleted") { await pool.query("UPDATE user_accounts SET status = $1, updated_at = now() WHERE id = $2", [status, id]); if (status !== "active") await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]); }
export async function revokeUserSessions(pool: Pool, id: string) { await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]); }
export async function resetUserPassword(pool: Pool, id: string, password: string) { if (password.length < 8) throw new Error("הסיסמה חייבת להכיל לפחות 8 תווים."); await pool.query("UPDATE user_accounts SET password_hash = $1, password_ciphertext = $2, updated_at = now() WHERE id = $3", [await hashSecret(password), encryptSecret(password), id]); await revokeUserSessions(pool, id); }
export async function revealUserPassword(pool: Pool, id: string) { const result = await pool.query<{ password_ciphertext: string | null }>("SELECT password_ciphertext FROM user_accounts WHERE id = $1 AND status <> 'deleted'", [id]); if (!result.rows[0]?.password_ciphertext) throw new Error("סיסמת המשתמש אינה זמינה."); return decryptSecret(result.rows[0].password_ciphertext); }
