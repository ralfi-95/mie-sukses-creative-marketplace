import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

const keyPattern = /^[0-9a-f-]{36}\.(png|jpg|webp|pdf|doc|docx)$/i;
function assertKey(key: string) {
  if (!keyPattern.test(key) || path.basename(key) !== key) throw new Error('Invalid media object key.');
}

export interface StoredObject { body: Readable; contentType?: string; contentLength?: number }
export interface MediaStorage {
  put(key: string, body: Readable, contentType: string, contentLength: number, signal?: AbortSignal): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorage implements MediaStorage {
  constructor(private readonly root: string) {}

  async put(key: string, body: Readable, _contentType: string, _contentLength: number, signal?: AbortSignal) {
    assertKey(key);
    await mkdir(this.root, { recursive: true });
    const target = path.join(this.root, key);
    const handle = await open(target, 'wx');
    try {
      await pipeline(body, createWriteStream(target, { fd: handle.fd, autoClose: false }), { signal });
      await handle.close();
    } catch (error) { await handle.close().catch(() => {}); await unlink(target).catch(() => {}); throw error; }
  }

  async get(key: string): Promise<StoredObject | null> {
    assertKey(key);
    const target = path.join(this.root, key);
    try {
      const metadata = await stat(target);
      if (!metadata.isFile()) return null;
      return { body: createReadStream(target), contentLength: metadata.size };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async delete(key: string) {
    assertKey(key);
    try { await unlink(path.join(this.root, key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  async exists(key: string) {
    assertKey(key);
    try { return (await stat(path.join(this.root, key))).isFile(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
}

export class R2Storage implements MediaStorage {
  constructor(private readonly client: Pick<S3Client, 'send'>, private readonly bucket: string) {}

  async put(key: string, body: Readable, contentType: string, contentLength: number, signal?: AbortSignal) {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: contentLength, IfNoneMatch: '*' }), { abortSignal: signal });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertKey(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return result.Body ? { body: result.Body as Readable, contentType: result.ContentType, contentLength: result.ContentLength } : null;
    } catch (error) { if (isMissing(error)) return null; throw error; }
  }

  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string) {
    assertKey(key);
    try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return true; }
    catch (error) { if (isMissing(error)) return false; throw error; }
  }
}

function isMissing(error: unknown) {
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.Code === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

export function createMediaStorage(env: NodeJS.ProcessEnv, localRoot: string): MediaStorage {
  if (env.NODE_ENV !== 'production') return new LocalStorage(localRoot);
  const required = ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_REGION'] as const;
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Production storage is not configured. Missing: ${missing.join(', ')}.`);
  if (env.R2_REGION !== 'auto') throw new Error('R2_REGION must be set to auto.');
  const client = new S3Client({
    region: env.R2_REGION,
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  });
  return new R2Storage(client, env.R2_BUCKET_NAME!);
}
