import { describe, expect, it } from 'vitest';
import { connectionConfig } from './connectionConfig.js';

const pooled = 'postgresql://app:secret@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
const direct = 'postgresql://app:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require';

describe('database connection configuration', () => {
  it('uses the Neon pooled endpoint for runtime', () => {
    expect(new URL(connectionConfig(pooled, 'runtime').connectionString).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('uses the Neon direct endpoint for migrations', () => {
    expect(new URL(connectionConfig(direct, 'migration').connectionString).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('keeps the exact local development target', () => {
    expect(connectionConfig('postgres://marketplace_app:secret@127.0.0.1:5432/mie_sukses_marketplace', 'runtime').max).toBe(10);
  });

  it.each([
    ['unpooled Neon runtime URL', direct, 'runtime'],
    ['pooled Neon migration URL', pooled, 'migration'],
    ['Neon URL without TLS', 'postgres://app:secret@ep-example-pooler.us-east-2.aws.neon.tech/neondb', 'runtime'],
    ['unknown remote host', 'postgres://app:secret@db.example.com/neondb', 'runtime'],
    ['wrong local target', 'postgres://other:secret@127.0.0.1:5432/postgres', 'runtime'],
  ] as const)('rejects %s', (_name, url, purpose) => {
    expect(() => connectionConfig(url, purpose)).toThrow();
  });
});
