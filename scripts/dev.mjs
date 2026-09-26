import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { processRegistry, terminateProcess } from './dev-processes.mjs';
import { ensurePostgres } from './dev-postgres.mjs';
import { pipeOutput } from './dev-output.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(root, 'server');
const children = new Set();
const logs = path.join(root, 'data', 'dev-logs');
const registry = processRegistry(root);
let stopping = false;
const shutdown = new AbortController();
const info = (message) => console.log(`[dev] ${message}`);
const verbose = process.argv.includes('--verbose');

function listening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function matches(url, verify) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok && verify(await response.text());
  } catch {
    return false;
  }
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  shutdown.abort();
  info('停止本项目的开发服务；不会停止独立的 PostgreSQL 实例。');
  await Promise.all(
    [...children].map(async (child) => {
      try {
        await terminateProcess(child.pid);
      } catch {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      }
    }),
  );
  registry.clear();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function launch(name, args, cwd) {
  mkdirSync(logs, { recursive: true });
  const log = createWriteStream(path.join(logs, `${name}.log`), { flags: 'a' });
  log.write(`\n--- ${new Date().toISOString()} ---\n`);
  const child = spawn(process.execPath, args, {
    cwd,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) pipeOutput(stream, { name, log, verbose });
  const ended = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      children.delete(child);
      log.end();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      children.delete(child);
      log.end();
      resolve({ code, signal });
    });
  });
  return ended;
}

async function service(name, args, cwd) {
  const ended = launch(name, args, cwd);
  const child = [...children].at(-1);
  ended
    .then(({ code, signal }) => {
      if (!stopping) {
        console.error(`[${name}] 意外退出 (${signal || code})，请查看 data/dev-logs/${name}.log`);
        stop(code || 1);
      }
    })
    .catch((error) => {
      console.error(`[${name}] ${error.message}`);
      stop(1);
    });
  await registry.register(child.pid, name);
}

async function waitReady(url, verify) {
  const until = Date.now() + 30000;
  while (!stopping && Date.now() < until) {
    if (await matches(url, verify)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!stopping) throw new Error(`启动超时：${url}，请查看 data/dev-logs/ 中对应日志。`);
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (![22, 24].includes(major)) throw new Error('请使用 Node.js 22 或 24。');
  for (const [file, command] of [
    ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', 'npm.cmd ci --include=dev'],
    ['server/node_modules/tsx/package.json', 'npm.cmd ci --include=dev --prefix server'],
    ['server/.env', 'npm.cmd run setup:local --prefix server'],
  ])
    if (!existsSync(path.join(root, file))) throw new Error(`缺少 ${file}，请先执行：${command}`);

  // Server secret-file paths are relative to server/, just like its npm scripts.
  loadEnvFile(path.join(server, '.env'));
  process.chdir(server);
  if (process.env.NODE_ENV === 'production') throw new Error('此入口仅用于本地开发。');
  const apiPort = Number(process.env.PORT || 3001);
  const apiHost = process.env.HOST === '0.0.0.0' ? '127.0.0.1' : process.env.HOST || '127.0.0.1';
  const apiURL = `http://${apiHost}:${apiPort}`;
  const webURL = 'http://127.0.0.1:5173';
  if ((process.env.APP_ORIGIN || webURL) !== webURL)
    throw new Error(`本地前端使用 ${webURL}，请将 server/.env 的 APP_ORIGIN 与其保持一致。`);
  const health = (text) => {
    try {
      return JSON.parse(text).data?.status === 'ok';
    } catch {
      return false;
    }
  };
  const frontend = (text) => text.includes('/src/main.js') && text.includes('DreamFly');

  info('正在启动开发服务…');
  await registry.stopPrevious();
  await registry.register(process.pid, '启动器');
  for (const [port, host] of [
    [apiPort, apiHost],
    [5173, '127.0.0.1'],
  ]) {
    const deadline = Date.now() + 10000;
    while (await listening(port, host)) {
      if (Date.now() >= deadline)
        throw new Error(
          `端口 ${port} 被未登记的进程占用，不能确认属于本项目；请关闭该进程后重试。`,
        );
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  await ensurePostgres({ server, logs, info, signal: shutdown.signal });
  if (stopping) return;
  const nodeArgs = ['--import', 'tsx'];
  {
    const migration = await launch(
      'migrate',
      [...nodeArgs, path.join(server, 'src/migrate.ts')],
      server,
    );
    if (stopping) return;
    if (migration.code !== 0) throw new Error('数据库迁移失败，详见 data/dev-logs/migrate.log。');
  }
  if (stopping) return;
  await service('api', [...nodeArgs, path.join(server, 'src/index.ts')], server);
  await waitReady(`${apiURL}/api/v1/health`, health);
  if (stopping) return;
  await service('worker', [...nodeArgs, path.join(server, 'src/worker.ts')], server);
  process.env.API_PROXY_TARGET = apiURL;
  await service(
    'web',
    [path.join(root, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js')],
    root,
  );
  await waitReady(webURL, frontend);
  if (stopping) return;
  info(`已就绪：${webURL}`);
  info('详细日志：data/dev-logs/；实时详情：npm run dev -- --verbose');
}

main().catch((error) => {
  if (!stopping) {
    console.error(`[dev] ${error.message}`);
    stop(1);
  }
});
