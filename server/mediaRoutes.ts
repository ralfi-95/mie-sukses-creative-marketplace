import type { Request, RequestHandler } from 'express';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import path from 'node:path';
import type { MediaStorage } from './storage.js';
import { canReadDeliverable } from './mediaPolicy.js';

type User = { id: string; role: string };
type QueryResult = { rowCount: number | null; rows: Array<Record<string, any>> };
type Database = { query(sql: string, values?: unknown[]): Promise<QueryResult> };
type CurrentUser = (req: Request) => Promise<User | null>;

const mediaType: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const demoName = /^demo-(edit|photo|design|ui)\.svg$/;
const uploadName = /^[0-9a-f-]{36}\.(png|jpg|webp|pdf|doc|docx)$/i;

export function createMediaReadHandler(db: Database, storage: MediaStorage, current: CurrentUser): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const filename = req.params.filename;
      if (path.basename(filename) !== filename || (!uploadName.test(filename) && !demoName.test(filename))) return res.status(404).end();
      if (demoName.test(filename)) return res.sendFile(path.resolve('public', filename));

      const objectPath = `/media/${filename}`;
      const result = await db.query("SELECT m.kind,m.owner_id,u.role,u.status,u.avatar_path,EXISTS(SELECT 1 FROM services s JOIN users seller ON seller.id=s.seller_id WHERE s.thumbnail_path=m.path AND s.status='published' AND seller.status='active') is_public FROM media_uploads m JOIN users u ON u.id=m.owner_id WHERE m.path=$1", [objectPath]);
      if (!result.rowCount) return res.status(404).end();
      const media = result.rows[0];
      let allowed = media.kind === 'service' && media.is_public;
      if (media.kind === 'avatar' && media.role === 'seller' && media.status === 'active' && media.avatar_path === objectPath) allowed = true;
      let user: User | null = null;
      if (media.kind === 'deliverable' || media.kind === 'application' || !allowed) {
        user = await current(req);
        if (media.kind === 'deliverable' && user) {
          let hasOrderAccess = false;
          if (user.id !== media.owner_id) {
            const access = await db.query('SELECT 1 FROM order_deliverables d JOIN orders o ON o.id=d.order_id WHERE d.media_path=$1 AND ($2=o.buyer_id OR $3=true)', [objectPath, user.id, user.role === 'admin']);
            hasOrderAccess = Boolean(access.rowCount);
          }
          allowed = canReadDeliverable(user.id, media.owner_id, hasOrderAccess);
        } else allowed = Boolean(user && (user.id === media.owner_id || (media.kind === 'application' && user.role === 'admin')));
      }
      if (!allowed) return res.status(404).end();

      const object = await storage.get(filename);
      if (!object) return res.status(404).end();
      res.type(mediaType[path.extname(filename).toLowerCase()] || object.contentType || 'application/octet-stream');
      if (object.contentLength !== undefined) res.setHeader('Content-Length', object.contentLength);
      if (media.kind === 'deliverable') res.attachment(filename);
      pipeline(object.body, res, error => {
        if (error) { if (res.headersSent) res.destroy(error); else next(error); }
      });
      return undefined;
    })().catch(next);
  };
}

type UploadDatabase = { connect(): Promise<{ query(sql: string, values?: unknown[]): Promise<unknown>; release(): void }> };
export async function persistMediaUpload(
  storage: MediaStorage,
  db: UploadDatabase,
  input: { filename: string; path: string; contentType: string; contentLength: number; ownerId: string; kind: string; orderId: string | null },
  signal?: AbortSignal,
) {
  await storage.put(input.filename, createReadStream(input.path), input.contentType, input.contentLength, signal);
  let client: Awaited<ReturnType<UploadDatabase['connect']>> | undefined;
  try {
    if (signal?.aborted) throw new Error('Upload was cancelled.');
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('INSERT INTO media_uploads(path,owner_id,kind,order_id) VALUES($1,$2,$3,$4)', [`/media/${input.filename}`, input.ownerId, input.kind, input.orderId]);
    if (input.kind === 'avatar') await client.query('UPDATE users SET avatar_path=$1 WHERE id=$2', [`/media/${input.filename}`, input.ownerId]);
    await client.query('COMMIT');
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    try { await storage.delete(input.filename); } catch { console.error('Uploaded media cleanup failed after a database error.'); }
    throw error;
  } finally { client?.release(); }
}
