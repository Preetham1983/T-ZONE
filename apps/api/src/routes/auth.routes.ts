import { completeUrlLoginSchema } from '@tzone/shared';
import type { FastifyInstance } from 'fastify';
import {
  clearTokenCache,
  completeLoginFromUrl,
  getAuthStatus,
  startPkceLogin,
} from '../msgraph/authManager.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/status', async () => getAuthStatus());

  app.post<{ Body?: { force?: boolean } }>('/api/auth/login/start', async (req) => {
    const force = Boolean(req.body?.force);
    return startPkceLogin(force);
  });

  app.post('/api/auth/login/complete-url', async (req, reply) => {
    const parsed = completeUrlLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid URL' });
    }
    const result = await completeLoginFromUrl(parsed.data.redirectedUrl);
    return { ok: true, ...result, status: await getAuthStatus() };
  });

  app.post('/api/auth/logout', async () => {
    clearTokenCache();
    return { ok: true, status: await getAuthStatus() };
  });

  app.get('/api/auth/claims', async () => {
    const status = await getAuthStatus();
    return { state: status.state, claims: status.claims };
  });
}
