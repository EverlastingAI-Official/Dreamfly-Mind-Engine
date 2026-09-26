import type { ApiRoute } from '../../../packages/api/index.js';
import type { FastifyInstance } from 'fastify';
import { uid } from '../auth.js';
import { pool } from '../db.js';
import { id, params, query, publicFailure } from '../errors.js';
import type { MessageEvents } from '../../../packages/api/index.js';
import { errorDiagnostic } from '../logging.js';
import { bodies } from '../../../packages/api/schemas.js';
import {
  conversation,
  conversationView,
  conversationMessages,
  createConversation,
  deleteConversation,
  listConversations,
  prepareMessage,
  renameConversation,
  switchConversationModel,
} from '../services/conversations.js';
import { generateReply } from '../services/generation.js';
import { streamChat } from '../services/model-provider.js';
export type ChatTransport = typeof streamChat;
export async function conversationRoutes(
  app: FastifyInstance,
  transport: ChatTransport = streamChat,
) {
  const running = new Map<string, AbortController>();
  app.addHook('onClose', async () => {
    for (const controller of running.values()) controller.abort();
  });
  app.post<ApiRoute<'POST /mindcopies/:skill_id/sessions'>>(
    '/mindcopies/:skill_id/sessions',
    { schema: { body: bodies.createConversation } },
    (r) => createConversation(params(r).skill_id, uid(r), r.body),
  );
  app.get<ApiRoute<'GET /conversations'>>('/conversations', (r) =>
    listConversations(uid(r), Number(query(r).page || 1), Number(query(r).page_size || 50)),
  );
  app.get<ApiRoute<'GET /conversations/:id'>>('/conversations/:id', async (r) =>
    conversationView(await conversation(params(r).id, uid(r))),
  );
  app.get<ApiRoute<'GET /conversations/:id/messages'>>('/conversations/:id/messages', (r) =>
    conversationMessages(params(r).id, uid(r)),
  );
  app.patch<ApiRoute<'PATCH /conversations/:id'>>(
    '/conversations/:id',
    { schema: { body: bodies.renameConversation } },
    (r) => renameConversation(params(r).id, uid(r), r.body.title),
  );
  app.delete<ApiRoute<'DELETE /conversations/:id'>>('/conversations/:id', (r) =>
    deleteConversation(params(r).id, uid(r)),
  );
  app.put<ApiRoute<'PUT /conversations/:id/model-profile'>>(
    '/conversations/:id/model-profile',
    { schema: { body: bodies.conversationModel } },
    (r) => switchConversationModel(params(r).id, uid(r), r.body.profile_id),
  );
  app.post<ApiRoute<'POST /conversations/:id/messages/:message_id/cancel'>>(
    '/conversations/:id/messages/:message_id/cancel',
    async (r) => {
      await conversation(params(r).id, uid(r));
      const message = (
        await pool.query(
          "SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND status='generating'",
          [id(params(r).message_id), params(r).id],
        )
      ).rows[0];
      const controller = message && running.get(message.id);
      controller?.abort();
      return { cancelled: Boolean(controller) };
    },
  );
  app.post<ApiRoute<'POST /conversations/:id/messages'>>(
    '/conversations/:id/messages',
    { schema: { body: bodies.sendMessage } },
    async (r, reply) => {
      const prepared = await prepareMessage(params(r).id, uid(r), r.body);
      if ('existing' in prepared) return prepared;
      const { assistant, model, context } = prepared;
      const controller = new AbortController();
      running.set(assistant, controller);
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      const send = <K extends keyof MessageEvents>(event: K, data: MessageEvents[K]) => {
        if (!reply.raw.destroyed)
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const disconnect = () => controller.abort();
      reply.raw.on('close', disconnect);
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(': keepalive\n\n');
      }, 15000);
      send('message.start', { id: assistant });
      try {
        const outcome = await generateReply(
          transport(model, context, controller.signal),
          controller.signal,
          (delta) => send('message.delta', { text: delta }),
          (content) =>
            pool
              .query('UPDATE messages SET content=$1 WHERE id=$2', [content, assistant])
              .then(() => {}),
          (error) => r.log.error({ err: errorDiagnostic(error) }, 'Model generation failed'),
        );
        await pool.query('UPDATE messages SET content=$1,status=$2,usage=$3 WHERE id=$4', [
          outcome.content,
          outcome.status,
          outcome.usage,
          assistant,
        ]);
        const terminal = { id: assistant, usage: outcome.usage };
        if (outcome.status === 'failed') {
          send('message.failed', {
            ...terminal,
            status: 'failed',
            error: outcome.error!,
            request_id: r.id,
          });
        } else if (outcome.status === 'cancelled') {
          send('message.cancelled', { ...terminal, status: 'cancelled' });
        } else {
          send('message.completed', { ...terminal, status: 'completed' });
        }
      } catch (error) {
        r.log.error({ err: errorDiagnostic(error) }, 'Message persistence failed');
        send('message.failed', {
          id: assistant,
          status: 'failed',
          usage: null,
          error: publicFailure(null, 'MESSAGE_SAVE_FAILED'),
          request_id: r.id,
        });
      } finally {
        clearInterval(heartbeat);
        running.delete(assistant);
        reply.raw.removeListener('close', disconnect);
        reply.raw.end();
      }
    },
  );
}
