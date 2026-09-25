import { config, secret } from './config.js';
import { check } from './errors.js';

export function githubTarget() {
  const owner=(process.env.GITHUB_OWNER||'').trim().toLowerCase(),repo=(process.env.GITHUB_REPOSITORY||'').trim().toLowerCase();
  const branch=(process.env.GITHUB_BRANCH||'main').trim();
  check(config.githubEnabled,422,'GITHUB_DISABLED','平台 GitHub 同步尚未启用，请联系管理员');
  let token='';
  try { token=secret('GITHUB_OWNER_TOKEN'); } catch { /* Expose a configuration error, never the secret path. */ }
  check(owner&&repo&&branch&&token,422,'GITHUB_CONFIG_REQUIRED','平台 GitHub 仓库或凭据未配置，每周同步等待管理员配置；平台内容可正常使用');
  check(/^[A-Za-z0-9-]+$/.test(owner)&&/^[A-Za-z0-9_.-]+$/.test(repo),422,'GITHUB_CONFIG_INVALID','平台 GitHub 仓库配置无效，请联系管理员');
  check(!/[~^:?*\[\\\s]/.test(branch)&&!branch.includes('..')&&!branch.includes('@{')&&!branch.startsWith('/')&&!branch.endsWith('/')&&!branch.endsWith('.'),422,'GITHUB_CONFIG_INVALID','平台 GitHub 分支配置无效，请联系管理员');
  return {auth_mode:'owner' as const,owner,repo,branch,mode:'commit' as const};
}

export function githubStatus() {
  try { const target=githubTarget();return {enabled:true,configured:true,target}; }
  catch(e:any) { return {enabled:config.githubEnabled,configured:false,message:e.message}; }
}
