import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { uid } from '../auth.js';
import { config } from '../config.js';
import { body, check, id, params, query } from '../errors.js';
import { validateSkillInput } from '../format.js';
import { bodies } from './schemas.js';
import { exportSkillPackage, importSkillPackage } from '../services/skill-packages.js';
import { skillDetail, createVersion, unpublishSkill, writeSkill } from '../services/skills.js';
import type { SkillWrite } from '../types.js';

async function upload(request: FastifyRequest, save: boolean) {
  const file = await request.file();
  check(file, 422, 'NO_FILE', '请选择 Skill 文件');
  const buffer = await file.toBuffer();
  if (!/\.zip$/i.test(file.filename))
    check(buffer.length <= config.uploadJSON, 413, 'FILE_TOO_LARGE', '单文件超过上传限制');
  return importSkillPackage(uid(request), file.filename, buffer, save);
}
export async function skillRoutes(app: FastifyInstance) {
  app.post('/skills/validate', (r) =>
    r.isMultipart() ? upload(r, false) : Promise.resolve(validateSkillInput(body(r).content)),
  );
  app.post('/skills/import', (r) => upload(r, true));
  app.post('/skills', { schema: { body: bodies.createSkill } }, async (r) => {
    const input = body<SkillWrite>(r);
    check(input.content, 422, 'INVALID_SKILL', '请提供 Skill 内容');
    const skill = input.id ? id(input.id).toLowerCase() : randomUUID();
    return writeSkill(
      uid(r),
      skill,
      {
        ...input,
        revision: input.revision ?? 0,
        content: {
          ...input.content,
          name: input.content.name || `${r.user!.display_name}的mindcopy`,
        },
      },
      { publish: false, create: true },
    );
  });
  app.patch('/skills/:id', { schema: { body: bodies.updateSkill } }, (r) =>
    writeSkill(uid(r), id(params(r).id), body<SkillWrite>(r), { publish: false, create: false }),
  );
  app.post('/skills/:id/submit', { schema: { body: bodies.submitSkill } }, (r) =>
    writeSkill(uid(r), id(params(r).id), body<SkillWrite>(r), { publish: true, create: true }),
  );
  app.get('/skills/:id', { config: { public: true } }, (r) =>
    skillDetail(params(r).id, r.user?.id),
  );
  app.post('/skills/:id/versions', (r) => createVersion(params(r).id, uid(r)));
  app.post('/skills/:id/publish', { schema: { body: bodies.publishSkill } }, (r) =>
    writeSkill(uid(r), id(params(r).id), body<SkillWrite>(r), { publish: true, create: false }),
  );
  app.post('/skills/:id/unpublish', (r) => unpublishSkill(params(r).id, uid(r)));
  app.get('/skills/:id/export', async (r, reply) => {
    const { archive, filename } = await exportSkillPackage(
      params(r).id,
      query(r).version,
      uid(r),
      query(r).scope === 'public',
    );
    return reply
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .type('application/zip')
      .send(archive);
  });
}
