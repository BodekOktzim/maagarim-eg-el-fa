import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { rateLimit } from "../rate-limit";
import { completeUpload, getUpload, initUpload, removeUpload, writeChunk } from "../upload";
import { isPCloudConfigured, uploadFileToPCloud } from "../pcloud";
import { enqueueImport, importJobStatus } from "../../workers/queues";
import { requireUploadAccessCode } from "../upload-access";
import { searchPublicPhone } from "../web-phone-search";
import { accessStats, bootstrapAdmin, createAccessCode, decryptSecret, getAccessSession, hashSecret, loginAdmin, loginWithAccessCode, logoutAccess, logoutAdmin, listAccessCodes, migrateAccessControl, requireAccess, requireAdmin, revokeAccessCode, deleteAccessCode, revealAccessCode } from "../access-auth";
import { activateAccessCode, createUser, getAccount, loginUser, logoutUser, requireUserSearch } from "../linked-account-auth";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/", (_req, res) => { res.status(200).json({ ok: true, service: "maagarim-web-search-api" }); });
  app.get("/healthz", (_req, res) => { res.status(200).json({ ok: true }); });
  app.get("/api/public-config", (req, res) => {
    const allowedOrigin = process.env.WEB_APP_ALLOWED_ORIGIN || "";
    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ turnstileSiteKey: process.env.VITE_TURNSTILE_SITE_KEY ?? "" });
  });
  const accessPool = process.env.POSTGRES_URL || process.env.DATABASE_URL ? (await import("../postgres")).PostgresRepository : null;
  const persisted = accessPool ? new accessPool() : null;
  if (persisted) { await persisted.migrate(); await migrateAccessControl(persisted.pool); const userMigration = await (await import("node:fs/promises")).readFile(new URL("../../migrations/003_user_accounts.sql", import.meta.url), "utf8"); await persisted.pool.query(userMigration); }
  app.use("/api", rateLimit({ windowMs: 60_000, max: 120, skip: (req) => req.path.startsWith("/uploads/") }));
  if (persisted) {
    const pool = persisted.pool;
    app.use(["/api/access", "/api/account", "/api/admin", "/api/protected-range"], (req, res, next) => {
      const allowedOrigin = process.env.WEB_APP_ALLOWED_ORIGIN || "";
      if (allowedOrigin && req.headers.origin === allowedOrigin) {
        res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Bootstrap-Secret");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") { res.status(204).end(); return; }
      next();
    });
    app.post("/api/account/register", async (req, res) => { try { res.status(201).json(await registerUser(pool, req, res, { username: String(req.body?.username ?? ""), password: String(req.body?.password ?? ""), captchaToken: req.body?.captchaToken })); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "ההרשמה נכשלה." }); } });
    app.post("/api/account/login", async (req, res) => { try { res.json(await loginUser(pool, req, res, { username: String(req.body?.username ?? ""), password: String(req.body?.password ?? ""), rememberMe: Boolean(req.body?.rememberMe), captchaToken: req.body?.captchaToken })); } catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "ההתחברות נכשלה." }); } });
    app.post("/api/account/logout", async (req, res) => { await logoutUser(pool, req, res); res.json({ success: true }); });
    app.get("/api/account/me", async (req, res) => { const state = await getUserAccess(pool, req); res.json({ authenticated: Boolean(state.session), user: state.session ? { id: state.session.user_id, username: state.session.username, isAdmin: await isLinkedAdmin(pool, state.session.user_id) } : null, access: state.access ? { label: state.access.label, expiresAt: state.access.expires_at } : null }); });
    app.post("/api/account/access-code", async (req, res) => { try { res.json(await activateAccessCode(pool, req, res, { code: String(req.body?.code ?? "") })); } catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "הפעלת הקוד נכשלה." }); } });
    app.post("/api/access/login", async (req, res) => { try { res.json(await loginWithAccessCode(pool, req, res, { password: String(req.body?.password ?? ""), captchaToken: req.body?.captchaToken })); } catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "הכניסה נכשלה." }); } });
    app.post("/api/access/logout", async (req, res) => { await logoutAccess(pool, req, res); res.json({ success: true }); });
    app.get("/api/access/me", async (req, res) => { const session = await getAccessSession(pool, req); res.json({ authenticated: Boolean(session), expiresAt: session?.expires_at?.toISOString() ?? null }); });
    app.post("/api/account/register", async (req, res) => { try { res.status(201).json(await createUser(pool, req, { username: String(req.body?.username ?? ""), password: String(req.body?.password ?? ""), turnstileToken: req.body?.turnstileToken })); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "ההרשמה נכשלה." }); } });
    app.post("/api/account/login", async (req, res) => { try { res.json(await loginUser(pool, req, res, { username: String(req.body?.username ?? ""), password: String(req.body?.password ?? ""), rememberMe: Boolean(req.body?.rememberMe), turnstileToken: req.body?.turnstileToken })); } catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "ההתחברות נכשלה." }); } });
    app.post("/api/account/logout", async (req, res) => { await logoutUser(pool, req, res); res.json({ success: true }); });
    app.get("/api/account/me", async (req, res) => { res.json(await getAccount(pool, req)); });
    app.post("/api/account/activate-code", async (req, res) => { try { res.json(await activateAccessCode(pool, req, { code: String(req.body?.code ?? "") })); } catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "הפעלת הקוד נכשלה." }); } });
    app.post("/api/admin/bootstrap", async (req, res) => { try { res.status(201).json(await bootstrapAdmin(pool, { bootstrapSecret: String(req.headers["x-admin-bootstrap-secret"] ?? req.body?.bootstrapSecret ?? ""), email: String(req.body?.email ?? ""), password: String(req.body?.password ?? "") })); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "יצירת מנהל נכשלה." }); } });
    app.post("/api/admin/login", async (req, res) => { try { res.json(await loginAdmin(pool, req, res, { email: String(req.body?.email ?? ""), password: String(req.body?.password ?? "") })); } catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "התחברות מנהל נכשלה." }); } });
    app.post("/api/admin/logout", async (req, res) => { await logoutAdmin(pool, req, res); res.json({ success: true }); });
    app.get("/api/admin/stats", requireAdmin(pool), async (_req, res) => { res.json(await accessStats(pool)); });
    app.get("/api/admin/access-codes", requireAdmin(pool), async (_req, res) => { res.json({ items: await listAccessCodes(pool) }); });
    app.get("/api/admin/users", requireAdmin(pool), async (_req, res) => { res.json({ items: await listUsers(pool) }); });
    app.post("/api/admin/users/:id/status", requireAdmin(pool), async (req, res) => { try { const status = String(req.body?.status ?? ""); if (!["active", "blocked", "deleted"].includes(status)) throw new Error("סטטוס לא תקין."); await setUserStatus(pool, req.params.id, status as "active" | "blocked" | "deleted"); res.json({ success: true }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "עדכון המשתמש נכשל." }); } });
    app.post("/api/admin/users/:id/sessions/revoke", requireAdmin(pool), async (req, res) => { await revokeUserSessions(pool, req.params.id); res.json({ success: true }); });
    app.post("/api/admin/users/:id/password", requireAdmin(pool), async (req, res) => { try { await resetUserPassword(pool, req.params.id, String(req.body?.password ?? "")); res.json({ success: true }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "איפוס הסיסמה נכשל." }); } });
    app.get("/api/admin/users/:id/password", requireAdmin(pool), async (req, res) => { try { res.json({ password: await revealUserPassword(pool, req.params.id) }); } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : "הסיסמה אינה זמינה." }); } });
    app.get("/api/admin/access-codes/:id/secret", requireAdmin(pool), async (req, res) => { try { res.json({ password: await revealAccessCode(pool, req.params.id) }); } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : "הסיסמה אינה זמינה." }); } });
    app.post("/api/admin/access-codes", requireAdmin(pool), async (req, res) => { try { res.status(201).json(await createAccessCode(pool, { password: req.body?.password, label: req.body?.label, validitySeconds: req.body?.validitySeconds == null ? null : Number(req.body.validitySeconds), maxUsers: req.body?.maxUsers == null || req.body.maxUsers === "" ? null : Number(req.body.maxUsers), maxSearches: req.body?.maxSearches == null || req.body.maxSearches === "" ? null : Number(req.body.maxSearches) })); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "יצירת סיסמה נכשלה." }); } });
    app.post("/api/admin/access-codes/:id/revoke", requireAdmin(pool), async (req, res) => { await revokeAccessCode(pool, req.params.id, Boolean(req.body?.disconnect)); res.json({ success: true }); });
    app.delete("/api/admin/access-codes/:id", requireAdmin(pool), async (req, res) => { await deleteAccessCode(pool, req.params.id); res.status(204).end(); });
    app.get("/api/admin/users", requireAdmin(pool), async (req, res) => { const search = String(req.query.search ?? "").trim(); const result = await pool.query("SELECT u.id, u.username, u.status, u.created_at, u.last_login_at, u.search_count, count(DISTINCT s.id)::int AS active_sessions, count(DISTINCT g.access_code_id)::int AS access_codes, max(g.expires_at) AS access_expires_at FROM user_accounts u LEFT JOIN user_sessions s ON s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now() LEFT JOIN access_code_user_grants g ON g.user_id = u.id AND (g.expires_at IS NULL OR g.expires_at > now()) WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%') GROUP BY u.id ORDER BY u.created_at DESC", [search]); res.json({ items: result.rows }); });
    app.post("/api/admin/users/:id/status", requireAdmin(pool), async (req, res) => { const status = req.body?.status === "blocked" ? "blocked" : "active"; await pool.query("UPDATE user_accounts SET status = $1, updated_at = now() WHERE id = $2", [status, req.params.id]); if (status === "blocked") await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.params.id]); res.json({ success: true, status }); });
    app.post("/api/admin/users/:id/reset-password", requireAdmin(pool), async (req, res) => { const nextPassword = String(req.body?.password ?? ""); if (nextPassword.length < 8 || nextPassword.length > 128) { res.status(400).json({ error: "הסיסמה חייבת להכיל 8–128 תווים." }); return; } await pool.query("UPDATE user_accounts SET password_hash = $1, password_ciphertext = $2, updated_at = now() WHERE id = $3", [await hashSecret(nextPassword), (await import("../access-auth")).encryptSecret(nextPassword), req.params.id]); await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.params.id]); res.json({ success: true }); });
    app.get("/api/admin/users/:id/password", requireAdmin(pool), async (req, res) => { const result = await pool.query<{ password_ciphertext: string | null }>("SELECT password_ciphertext FROM user_accounts WHERE id = $1", [req.params.id]); const secret = result.rows[0]?.password_ciphertext; if (!secret) { res.status(404).json({ error: "אין סיסמה מוצפנת זמינה." }); return; } res.json({ password: decryptSecret(secret) }); });
    app.post("/api/admin/users/:id/revoke-sessions", requireAdmin(pool), async (req, res) => { await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.params.id]); res.json({ success: true }); });
    app.delete("/api/admin/users/:id", requireAdmin(pool), async (req, res) => { await pool.query("UPDATE user_accounts SET status = 'deleted', updated_at = now() WHERE id = $1", [req.params.id]); await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.params.id]); res.status(204).end(); });
    const requireSearchAuthorization = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const hasAccountCookie = String(req.headers.cookie ?? "").includes("__Host-maagarim_user=");
      return (hasAccountCookie ? requireUserSearch(pool, true) : requireAccess(pool))(req, res, next);
    };
    app.get("/api/protected-range", requireSearchAuthorization, async (req, res) => {
      let target: URL;
      try { target = new URL(String(req.query.url ?? "")); } catch { res.status(400).json({ error: "כתובת נתונים לא תקינה." }); return; }
      if (target.protocol !== "https:" || !["media.githubusercontent.com", "raw.githubusercontent.com"].includes(target.hostname)) { res.status(403).json({ error: "מקור נתונים לא מורשה." }); return; }
      const start = Number(req.query.start); const end = Number(req.query.end);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start > 8_388_608) { res.status(416).json({ error: "טווח נתונים לא תקין." }); return; }
      const response = await fetch(target, { headers: { Range: `bytes=${start}-${end}` } });
      if (!response.ok) { res.status(response.status).end(); return; }
      res.status(response.status === 206 ? 206 : 200).setHeader("Content-Type", response.headers.get("content-type") ?? "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(Buffer.from(await response.arrayBuffer()));
    });
  } else {
    app.all(["/api/access/*", "/api/admin/*", "/api/protected-range"], (_req, res) => res.status(503).json({ error: "מערכת ההרשאות אינה מחוברת למסד נתונים." }));
    app.use(["/index-seek", "/search-index-full", "/datasets"], (_req, res) => res.status(503).json({ error: "נתוני החיפוש נעולים עד לחיבור מסד הנתונים." }));
  }
  app.use("/api/uploads", requireUploadAccessCode);
  app.use("/api/import-jobs", requireUploadAccessCode);
  app.use("/api/web-phone-search", (req, res, next) => {
    const allowedOrigin = process.env.WEB_SEARCH_ALLOWED_ORIGIN || "*";
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });
  app.post("/api/web-phone-search", async (req, res) => {
    try {
      const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
      if (!phone.trim()) { res.status(400).json({ error: "יש להזין מספר טלפון." }); return; }
      res.json(await searchPublicPhone(phone));
    } catch (error) {
      const message = error instanceof Error ? error.message : "web_phone_search_failed";
      res.status(message.includes("אינו מוגדר") ? 503 : 502).json({ error: message });
    }
  });
  app.post("/api/uploads/init", express.json({ limit: "32kb" }), async (req, res) => {
    try { const { fileName, size } = req.body as { fileName?: string; size?: number }; if (!fileName || size == null) { res.status(400).json({ error: "fileName and size are required" }); return; } res.status(201).json(await initUpload(fileName, size)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "upload_init_failed" }); }
  });
  app.get("/api/uploads/:id", async (req, res) => {
    try { res.json(await getUpload(req.params.id)); }
    catch { res.status(404).json({ error: "upload_not_found" }); }
  });
  app.put("/api/uploads/:id/chunks/:index", express.raw({ type: "application/octet-stream", limit: "9mb" }), async (req, res) => {
    try { const result = await writeChunk(req.params.id, Number(req.params.index), req.body as Buffer); res.json(result); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "chunk_upload_failed" }); }
  });
  app.post("/api/uploads/:id/complete", async (req, res) => {
    try {
      if (!isPCloudConfigured()) throw new Error("pCloud storage is not configured on the server");
      const upload = await completeUpload(req.params.id);
      const remote = await uploadFileToPCloud(upload.path, upload.fileName);
      const job = await enqueueImport({ sourceId: upload.id, format: upload.format, innerFormat: upload.innerFormat, storage: { provider: "pcloud", fileId: remote.fileid, fileName: remote.name, size: remote.size }, batchSize: 1000 });
      await removeUpload(upload.id);
      res.status(201).json({ id: upload.id, fileName: upload.fileName, size: upload.size, format: upload.format, storage: "pcloud", jobId: job.id, importStatusUrl: `/api/import-jobs/${job.id}` });
    }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "upload_incomplete" }); }
  });
  app.get("/api/import-jobs/:id", async (req, res) => { const status = await importJobStatus(req.params.id); if (!status) { res.status(404).json({ error: "job_not_found" }); return; } res.json(status); });
  app.delete("/api/uploads/:id", async (req, res) => { await removeUpload(req.params.id); res.status(204).end(); });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    if (persisted) app.use(["/index-seek", "/search-index-full", "/datasets"], requireAccess(persisted.pool));
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed", error);
  process.exitCode = 1;
});
