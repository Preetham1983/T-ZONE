import { updateLlmSettingsSchema } from '@tzone/shared';
import type { FastifyInstance } from 'fastify';
import { testLlmConnection } from '../llm/provider.js';
import {
  getLlmRuntimeConfig,
  toPublicLlmSettings,
  updateLlmRuntimeConfig,
  type LlmRuntimeConfig,
} from '../llm/settingsStore.js';
import { getSkillInspectorInfo } from '../msgraph/skillRunner.js';
import { getSyncStatus, syncWorkspaceIndex } from '../sync/indexer.js';

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/llm', async () => toPublicLlmSettings(getLlmRuntimeConfig()));

  app.put('/api/settings/llm', async (req, reply) => {
    const parsed = updateLlmSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid settings payload' });
    }
    return updateLlmRuntimeConfig(parsed.data);
  });

  app.post('/api/settings/llm/test', async (req) => {
    const parsed = updateLlmSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return testLlmConnection();
    }
    const current = getLlmRuntimeConfig();
    const d = parsed.data;
    const override: LlmRuntimeConfig = {
      provider: d.provider,
      agentMode: d.agentMode ?? current.agentMode,
      approvalPolicy: d.approvalPolicy ?? current.approvalPolicy,
      maxSteps: d.maxSteps ?? current.maxSteps,
      temperature: d.temperature ?? current.temperature,
      dial: {
        azureEndpoint: d.dial?.azureEndpoint ?? current.dial.azureEndpoint,
        apiVersion: d.dial?.apiVersion ?? current.dial.apiVersion,
        chatModelName: d.dial?.chatModelName ?? current.dial.chatModelName,
        apiKey:
          d.dial?.apiKey && !d.dial.apiKey.includes('••••') ? d.dial.apiKey.trim() : current.dial.apiKey,
      },
      copilot: {
        model: d.copilot?.model ?? current.copilot.model,
        transport: d.copilot?.transport ?? current.copilot.transport,
        githubPat:
          d.copilot?.githubPat && !d.copilot.githubPat.includes('••••')
            ? d.copilot.githubPat.trim()
            : current.copilot.githubPat,
        copilotSdkPat:
          d.copilot?.copilotSdkPat && !d.copilot.copilotSdkPat.includes('••••')
            ? d.copilot.copilotSdkPat.trim()
            : current.copilot.copilotSdkPat,
      },
    };
    return testLlmConnection(override);
  });

  app.get('/api/settings/sync-status', async () => getSyncStatus());

  app.post<{ Body?: { daysBack?: number } }>('/api/settings/sync', async (req) => {
    const days = Number(req.body?.daysBack) || 7;
    return syncWorkspaceIndex(Math.min(60, Math.max(1, days)));
  });

  app.get('/api/skills/msgraph', async () => getSkillInspectorInfo());
}
