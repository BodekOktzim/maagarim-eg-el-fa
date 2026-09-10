import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };
export function rateLimit(options: { windowMs?: number; max?: number } = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 120;
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = String(req.ip ?? req.headers["x-forwarded-for"] ?? "unknown");
    const now = Date.now();
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - bucket.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));
    if (bucket.count > max) { res.status(429).json({ error: "RATE_LIMITED", retryAfterMs: bucket.resetAt - now }); return; }
    next();
  };
}
