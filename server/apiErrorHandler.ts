import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { UPLOAD_LIMIT_MESSAGE } from '../shared/uploadLimits.js';

export const apiErrorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (req.aborted || res.destroyed) return;
  if (error instanceof ZodError) return res.status(400).json({ error: 'VALIDATION', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) });
  const e = error as { status?: number; code?: string; type?: string; message?: string };
  if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'UPLOAD_LIMIT', message: UPLOAD_LIMIT_MESSAGE });
  if (e.code?.startsWith('LIMIT_')) return res.status(413).json({ error: 'INVALID_UPLOAD', message: 'The upload has too many fields or files.' });
  if (e.code === 'entity.too.large' || e.type === 'entity.too.large') return res.status(413).json({ error: 'REQUEST_TOO_LARGE', message: 'The request body is too large.' });
  if (e.code === 'entity.parse.failed' || e.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_REQUEST', message: 'The request body must contain valid JSON.' });
  if (e.code === 'ENOENT' || e.code === 'EACCES') return res.status(404).json({ error: 'NOT_FOUND' });
  if (e.code === '22P02') return res.status(400).json({ error: 'INVALID_ID' });
  const status = e.status || (e.code === '23505' ? 409 : 500);
  const errorCode = status >= 500 ? 'INTERNAL_ERROR' : e.code || (status === 409 ? 'CONFLICT' : 'REQUEST_ERROR');
  const message = status < 500 && !e.message?.includes('/') && !e.message?.includes('\\') ? e.message : undefined;
  return res.status(status).json({ error: errorCode, ...(message ? { message } : {}) });
};
