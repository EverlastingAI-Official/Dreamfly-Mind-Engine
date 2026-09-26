import { check, id } from '../errors.js';
import { importPackage, zipFiles } from '../format.js';
import { publicMind } from '../public-mind.js';
import { exportFiles, storeAsset } from './assets.js';
import { publicSkill } from './discovery.js';
import { accessibleVersion } from './skills.js';
export async function importSkillPackage(
  user: string,
  name: string,
  buffer: Buffer,
  save: boolean,
) {
  const pkg = await importPackage(name, buffer);
  if (save) {
    // Validate every reference before persisting any asset.
    for (const ref of Object.values(pkg.mind.assets))
      check(pkg.files.has(pkg.root + ref), 'MISSING_ASSET', '包中缺少 ' + ref);
    for (const [key, ref] of Object.entries(pkg.mind.assets)) {
      pkg.mind.assets[key] = (
        await storeAsset(user, ref, pkg.files.get(pkg.root + ref)!)
      ).reference;
    }
  }
  return { mind: pkg.mind, warnings: pkg.warnings };
}

export async function exportSkillPackage(
  skillId: string,
  versionId: string,
  user: string,
  publicScope: boolean,
) {
  const version = await accessibleVersion(id(versionId), user, 'download');
  check(version.skill_id === id(skillId), 'NOT_FOUND', '版本不属于此 Skill');
  if (publicScope) {
    const published = await publicSkill(version.skill_id, user);
    check(
      published.publication.download && published.published_version_id === versionId,
      'NOT_FOUND',
      '此发布版本已更新或不可下载',
    );
    version.content = publicMind(version.content, version.publication);
  }
  const files = await exportFiles(version.content);
  const archive = await zipFiles(
    new Map([...files].map(([name, bytes]) => [version.content.slug + '/' + name, bytes])),
  );
  return { archive, filename: version.content.slug + '-' + version.version + '.zip' };
}
