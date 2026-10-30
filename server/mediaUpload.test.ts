import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiErrorHandler } from './apiErrorHandler.js';
import { createMediaUpload } from './mediaUpload.js';
import { createUserRateLimiter } from './rateLimit.js';
import { MAX_UPLOAD_BYTES } from '../shared/uploadLimits.js';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

async function uploadApp(options: { authenticated?: boolean; limit?: number } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mie-upload-protection-'));
  folders.push(directory);
  const app = express();
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    if (!options.authenticated) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    res.locals.user = { id: 'seller-1' };
    next();
  };
  app.post('/api/media', authenticate, ...(options.limit ? [createUserRateLimiter({ limit: options.limit, windowMs: 60_000 })] : []), createMediaUpload(directory), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'INVALID_FILE' });
    const filename = req.file.filename;
    await unlink(req.file.path);
    res.status(201).json({ filename });
  });
  app.use(apiErrorHandler);
  return { app, directory };
}

describe('media upload abuse controls', () => {
  it('requires authentication before Multer writes a temporary file', async () => {
    const test = await uploadApp();
    const response = await request(test.app).post('/api/media').field('kind', 'avatar').attach('file', Buffer.from('image'), 'avatar.png');
    expect(response.status).toBe(401);
    expect(await readdir(test.directory)).toEqual([]);
  });

  it('accepts one supported upload and uses a generated UUID filename', async () => {
    const test = await uploadApp({ authenticated: true });
    const response = await request(test.app).post('/api/media').field('kind', 'avatar').attach('file', Buffer.from('image'), 'avatar.png');
    expect(response.status).toBe(201);
    expect(response.body.filename).toMatch(/^[0-9a-f-]{36}\.png$/i);
    expect(await readdir(test.directory)).toEqual([]);
  });

  it('rejects unsupported MIME types without leaving temporary files', async () => {
    const test = await uploadApp({ authenticated: true });
    const response = await request(test.app).post('/api/media').field('kind', 'avatar').attach('file', Buffer.from('not an image'), 'payload.exe');
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_FILE');
    expect(await readdir(test.directory)).toEqual([]);
  });

  it('rejects files over the existing 12 MiB limit and cleans partial staging files', async () => {
    const test = await uploadApp({ authenticated: true });
    const response = await request(test.app).post('/api/media').field('kind', 'avatar').attach('file', Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'large.png');
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ error: 'UPLOAD_LIMIT', message: expect.stringContaining('12 MB') });
    expect(await readdir(test.directory)).toEqual([]);
  });

  it('rejects excess multipart fields and duplicate user uploads before parsing the next file', async () => {
    const fields = await uploadApp({ authenticated: true });
    const tooManyFields = await request(fields.app).post('/api/media').field('kind', 'avatar').field('extra', 'unused').field('third', 'unused').attach('file', Buffer.from('image'), 'avatar.png');
    expect(tooManyFields.status).toBe(413);
    expect(await readdir(fields.directory)).toEqual([]);

    const duplicate = await uploadApp({ authenticated: true, limit: 1 });
    const first = await request(duplicate.app).post('/api/media').field('kind', 'avatar').attach('file', Buffer.from('image'), 'avatar.png');
    const second = await request(duplicate.app).post('/api/media').field('kind', 'avatar').attach('file', Buffer.from('image'), 'avatar.png');
    expect(first.status).toBe(201);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ error: 'RATE_LIMITED', message: expect.any(String) });
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
    expect(await readdir(duplicate.directory)).toEqual([]);
  });
});
