import multer from 'multer';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { MAX_UPLOAD_BYTES } from '../shared/uploadLimits.js';

const extensions: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export function createMediaUpload(directory: string): RequestHandler {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, directory),
      filename: (_req, file, callback) => callback(null, `${randomUUID()}${extensions[file.mimetype] || '.bin'}`),
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 2, fieldSize: 1024, fieldNameSize: 64, parts: 3 },
    fileFilter: (_req, file, callback) => callback(null, Object.hasOwn(extensions, file.mimetype)),
  }).single('file');
}
