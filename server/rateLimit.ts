import type { RequestHandler } from 'express';

type RateLimitOptions = { limit: number; windowMs: number };
type Bucket = { count: number; resetAt: number };

export function createIpRateLimiter({ limit, windowMs }: RateLimitOptions): RequestHandler {
  return createRateLimiter({ limit, windowMs }, req => `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`);
}

export function createUserRateLimiter({ limit, windowMs }: RateLimitOptions): RequestHandler {
  return createRateLimiter({ limit, windowMs }, (req, res) => {
    const userId = (res.locals.user as { id?: string } | undefined)?.id;
    return userId ? `user:${userId}` : `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  });
}

function createRateLimiter({ limit, windowMs }: RateLimitOptions, keyFor: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => string): RequestHandler {
  // shortcut: counters are process-local; use shared storage before horizontal scaling.
  const buckets = new Map<string, Bucket>();
  let nextCleanup = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now >= nextCleanup) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      nextCleanup = now + windowMs;
    }
    const key = keyFor(req, res);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.set('RateLimit-Reset', String(retryAfter));
    if (bucket.count > limit) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' });
    }
    next();
  };
}
