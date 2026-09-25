import { Ajv } from 'ajv';
import YAML from 'yaml';
import yauzl from 'yauzl';
import yazl from 'yazl';
// Shared portable schema and migration functions are also consumed by the H5 editor.
import {
  assetMaxBytes,
  emptyMind,
  mindSchema,
  parseMind,
  publicationSettings,
  skillMarkdown,
  skillSlug,
  skillSubmissionIssues,
} from '../../packages/mind-format/index.js';
import { config } from './config.js';
import { check, HttpError } from './errors.js';
import type { Mind } from './types.js';
export { assetMaxBytes, emptyMind, parseMind, publicationSettings, skillMarkdown, skillSlug };
export function validateSkillSubmission(mind: unknown) {
  const content = validateMind(mind);
  const issues = skillSubmissionIssues(content);
  check(!issues.length, 422, 'INCOMPLETE_SKILL', issues.join('；'));
  return content;
}
const validate = new Ajv({ allErrors: true }).compile<Mind>(mindSchema);
export function validateMind(mind: unknown): Mind {
  if (!validate(mind))
    throw new HttpError(422, 'INVALID_SKILL', 'Skill 格式不正确', validate.errors);
  check(
    new Set(mind.memory.fragments.map((x) => x.id)).size === mind.memory.fragments.length,
    422,
    'DUPLICATE_MEMORY',
    '记忆 ID 不可重复',
  );
  for (const value of Object.values(mind.assets))
    check(
      typeof value === 'string' && /^assets\/[a-zA-Z0-9._-]+$/.test(value),
      422,
      'INVALID_ASSET_PATH',
      '素材必须引用 assets/ 下的文件',
    );
  return mind;
}
export async function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new HttpError(422, 'INVALID_ZIP', '无法读取 ZIP'));
      const files = new Map<string, Buffer>();
      let total = 0,
        count = 0,
        failed = false;
      const fail = (e: unknown) => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(e);
      };
      zip.on('error', fail);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        try {
          const name = entry.fileName;
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          check(
            ++count <= config.uploadFiles &&
              !name.includes('\\') &&
              !name.startsWith('/') &&
              !name.split('/').some((x: string) => x === '..' || x === '.') &&
              !name.includes(':') &&
              mode !== 0xa000 &&
              !(entry.generalPurposeBitFlag & 1),
            422,
            'UNSAFE_ZIP',
            'ZIP 包含不支持的路径/文件或文件过多',
          );
          if (name.endsWith('/')) {
            zip.readEntry();
            return;
          }
          check(
            !files.has(name) && entry.uncompressedSize <= config.extracted,
            422,
            'UNSAFE_ZIP',
            'ZIP 文件重复或过大',
          );
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return fail(error);
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => {
              total += chunk.length;
              if (total > config.extracted) {
                stream.destroy();
                fail(new HttpError(413, 'ZIP_TOO_LARGE', 'ZIP 解压内容过大'));
              } else chunks.push(chunk);
            });
            stream.on('error', fail);
            stream.on('end', () => {
              if (!failed) {
                files.set(name, Buffer.concat(chunks));
                zip.readEntry();
              }
            });
          });
        } catch (e) {
          fail(e);
        }
      });
      zip.readEntry();
    }),
  );
}
function markdownMind(source: string, existing?: { mind: Mind; warnings: string[] }) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  check(match, 422, 'INVALID_SKILL_MD', 'Markdown 缺少 YAML frontmatter');
  const meta = YAML.parse(match[1], { maxAliasCount: 0 });
  check(
    meta && typeof meta.name === 'string' && typeof meta.description === 'string',
    422,
    'INVALID_SKILL_MD',
    'Markdown 缺少名称或说明',
  );
  const instructions = match[2].split('<!-- dreamfly:details -->')[0].trim();
  if (existing) {
    check(
      existing.mind.slug === meta.name &&
        existing.mind.persona.instructions.trim() === instructions,
      409,
      'PERSONA_CONFLICT',
      'mind.json 与 SKILL.md 人格不一致，请修改后重新上传',
    );
    return existing;
  }
  return {
    mind: { ...emptyMind(meta.name), description: meta.description, persona: { instructions } },
    warnings: [],
  };
}
export async function importPackage(name: string, buffer: Buffer) {
  const archive = /\.zip$/i.test(name);
  const files = archive ? await unzip(buffer) : new Map([[name, buffer]]);
  const entries = [...files.keys()];
  // Standalone documents are identified by extension; archives use package filenames.
  const json = archive
    ? entries.find((file) => /(^|\/)mind\.json$|\.mind(?:\.js)?$/i.test(file))
    : /\.(json|mind|js)$/i.test(name)
      ? name
      : undefined;
  const markdown = archive
    ? entries.find((file) => /(^|\/)SKILL\.md$/i.test(file))
    : /\.md$/i.test(name)
      ? name
      : undefined;
  let result: { mind: Mind; warnings: string[] } | undefined;
  try {
    if (json) result = parseMind(files.get(json)!.toString('utf8'));
    if (markdown) result = markdownMind(files.get(markdown)!.toString('utf8'), result);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, 'INVALID_SKILL', '无法解析 Skill 内容，请检查 JSON 或 Markdown 格式');
  }
  check(result, 422, 'NO_SKILL', '未找到 mind.json、.mind 或 SKILL.md');
  validateMind(result.mind);
  const entry = json || markdown!;
  const root = archive && entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
  return { ...result, files, root };
}
export async function zipFiles(files: Map<string, Buffer>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, data] of files) zip.addBuffer(data, name);
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (c) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
  zip.end();
  return result;
}

export function validateSkillInput(source: unknown) {
  try {
    const result = parseMind(source);
    return { mind: validateMind(result.mind), warnings: result.warnings };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, 'INVALID_SKILL', '无法解析 Skill 内容，请检查 JSON 格式');
  }
}
