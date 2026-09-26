import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { auth } from './auth.js';
import { config } from './config.js';
import { HttpError, normalizeError, publicFailure } from './errors.js';
import type { ErrorResponse, SuccessResponse } from '../../packages/api/index.js';
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
    // Compose accepts forwarding headers from its private network only.
    trustProxy: process.env.TRUST_PROXY || false,
    ajv: { customOptions: { removeAdditional: false } },
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
    const failure = normalizeError(error);
    if (failure.statusCode >= 500)
      request.log.error(
        { diagnostic: errorDiagnostic(error), request_id: request.id },
        'Request failed',
      );
    return reply.code(failure.statusCode).send({
      error: publicFailure(failure),
      request_id: request.id,
    } satisfies ErrorResponse);
  });
  app.setNotFoundHandler(() => {
    throw new HttpError('NOT_FOUND');
  });
  app.addHook('preSerialization', async (request, reply, value) => {
    if (
      value &&
      typeof value === 'object' &&
      !Buffer.isBuffer(value) &&
      !('error' in value) &&
      request.routeOptions.url !== '/api/v1/openapi.json'
    ) {
      return { data: value, request_id: request.id } satisfies SuccessResponse<unknown>;
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
