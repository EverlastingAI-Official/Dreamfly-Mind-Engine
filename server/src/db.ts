import pg from 'pg';
import { secret } from './config.js';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  password: secret('PGPASSWORD') || undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
});
export type DB = Pick<pg.PoolClient, 'query'>;
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
