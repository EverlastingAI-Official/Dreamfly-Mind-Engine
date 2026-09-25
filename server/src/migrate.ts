import { readdir, readFile } from 'node:fs/promises';
import { pool, transaction } from './db.js';
export async function migrate() {
  await transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(7362941)");
    await db.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    for (const name of (await readdir('migrations')).filter(x => x.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT 1 FROM migrations WHERE name=$1', [name])).rowCount) continue;
      await db.query(await readFile(`migrations/${name}`, 'utf8'));
      await db.query('INSERT INTO migrations(name) VALUES($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
}
if(process.argv[1]?.endsWith('migrate.ts')||process.argv[1]?.endsWith('migrate.js')){await migrate();await pool.end();}
