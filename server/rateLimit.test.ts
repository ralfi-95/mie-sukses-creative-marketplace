import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createIpRateLimiter, createUserRateLimiter } from './rateLimit.js';

describe('IP rate limiter', () => {
  it('allows requests up to the limit and returns 429 with retry guidance after it', async () => {
    const app = express();
    app.use(createIpRateLimiter({ limit: 2, windowMs: 60_000 }));
    app.get('/', (_req, res) => res.sendStatus(204));
    expect((await request(app).get('/')).status).toBe(204);
    expect((await request(app).get('/')).status).toBe(204);
    const limited = await request(app).get('/');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: 'RATE_LIMITED', message: expect.any(String) });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not key clients from arbitrary forwarded headers when Express proxy trust is disabled', async () => {
    const app = express();
    app.use(createIpRateLimiter({ limit: 1, windowMs: 60_000 }));
    app.get('/', (_req, res) => res.sendStatus(204));
    expect((await request(app).get('/').set('X-Forwarded-For', '198.51.100.10')).status).toBe(204);
    expect((await request(app).get('/').set('X-Forwarded-For', '203.0.113.20')).status).toBe(429);
  });

  it('enforces per-user limits across changing IP headers while allowing another user', async () => {
    const app = express();
    app.use((req, res, next) => { res.locals.user = { id: req.get('x-test-user') || 'user-1' }; next(); });
    app.use(createUserRateLimiter({ limit: 1, windowMs: 60_000 }));
    app.get('/', (_req, res) => res.sendStatus(204));
    expect((await request(app).get('/').set('X-Test-User', 'user-1').set('X-Forwarded-For', '198.51.100.10')).status).toBe(204);
    expect((await request(app).get('/').set('X-Test-User', 'user-1').set('X-Forwarded-For', '203.0.113.20')).status).toBe(429);
    expect((await request(app).get('/').set('X-Test-User', 'user-2')).status).toBe(204);
  });
});
