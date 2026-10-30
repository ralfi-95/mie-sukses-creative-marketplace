import pg from 'pg';
import 'dotenv/config';
import { connectionConfig } from './connectionConfig.js';
const { Pool } = pg;
export const pool = new Pool(connectionConfig(process.env.DATABASE_URL, 'runtime'));
export type Db = typeof pool;
