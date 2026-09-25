import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { pool, type DB } from '../db.js';
import { check, HttpError, id } from '../errors.js';
import { assetMaxBytes, skillMarkdown } from '../format.js';
import type { Mind } from '../types.js';
export function assetId(reference: string) {
  return id(reference.replace(/^assets\//, '').split('.')[0]);
}
export async function validateAssets(content: Mind, user: string, db: DB = pool) {
  for (const ref of Object.values(content.assets) as string[]) {
    const a = (
      await db.query('SELECT * FROM assets WHERE id=$1 AND user_id=$2', [assetId(ref), user])
    ).rows[0];
    check(a, 422, 'MISSING_ASSET', '素材不存在或不属于当前用户');
    check(a.size <= assetMaxBytes, 422, 'ASSET_TOO_LARGE', '素材超过 10 MB，请移除后重新上传');
  }
}
export function media(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return ['image/png', 'png'];
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return ['image/jpeg', 'jpg'];
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return ['image/webp', 'webp'];
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE')
    return ['audio/wav', 'wav'];
  if (buffer.toString('ascii', 0, 4) === 'OggS') return ['audio/ogg', 'ogg'];
  if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 255 && (buffer[1] & 224) === 224))
    return ['audio/mpeg', 'mp3'];
  throw new HttpError(422, 'INVALID_MEDIA', '仅支持 PNG、JPEG、WebP、WAV、OGG、MP3 素材');
}
export async function storeAsset(user: string, name: string, data: Buffer) {
  check(data.length <= assetMaxBytes, 413, 'ASSET_TOO_LARGE', '素材最大 10 MB');
  const [mime, ext] = media(data),
    asset = randomUUID();
  await mkdir(config.assets, { recursive: true });
  await writeFile(path.join(config.assets, asset), data, { flag: 'wx' });
  try {
    await pool.query('INSERT INTO assets(id,user_id,name,mime,size) VALUES($1,$2,$3,$4,$5)', [
      asset,
      user,
      name.slice(0, 200),
      mime,
      data.length,
    ]);
  } catch (e) {
    await unlink(path.join(config.assets, asset));
    throw e;
  }
  return { id: asset, reference: `assets/${asset}.${ext}`, mime, name };
}
export async function exportFiles(content: Mind) {
  const files = new Map<string, Buffer>([
    ['mind.json', Buffer.from(JSON.stringify(content, null, 2))],
    ['SKILL.md', Buffer.from(skillMarkdown(content))],
  ]);
  for (const ref of Object.values(content.assets) as string[])
    files.set(ref, await readFile(path.join(config.assets, assetId(ref))));
  return files;
}
