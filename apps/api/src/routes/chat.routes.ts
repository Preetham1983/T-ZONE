import { chatRequestSchema, confirmActionSchema } from '@tzone/shared';
import type { FastifyInstance } from 'fastify';
import { runAgentTurn } from '../agent/orchestrator.js';
import { PLAYBOOKS } from '../agent/playbooks.js';
import { resolvePendingAction } from '../agent/toolRegistry.js';
import {
  deleteConversation,
  getConversationMessages,
  listConversations,
} from '../db/repositories.js';

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playbooks', async () => PLAYBOOKS);

  app.get('/api/conversations', async () => listConversations());

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req) => ({
    id: req.params.id,
    messages: getConversationMessages(req.params.id),
  }));

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req) => {
    deleteConversation(req.params.id);
    return { ok: true };
  });

  app.post('/api/chat/stream', async (req, reply) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid chat prompt' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    const sendEvent = (event: unknown) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    await runAgentTurn(parsed.data, sendEvent);
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  });

  app.post<{ Params: { id: string } }>('/api/actions/:id/confirm', async (req, reply) => {
    const parsed = confirmActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid decision' });
    }
    return resolvePendingAction(
      req.params.id,
      parsed.data.decision,
      parsed.data.editedArgs as Record<string, unknown> | undefined
    );
  });
}
