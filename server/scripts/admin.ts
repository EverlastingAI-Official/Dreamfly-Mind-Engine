import { pool } from '../src/db.js';
const email=process.argv[2]?.trim().toLowerCase();
if(!email)throw new Error('Usage: npm run admin -- registered-email@example.com');
const result=await pool.query("UPDATE users SET role='admin' WHERE email=$1 RETURNING id",[email]);
await pool.end();if(!result.rowCount)throw new Error('Register and verify this account first');console.log('Administrator role assigned to the registered account.');
