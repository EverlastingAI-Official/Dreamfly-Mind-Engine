import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);

// Compare process creation times as well as PIDs: an old record must not stop
// an unrelated program after the operating system reuses a PID.
export async function processSnapshot() {
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; startedAt=$_.CreationDate.ToUniversalTime().ToString('o') } })"], { windowsHide: true });
    return JSON.parse(stdout || '[]');
  }
  const { stdout } = await exec('ps', ['-eo', 'pid=,lstart=']);
  return stdout.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return { pid: Number(match[1]), startedAt: match[2] };
  });
}

export async function terminateProcess(pid) {
  if (process.platform === 'win32') {
    await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    process.kill(pid, 'SIGTERM');
  }
}

export function processRegistry(root) {
  const file = path.join(root, 'data', 'dev-processes.json');
  const state = { root, owner: process.pid, processes: [] };
  const save = () => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  };
  return {
    async stopPrevious() {
      if (!existsSync(file)) return;
      const previous = JSON.parse(readFileSync(file, 'utf8'));
      if (previous.root !== root) throw new Error('开发进程记录的项目目录不匹配。');
      // Stop the old launcher first so it cannot start more children.
      const records = [...previous.processes].sort((a, b) => Number(b.pid === previous.owner) - Number(a.pid === previous.owner));
      for (const record of records) {
        if (record.pid === process.pid) continue;
        const current = (await processSnapshot()).find(item => item.pid === record.pid);
        if (!current || current.startedAt !== record.startedAt) continue;
        console.log(`[dev] 停止旧 ${record.name} (${record.pid})`);
        try { await terminateProcess(record.pid); }
        catch (error) {
          if ((await processSnapshot()).some(item => item.pid === record.pid && item.startedAt === record.startedAt)) throw error;
        }
      }
    },
    async register(pid, name) {
      const record = (await processSnapshot()).find(item => item.pid === pid);
      if (!record) throw new Error(`${name} 在启动时已退出，请查看开发日志。`);
      state.processes.push({ ...record, name });
      save();
    },
    clear() {
      if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).owner === process.pid) unlinkSync(file);
    },
  };
}
