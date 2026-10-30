import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaStorage, LocalStorage, R2Storage } from './storage.js';

const key = '00000000-0000-4000-8000-000000000001.png';
const folders: string[] = [];
async function local() { const root = await mkdtemp(path.join(os.tmpdir(), 'mie-media-')); folders.push(root); return { root, storage: new LocalStorage(root) }; }
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

describe('local media storage', () => {
  it('uploads once, reads, checks, and deletes without overwriting', async () => {
    const { root, storage } = await local();
    const bytes = Buffer.from('local image');
    await storage.put(key, Readable.from([bytes]), 'image/png', bytes.length);
    await expect(storage.put(key, Readable.from('changed'), 'image/png', 7)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(root, key))).toEqual(bytes);
    expect(await storage.exists(key)).toBe(true);
    const object = await storage.get(key);
    expect(object?.contentLength).toBe(bytes.length);
    const chunks: Buffer[] = [];
    for await (const chunk of object!.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();
  });

  it('rejects unsafe keys', async () => {
    const { storage } = await local();
    await expect(storage.exists('../private.pdf')).rejects.toThrow('Invalid media object key');
  });

  it('aborts a staged write and removes its partial object', async () => {
    const { storage } = await local();
    const controller = new AbortController();
    controller.abort();
    await expect(storage.put(key, Readable.from('partial'), 'image/png', 7, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await storage.exists(key)).toBe(false);
  });
});

describe('R2 media storage', () => {
  it('uses conditional private-object operations and streams reads', async () => {
    const bytes = Buffer.from('r2 object');
    const send = vi.fn(async (command: any, _options?: any) => {
      if (command instanceof GetObjectCommand) return { Body: Readable.from(bytes), ContentType: 'image/png', ContentLength: bytes.length };
      return {};
    });
    const storage = new R2Storage({ send } as unknown as Pick<S3Client, 'send'>, 'private-media');
    const controller = new AbortController();
    await storage.put(key, Readable.from([bytes]), 'image/png', bytes.length, controller.signal);
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'private-media', Key: key, IfNoneMatch: '*', ContentType: 'image/png' });
    expect(send.mock.calls[0][1]).toEqual({ abortSignal: controller.signal });
    expect(await storage.get(key)).toMatchObject({ contentType: 'image/png', contentLength: bytes.length });
    send.mockResolvedValueOnce({} as any);
    await storage.delete(key);
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('treats missing R2 objects as absent and propagates other failures', async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' })).mockRejectedValueOnce(new Error('network'));
    const storage = new R2Storage({ send } as unknown as Pick<S3Client, 'send'>, 'private-media');
    expect(await storage.get(key)).toBeNull();
    await expect(storage.exists(key)).rejects.toThrow('network');
    expect(send.mock.calls[1][0]).toBeInstanceOf(HeadObjectCommand);
  });
});

describe('storage configuration', () => {
  it('uses local disk for development without R2 credentials', async () => {
    const storage = createMediaStorage({ NODE_ENV: 'development' }, os.tmpdir());
    expect(storage).toBeInstanceOf(LocalStorage);
  });

  it('fails production startup when R2 configuration is absent', () => {
    expect(() => createMediaStorage({ NODE_ENV: 'production' }, os.tmpdir())).toThrow(/R2_ACCOUNT_ID.*R2_BUCKET_NAME/);
  });
});
