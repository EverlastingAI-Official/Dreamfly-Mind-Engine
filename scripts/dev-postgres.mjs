import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

async function checkConnection(Client, options) {
  const db = new Client(options);
  try {
    await db.connect();
    await db.query('SELECT 1');
  } finally {
    await db.end();
  }
}

export async function ensurePostgres({ server, logs, info, signal }) {
  const env = process.env;
  const require = createRequire(path.join(server, 'package.json'));
  const { Client } = require('pg');
  const options = {
    connectionString: env.DATABASE_URL,
    password: env.PGPASSWORD_FILE
      ? readFileSync(path.resolve(server, env.PGPASSWORD_FILE), 'utf8').trim()
      : env.PGPASSWORD,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  };
  // Resolve DATABASE_URL and PG* with the same precedence as the application.
  const { host, port } = new Client(options).connectionParameters;
  const check = () => checkConnection(Client, options);
  const failure = (error) =>
    new Error(
      `PostgreSQL ${host}:${port} 连接失败 (${error.code || 'connection'})。请核对 server/.env，见 docs/LOCAL_DEVELOPMENT.md 第 3 节。`,
      { cause: error },
    );

  signal.throwIfAborted();
  try {
    await check();
    return;
  } catch (error) {
    if (error.code !== 'ECONNREFUSED') throw failure(error);
    if (!env.DEV_POSTGRES_DATA_DIR || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(
        `${failure(error).message} 本地实例可设置 DEV_POSTGRES_DATA_DIR 自动启动；其他数据库请先启动对应服务。`,
      );
    }
  }

  const directory = path.resolve(server, env.DEV_POSTGRES_DATA_DIR);
  if (!existsSync(path.join(directory, 'PG_VERSION'))) {
    throw new Error(
      `PostgreSQL 数据目录尚未初始化：${directory}。请先建库，启动器不会创建或清空数据库。`,
    );
  }
  const executable = env.DEV_POSTGRES_CTL || 'pg_ctl';
  mkdirSync(logs, { recursive: true });
  const logfile = path.join(logs, 'postgres.log');
  info(`正在启动本地 PostgreSQL ${host}:${port}；日志：${logfile}`);
  signal.throwIfAborted();
  // pg_ctl handles detachment and Windows privilege reduction. It exits before
  // application services start, keeping PostgreSQL outside their process tree.
  // Use file descriptors: postgres may inherit pipes and keep them open after pg_ctl exits.
  const startupLog = path.join(logs, 'postgres-start.log');
  const log = openSync(startupLog, 'a');
  try {
    const child = spawn(
      executable,
      ['-D', directory, '-l', logfile, '-o', `-p ${port} -h ${host}`, '-w', '-t', '30', 'start'],
      { cwd: server, windowsHide: true, signal, stdio: ['ignore', log, log] },
    );
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`pg_ctl exited with code ${code}`);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      `无法启动 PostgreSQL。请检查 DEV_POSTGRES_CTL (${executable})，详见 ${startupLog} 和 ${logfile}。`,
      { cause: error },
    );
  } finally {
    closeSync(log);
  }

  signal.throwIfAborted();
  try {
    await check();
  } catch (error) {
    throw failure(error);
  }
}
