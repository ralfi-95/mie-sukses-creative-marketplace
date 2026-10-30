export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const UPLOAD_LIMIT_MESSAGE = 'Each file must be 12 MB or smaller.';

export function assertUploadSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_BYTES) {
    throw new Error(UPLOAD_LIMIT_MESSAGE);
  }
}
