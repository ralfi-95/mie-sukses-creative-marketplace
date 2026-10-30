import type { PoolConfig } from 'pg';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function connectionConfig(connectionString: string | undefined, purpose: 'runtime' | 'migration'): PoolConfig {
  if (!connectionString) throw new Error(`Set ${purpose === 'runtime' ? 'DATABASE_URL' : 'DATABASE_URL_UNPOOLED'} before connecting.`);

  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error('Database connection URL is invalid.'); }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Database URL must use PostgreSQL.');

  const isLocal = localHosts.has(url.hostname);
  const isNeon = url.hostname.endsWith('.neon.tech');
  if (!isLocal && !isNeon) throw new Error('Database URL must target local PostgreSQL or Neon.');

  if (isLocal && (decodeURIComponent(url.username) !== 'marketplace_app' || decodeURIComponent(url.pathname.slice(1)) !== 'mie_sukses_marketplace')) {
    throw new Error('Local DATABASE_URL must target mie_sukses_marketplace as marketplace_app.');
  }

  if (isNeon && !['require', 'verify-full'].includes(url.searchParams.get('sslmode') || '')) throw new Error('Neon DATABASE_URL must require TLS with sslmode=require or verify-full.');
  if (isNeon && purpose === 'runtime' && !url.hostname.includes('-pooler.')) throw new Error('Neon runtime DATABASE_URL must use the pooled endpoint.');
  if (isNeon && purpose === 'migration' && url.hostname.includes('-pooler.')) throw new Error('Neon migrations require DATABASE_URL_UNPOOLED with the direct endpoint.');

  if (isNeon) url.searchParams.set('sslmode', 'verify-full');
  return { connectionString: url.toString(), max: 10 };
}
