import cors from '@fastify/cors';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { getDb } from './db/client.js';
import { AuthRequiredError } from './msgraph/authManager.js';
import { GraphApiError } from './msgraph/graphClient.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerChatRoutes } from './routes/chat.routes.js';
import { registerSettingsRoutes } from './routes/settings.routes.js';
import { registerTeamsRoutes } from './routes/teams.routes.js';
import { registerTranscriptsRoutes } from './routes/transcripts.routes.js';
import { registerWorkspaceRoutes } from './routes/workspace.routes.js';

export async function buildApp() {
  getDb();

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthRequiredError) {
      return reply.status(401).send({ error: err.message, code: 'AUTH_REQUIRED' });
    }
    if (err instanceof GraphApiError) {
      return reply.status(err.statusCode).send({ error: err.message, code: 'GRAPH_ERROR' });
    }
    const status = (err as { statusCode?: number }).statusCode || 500;
    const message = (err as Error).message || 'Internal Server Error';
    return reply.status(status).send({ error: message });
  });

  app.get('/api/health', async () => ({ ok: true, service: 'tzone-api', timestamp: new Date().toISOString() }));

  await registerAuthRoutes(app);
  await registerSettingsRoutes(app);
  await registerChatRoutes(app);
  await registerTeamsRoutes(app);
  await registerTranscriptsRoutes(app);
  await registerWorkspaceRoutes(app);

  return app;
}

const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  const app = await buildApp();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(`T-ZONE API listening on http://0.0.0.0:${env.API_PORT}`);
}
