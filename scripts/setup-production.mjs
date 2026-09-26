import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { directory: { type: 'string' } } });
const destination = path.resolve(values.directory || root);
await mkdir(path.join(destination, 'server'), { recursive: true });
await mkdir(path.join(destination, 'secrets', 'production'), { recursive: true, mode: 0o700 });

async function create(relative, content, mode = 0o600) {
  try {
    await writeFile(path.join(destination, relative), content, { flag: 'wx', mode });
    console.log(`Created ${relative}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Kept existing ${relative}`);
  }
}

for (const relative of ['.env.production', 'server/.env.production']) {
  await create(relative, await readFile(path.join(root, `${relative}.example`), 'utf8'));
}
// The host directory is private (0700). Mounted files must be readable by the
// unprivileged node user; Compose file-backed secrets preserve host permissions.
for (const name of ['postgres_password', 'email_code_secret', 'api_key_encryption_key']) {
  await create(`secrets/production/${name}.txt`, `${randomBytes(32).toString('hex')}\n`, 0o644);
}
for (const name of ['smtp_password', 'github_owner_token']) {
  await create(`secrets/production/${name}.txt`, '', 0o644);
}
console.log('Fill in APP_ORIGIN and SMTP settings before public launch. GitHub sync stays disabled.');
