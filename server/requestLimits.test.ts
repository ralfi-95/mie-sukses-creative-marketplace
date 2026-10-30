import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiErrorHandler } from './apiErrorHandler.js';
import { jsonBodyParser } from './requestLimits.js';

describe('JSON request body limit', () => {
  it('accepts ordinary requests and safely rejects bodies over 100 KiB', async () => {
    const app = express();
    app.use(jsonBodyParser);
    app.post('/api/example', (req, res) => res.json({ accepted: typeof req.body.value === 'string' }));
    app.get('/api/failure', (_req, _res, next) => next(Object.assign(new Error('internal path C:\\private\\data'), { status: 500 })));
    app.use(apiErrorHandler);

    expect((await request(app).post('/api/example').send({ value: 'normal' })).status).toBe(200);
    const oversized = await request(app).post('/api/example').send({ value: 'x'.repeat(101 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({ error: 'REQUEST_TOO_LARGE', message: 'The request body is too large.' });

    const malformed = await request(app).post('/api/example').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: 'INVALID_REQUEST', message: 'The request body must contain valid JSON.' });

    const failed = await request(app).get('/api/failure');
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: 'INTERNAL_ERROR' });
  });
});
