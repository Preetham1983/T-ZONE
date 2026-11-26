import {
  MEETING_ROLE_PRESETS,
  addMeetingUtteranceSchema,
  createMeetingMissionSchema,
  updateMeetingMissionSchema,
} from '@tzone/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  appendMeetingUtterance,
  buildMissionContextPrompt,
  createConfiguredMission,
  endMeetingMission,
  fetchMeetingTeamsChat,
  generateMissionPrepBrief,
  joinMeetingMission,
  listCalendarMeetingOptions,
  pollMeetingChatAutoRespond,
  postToMeetingTeamsChat,
  synthesizeMissionLiveNotes,
  updateConfiguredMission,
} from '../agent/meetingAgentService.js';
import {
  getGuestBotScreenshot,
  getGuestBotState,
  joinMeetingAsGuest,
  leaveMeetingAsBot,
  setGuestBotAutoVoiceReply,
  speakInMeetingAsBot,
  toggleGuestBotMute,
} from '../agent/teamsBrowserBot.js';
import { runAgentTurn } from '../agent/orchestrator.js';
import {
  deleteMeetingMission,
  getMeetingMission,
  listMeetingMissions,
} from '../db/repositories.js';

const askMissionSchema = z.object({
  prompt: z.string().min(1),
});

const postChatSchema = z.object({
  text: z.string().min(1).max(6000),
});

const botJoinSchema = z.object({
  botName: z.string().min(1).max(80).optional(),
});

const botSpeakSchema = z.object({
  text: z.string().min(1).max(1200),
});

const botMuteSchema = z.object({
  muted: z.boolean(),
});

export async function registerMeetingAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/meeting-agent/presets', async () => MEETING_ROLE_PRESETS);

  app.get<{ Querystring: { tz?: string; days?: string; pastDays?: string } }>(
    '/api/meeting-agent/calendar-options',
    async (req) =>
      listCalendarMeetingOptions(
        req.query.tz || 'UTC',
        Number(req.query.days) || 14,
        req.query.pastDays !== undefined ? Number(req.query.pastDays) : 2
      )
  );

  app.get('/api/meeting-agent/missions', async () => listMeetingMissions());

  app.get<{ Params: { id: string } }>('/api/meeting-agent/missions/:id', async (req, reply) => {
    const mission = getMeetingMission(req.params.id);
    if (!mission) return reply.status(404).send({ error: 'Meeting agent mission not found' });
    return mission;
  });

  app.post('/api/meeting-agent/missions', async (req, reply) => {
    const parsed = createMeetingMissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid mission config' });
    }
    return createConfiguredMission(parsed.data);
  });

  app.patch<{ Params: { id: string } }>('/api/meeting-agent/missions/:id', async (req, reply) => {
    const parsed = updateMeetingMissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid mission patch' });
    }
    const updated = await updateConfiguredMission(req.params.id, parsed.data);
    if (!updated) return reply.status(404).send({ error: 'Meeting agent mission not found' });
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/meeting-agent/missions/:id', async (req) => {
    deleteMeetingMission(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/meeting-agent/missions/:id/prep', async (req) =>
    generateMissionPrepBrief(req.params.id)
  );

  app.post<{ Params: { id: string } }>('/api/meeting-agent/missions/:id/join', async (req) =>
    joinMeetingMission(req.params.id)
  );

  app.post<{ Params: { id: string } }>('/api/meeting-agent/missions/:id/end', async (req) =>
    endMeetingMission(req.params.id)
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/utterances',
    async (req, reply) => {
      const parsed = addMeetingUtteranceSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid utterance' });
      }
      return appendMeetingUtterance(req.params.id, parsed.data);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/synthesize-notes',
    async (req) => synthesizeMissionLiveNotes(req.params.id)
  );

  app.get<{ Params: { id: string } }>('/api/meeting-agent/missions/:id/chat', async (req) =>
    fetchMeetingTeamsChat(req.params.id)
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/chat/poll',
    async (req) => pollMeetingChatAutoRespond(req.params.id)
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/chat/send',
    async (req, reply) => {
      const parsed = postChatSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Message text required' });
      }
      return postToMeetingTeamsChat(req.params.id, parsed.data.text);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/ask/stream',
    async (req, reply) => {
      const parsed = askMissionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Prompt required' });
      }
      let mission = getMeetingMission(req.params.id);
      if (!mission) {
        return reply.status(404).send({ error: 'Meeting agent mission not found' });
      }
      if (!mission.conversationId) {
        mission = await joinMeetingMission(mission.id);
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

      await runAgentTurn(
        {
          conversationId: mission.conversationId || undefined,
          prompt: parsed.data.prompt,
          systemContextExtra: buildMissionContextPrompt(mission),
        },
        sendEvent
      );

      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  );

  // Headless Teams Guest Browser Bot routes (joins Teams call visibly as unverified guest)
  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/bot/join',
    async (req, reply) => {
      const parsed = botJoinSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid bot join request' });
      }
      return joinMeetingAsGuest(req.params.id, parsed.data.botName);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/bot/state',
    async (req) => getGuestBotState(req.params.id)
  );

  app.get<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/bot/screenshot',
    async (req, reply) => {
      const png = getGuestBotScreenshot(req.params.id);
      if (!png) {
        return reply.status(404).send({ error: 'No guest bot screenshot available yet' });
      }
      reply.header('Cache-Control', 'no-store');
      reply.type('image/png');
      return reply.send(png);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/bot/speak',
    async (req, reply) => {
      const parsed = botSpeakSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Speech text required' });
      }
      return speakInMeetingAsBot(req.params.id, parsed.data.text);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/bot/mute',
    async (req, reply) => {
      const parsed = botMuteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'muted boolean required' });
      }
      return toggleGuestBotMute(req.params.id, parsed.data.muted);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/bot/auto-reply',
    async (req, reply) => {
      const parsed = z
        .object({
          enabled: z.boolean().optional(),
          voiceMode: z.enum(['conversational', 'wake_word']).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid auto-reply config' });
      }
      return setGuestBotAutoVoiceReply(
        req.params.id,
        parsed.data.enabled,
        parsed.data.voiceMode
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/meeting-agent/missions/:id/bot/leave',
    async (req) => leaveMeetingAsBot(req.params.id)
  );
}
