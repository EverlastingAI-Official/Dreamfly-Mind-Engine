import { writeFile } from 'node:fs/promises';
import { paths } from '../src/services/navigation.mjs';

// Share the application's page list so deep links and HTTP 404s stay consistent.
const routes = new Set(['/', '/index', '/pages/platform/index', '/sync/github', ...Object.values(paths)]);
routes.delete(paths.missing);
const config = [...routes].map(route => `location = ${route} {
    try_files /index.html =404;
    add_header Cache-Control "no-cache";
}`).join('\n\n');
await writeFile(process.argv[2], `${config}\n`);
