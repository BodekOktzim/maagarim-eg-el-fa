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
import { completeUpload, initUpload, removeUpload, writeChunk } from "../upload";
import { enqueueImport, importJobStatus } from "../../workers/queues";

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
  app.use("/api", rateLimit({ windowMs: 60_000, max: 120 }));
  app.post("/api/uploads/init", express.json({ limit: "32kb" }), async (req, res) => {
    try { const { fileName, size } = req.body as { fileName?: string; size?: number }; if (!fileName || size == null) { res.status(400).json({ error: "fileName and size are required" }); return; } res.status(201).json(await initUpload(fileName, size)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "upload_init_failed" }); }
  });
  app.put("/api/uploads/:id/chunks/:index", express.raw({ type: "application/octet-stream", limit: "9mb" }), async (req, res) => {
    try { const result = await writeChunk(req.params.id, Number(req.params.index), req.body as Buffer); res.json(result); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "chunk_upload_failed" }); }
  });
  app.post("/api/uploads/:id/complete", async (req, res) => {
    try { const upload = await completeUpload(req.params.id); const job = await enqueueImport({ sourceId: upload.id, filePath: upload.path, format: upload.format, batchSize: 1000 }); res.status(201).json({ ...upload, jobId: job.id, importStatusUrl: `/api/import-jobs/${job.id}` }); }
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
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
