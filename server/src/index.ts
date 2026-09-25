import { buildApp } from './app.js';
import { config, secret } from './config.js';
import { pool } from './db.js';
secret('API_KEY_ENCRYPTION_KEY', true);
secret('EMAIL_CODE_SECRET', true);
await pool.query("UPDATE messages SET status='interrupted' WHERE status='generating'");
const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
