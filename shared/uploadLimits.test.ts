import { describe, expect, it } from 'vitest';
import { assertUploadSize, MAX_UPLOAD_BYTES, UPLOAD_LIMIT_MESSAGE } from './uploadLimits';

describe('shared upload size limit', () => {
  it('accepts files up to and including 12 MiB', () => {
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES)).not.toThrow();
  });

  it('rejects files larger than 12 MiB with the shared message', () => {
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES + 1)).toThrow(UPLOAD_LIMIT_MESSAGE);
  });
});
