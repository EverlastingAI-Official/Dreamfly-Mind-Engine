import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { auth } from './auth.js';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { errorDiagnostic } from './logging.js';
import { describeRoute } from './openapi.js';
import { adminRoutes } from './routes/admin.js';
import { assetRoutes } from './routes/assets.js';
import { authRoutes } from './routes/auth.js';
import { conversationRoutes, type ChatTransport } from './routes/conversations.js';
import { discoveryRoutes } from './routes/discovery.js';
import { githubRoutes } from './routes/github.js';
import { providerRoutes } from './routes/providers.js';
import { skillRoutes } from './routes/skills.js';
import type { ModelListTransport } from './services/model-provider.js';

export async function buildApp(
  options: {
    transport?: ChatTransport;
    modelListTransport?: ModelListTransport;
    logger?: boolean;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      serializers: {
        req: (request) => ({ method: request.method, url: request.url?.split('?')[0] }),
      },
    },
    bodyLimit: config.uploadJSON + 1024 * 1024,
    genReqId: () => randomUUID(),
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.uploadZIP, files: 1, fields: 5 } });
  app.addHook('onRoute', describeRoute);
  await app.register(swagger, {
    openapi: {
      info: { title: 'DreamFly API', version: '1.0.0' },
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: config.cookie } },
      },
    },
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as Error & { code?: string; statusCode?: number };
    const duplicate = failure.code === '23505';
    const status =
      error instanceof HttpError
        ? error.statusCode
        : duplicate
          ? 409
          : failure.statusCode && failure.statusCode >= 400 && failure.statusCode < 500
            ? failure.statusCode
            : 500;
    if (status >= 500)
      request.log.error(
        { diagnostic: errorDiagnostic(error), request_id: request.id },
        'Request failed',
      );
    return reply.code(status).send({
      error: {
        code: duplicate
          ? 'ALREADY_EXISTS'
          : error instanceof HttpError
            ? error.code
            : status === 500
              ? 'INTERNAL_ERROR'
              : 'INVALID_REQUEST',
        message: duplicate
          ? '相同版本、名称或请求已存在'
          : error instanceof HttpError
            ? error.message
            : status === 500
              ? '服务暂时不可用，请检查运行状态'
              : '请求格式无效',
        details: error instanceof HttpError ? error.details : undefined,
      },
      request_id: request.id,
    });
  });
  app.addHook('preSerialization', async (request, reply, value) => {
    if (
      value &&
      typeof value === 'object' &&
      !Buffer.isBuffer(value) &&
      !('error' in value) &&
      request.routeOptions.url !== '/api/v1/openapi.json'
    ) {
      return { data: value, request_id: request.id };
    }
    return value;
  });
  await app.register(
    async (api) => {
      await auth(api);
      api.get('/health', { config: { public: true } }, async () => ({ status: 'ok' }));
      api.get('/openapi.json', { config: { public: true } }, async () => app.swagger());
      await authRoutes(api);
      await providerRoutes(api, options.modelListTransport);
      await discoveryRoutes(api);
      await skillRoutes(api);
      await assetRoutes(api);
      await adminRoutes(api);
      await conversationRoutes(api, options.transport);
      await githubRoutes(api);
    },
    { prefix: '/api/v1' },
  );
  return app;
}
