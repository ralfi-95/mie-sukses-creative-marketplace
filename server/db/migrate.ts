import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { connectionConfig } from './connectionConfig.js';
const { Pool } = pg;
const pool = new Pool(connectionConfig(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, 'migration'));
try {
 const target = await pool.query('select current_database() as db, current_user as role');
 const configuredUrl = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL!);
 if (target.rows[0].db !== decodeURIComponent(configuredUrl.pathname.slice(1)) || target.rows[0].role !== decodeURIComponent(configuredUrl.username)) throw new Error('Refusing migration: connected database and role do not match the configured URL.');
 console.log('Verified configured migration target.');
 const client = await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(742001)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await (await import('node:fs/promises')).readdir(path.resolve('migrations'))).filter(x => x.endsWith('.sql')).sort();
  for (const name of files) {
   const found = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
   if (found.rowCount) continue;
   await client.query(await readFile(path.resolve('migrations', name), 'utf8'));
   await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
   console.log(`Applied ${name}`);
  }
  await client.query('COMMIT');
 } catch (error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
} finally { await pool.end(); }
