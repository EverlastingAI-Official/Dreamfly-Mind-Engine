import type { ApiRoute } from '../../../packages/api/index.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { uid } from '../auth.js';
import { config } from '../config.js';
import { body, check, id, params, query } from '../errors.js';
import { validateSkillInput } from '../format.js';
import { bodies } from '../../../packages/api/schemas.js';
import { exportSkillPackage, importSkillPackage } from '../services/skill-packages.js';
import { skillDetail, createVersion, unpublishSkill, writeSkill } from '../services/skills.js';

async function upload(request: FastifyRequest, save: boolean) {
  const file = await request.file();
  check(file, 'NO_FILE', '请选择 Skill 文件');
  const buffer = await file.toBuffer();
  if (!/\.zip$/i.test(file.filename)) check(buffer.length <= config.uploadJSON, 'FILE_TOO_LARGE');
  return importSkillPackage(uid(request), file.filename, buffer, save);
}
export async function skillRoutes(app: FastifyInstance) {
  app.post<ApiRoute<'POST /skills/validate'>>('/skills/validate', (r) =>
    r.isMultipart() ? upload(r, false) : Promise.resolve(validateSkillInput(body(r).content)),
  );
  app.post<ApiRoute<'POST /skills/import'>>('/skills/import', (r) => upload(r, true));
  app.post<ApiRoute<'POST /skills'>>(
    '/skills',
    { schema: { body: bodies.createSkill } },
    async (r) => {
      const input = r.body;
      check(input.content, 'INVALID_SKILL', '请提供 Skill 内容');
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
    },
  );
  app.patch<ApiRoute<'PATCH /skills/:id'>>(
    '/skills/:id',
    { schema: { body: bodies.updateSkill } },
    (r) => writeSkill(uid(r), id(params(r).id), r.body, { publish: false, create: false }),
  );
  app.post<ApiRoute<'POST /skills/:id/submit'>>(
    '/skills/:id/submit',
    { schema: { body: bodies.submitSkill } },
    (r) => writeSkill(uid(r), id(params(r).id), r.body, { publish: true, create: true }),
  );
  app.get<ApiRoute<'GET /skills/:id'>>('/skills/:id', { config: { public: true } }, (r) =>
    skillDetail(params(r).id, r.user?.id),
  );
  app.post<ApiRoute<'POST /skills/:id/versions'>>('/skills/:id/versions', (r) =>
    createVersion(params(r).id, uid(r)),
  );
  app.post<ApiRoute<'POST /skills/:id/publish'>>(
    '/skills/:id/publish',
    { schema: { body: bodies.publishSkill } },
    (r) => writeSkill(uid(r), id(params(r).id), r.body, { publish: true, create: false }),
  );
  app.post<ApiRoute<'POST /skills/:id/unpublish'>>('/skills/:id/unpublish', (r) =>
    unpublishSkill(params(r).id, uid(r)),
  );
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
