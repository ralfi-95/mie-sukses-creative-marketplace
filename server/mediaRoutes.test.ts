import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaReadHandler, persistMediaUpload } from './mediaRoutes.js';
import type { MediaStorage } from './storage.js';

const filename = '00000000-0000-4000-8000-000000000001.pdf';
const owner = 'owner-id';
const tempFolders: string[] = [];
afterEach(async () => { await Promise.all(tempFolders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

function mediaApp(kind: string, row: Record<string, unknown>, options: { user?: { id: string; role: string } | null; orderAccess?: boolean; missing?: boolean } = {}) {
  const db = { query: vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT m.kind')) return { rowCount: 1, rows: [{ kind, owner_id: owner, role: 'seller', status: 'active', avatar_path: null, is_public: false, ...row }] };
    return { rowCount: options.orderAccess ? 1 : 0, rows: [] };
  }) };
  const storage = { get: vi.fn(async () => options.missing ? null : ({ body: Readable.from([Buffer.from('file body')]), contentType: 'application/pdf', contentLength: 9 })), put: vi.fn(), delete: vi.fn(), exists: vi.fn() } as unknown as MediaStorage;
  const app = express();
  app.get('/media/:filename', createMediaReadHandler(db, storage, async () => options.user ?? null));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(500));
  return { app, db, storage };
}

describe('authorized media reads', () => {
  it('serves the four fixed demo assets statically without requiring storage records', async () => {
    for (const demo of ['demo-edit.svg', 'demo-photo.svg', 'demo-design.svg', 'demo-ui.svg']) {
      const test = mediaApp('service', {});
      expect((await request(test.app).get(`/media/${demo}`)).status).toBe(200);
      expect(test.db.query).not.toHaveBeenCalled();
      expect(test.storage.get).not.toHaveBeenCalled();
    }
  });

  it('streams published service media but not draft or suspended service media', async () => {
    const published = mediaApp('service', { is_public: true });
    expect((await request(published.app).get(`/media/${filename}`)).status).toBe(200);
    expect(published.storage.get).toHaveBeenCalledOnce();
    for (const state of ['draft', 'suspended']) {
      const privateService = mediaApp('service', { is_public: false, state });
      expect((await request(privateService.app).get(`/media/${filename}`)).status).toBe(404);
      expect(privateService.storage.get).not.toHaveBeenCalled();
    }
  });

  it('authorizes private deliverables before opening them and returns safe not-found responses', async () => {
    const denied = mediaApp('deliverable', {}, { user: { id: 'other', role: 'buyer' }, orderAccess: false });
    expect((await request(denied.app).get(`/media/${filename}`)).status).toBe(404);
    expect(denied.storage.get).not.toHaveBeenCalled();

    const allowed = mediaApp('deliverable', {}, { user: { id: 'buyer', role: 'buyer' }, orderAccess: true });
    const response = await request(allowed.app).get(`/media/${filename}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain(filename);
    expect(allowed.storage.get).toHaveBeenCalledOnce();

    const missing = mediaApp('deliverable', {}, { user: { id: owner, role: 'seller' }, missing: true });
    expect((await request(missing.app).get(`/media/${filename}`)).status).toBe(404);
  });
});

describe('media upload consistency', () => {
  async function sourceFile() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mie-upload-'));
    const file = path.join(dir, 'temporary-upload');
    tempFolders.push(dir);
    await writeFile(file, 'validated bytes');
    return file;
  }

  it('does not create a database record after an object upload failure', async () => {
    const storage = { put: vi.fn().mockRejectedValue(new Error('R2 unavailable')), get: vi.fn(), delete: vi.fn(), exists: vi.fn() } as unknown as MediaStorage;
    const db = { connect: vi.fn() };
    await expect(persistMediaUpload(storage, db, { filename, path: await sourceFile(), contentType: 'application/pdf', contentLength: 15, ownerId: owner, kind: 'application', orderId: null })).rejects.toThrow('R2 unavailable');
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('cleans a confirmed object if the client disconnects before metadata is written', async () => {
    const controller = new AbortController();
    const storage = { put: vi.fn(async (_key: string, body: Readable) => { for await (const _chunk of body) {} ; controller.abort(); }), get: vi.fn(), delete: vi.fn(), exists: vi.fn() } as unknown as MediaStorage;
    const db = { connect: vi.fn() };
    await expect(persistMediaUpload(storage, db, { filename, path: await sourceFile(), contentType: 'application/pdf', contentLength: 15, ownerId: owner, kind: 'application', orderId: null }, controller.signal)).rejects.toThrow('Upload was cancelled.');
    expect(db.connect).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(filename);
  });

  it('removes the object and rolls back when database metadata fails', async () => {
    const storage = { put: vi.fn(async (_key, body: Readable) => { for await (const _chunk of body) {} }), get: vi.fn(), delete: vi.fn(), exists: vi.fn() } as unknown as MediaStorage;
    const query = vi.fn(async (sql: string) => { if (sql.startsWith('INSERT')) throw new Error('database unavailable'); return {}; });
    const release = vi.fn();
    const db = { connect: vi.fn(async () => ({ query, release })) };
    await expect(persistMediaUpload(storage, db, { filename, path: await sourceFile(), contentType: 'application/pdf', contentLength: 15, ownerId: owner, kind: 'application', orderId: null })).rejects.toThrow('database unavailable');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringMatching(/^INSERT/), 'ROLLBACK']);
    expect(storage.delete).toHaveBeenCalledWith(filename);
    expect(release).toHaveBeenCalledOnce();
  });

  it('updates avatar metadata in the same database transaction as its media row', async () => {
    const storage = { put: vi.fn(async (_key, body: Readable) => { for await (const _chunk of body) {} }), get: vi.fn(), delete: vi.fn(), exists: vi.fn() } as unknown as MediaStorage;
    const query = vi.fn(async () => ({}));
    const db = { connect: vi.fn(async () => ({ query, release: vi.fn() })) };
    await persistMediaUpload(storage, db, { filename, path: await sourceFile(), contentType: 'image/png', contentLength: 15, ownerId: owner, kind: 'avatar', orderId: null });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringMatching(/^INSERT/), expect.stringMatching(/^UPDATE users SET avatar_path/), 'COMMIT']);
  });
});
