import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createOriginPolicy } from './originPolicy.js';

function app() {
  const instance = express();
  instance.use(createOriginPolicy('https://market.example'));
  instance.post('/api/change', (_req, res) => res.sendStatus(204));
  return instance;
}

describe('origin policy', () => {
  it('allows credentials and preflight only for the configured origin', async () => {
    const response = await request(app()).options('/api/change')
      .set('Origin', 'https://market.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://market.example');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects other origins and mutating requests without an origin', async () => {
    expect((await request(app()).post('/api/change').set('Origin', 'https://attacker.example')).status).toBe(403);
    expect((await request(app()).post('/api/change')).status).toBe(403);
  });

  it('rejects unsupported preflight headers', async () => {
    const response = await request(app()).options('/api/change')
      .set('Origin', 'https://market.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(response.status).toBe(403);
  });
});
