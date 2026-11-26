import type { FastifyInstance } from 'fastify';
import {
  getCachedChats,
  getCachedTeams,
  saveCachedChats,
  saveCachedTeams,
  searchFtsIndex,
} from '../db/repositories.js';
import {
  getChannelFiles,
  getChannelMessages,
  getChatMessages,
  listJoinedTeams,
  listTeamChannels,
  listTeamMembers,
  listTeamsChats,
  liveSearchTeamsMessages,
  postChannelMessage,
  sendChatMessage,
  sendDirectMessageToUser,
} from '../msgraph/services/teamsService.js';

export async function registerTeamsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>('/api/teams/chats', async (req) => {
    const refresh = req.query.refresh === 'true';
    if (!refresh) {
      const cached = getCachedChats();
      if (cached.length > 0) return { source: 'cache', chats: cached };
    }
    const chats = await listTeamsChats(40);
    saveCachedChats(chats);
    return { source: 'live', chats };
  });

  app.get<{ Params: { chatId: string }; Querystring: { limit?: string } }>(
    '/api/teams/chats/:chatId/messages',
    async (req) => {
      const limit = Number(req.query.limit) || 50;
      return getChatMessages(req.params.chatId, limit);
    }
  );

  app.post<{ Params: { chatId: string }; Body: { content: string } }>(
    '/api/teams/chats/:chatId/send',
    async (req, reply) => {
      if (!req.body?.content?.trim()) {
        return reply.status(400).send({ error: 'Message content is required' });
      }
      return sendChatMessage(req.params.chatId, req.body.content);
    }
  );

  app.post<{ Body: { userEmailOrId: string; content: string } }>('/api/teams/dm', async (req, reply) => {
    if (!req.body?.userEmailOrId?.trim() || !req.body?.content?.trim()) {
      return reply.status(400).send({ error: 'userEmailOrId and content are required' });
    }
    return sendDirectMessageToUser(req.body.userEmailOrId.trim(), req.body.content);
  });

  app.get<{ Querystring: { refresh?: string } }>('/api/teams/list', async (req) => {
    const refresh = req.query.refresh === 'true';
    if (!refresh) {
      const cached = getCachedTeams();
      if (cached.length > 0) return { source: 'cache', teams: cached };
    }
    const teams = await listJoinedTeams();
    const withChannels = await Promise.all(
      teams.map(async (team) => {
        try {
          const channels = await listTeamChannels(team.id);
          return { team, channels };
        } catch {
          return { team, channels: [] };
        }
      })
    );
    saveCachedTeams(withChannels);
    return { source: 'live', teams: withChannels };
  });

  app.get<{ Params: { teamId: string } }>('/api/teams/:teamId/channels', async (req) =>
    listTeamChannels(req.params.teamId)
  );

  app.get<{ Params: { teamId: string } }>('/api/teams/:teamId/members', async (req) =>
    listTeamMembers(req.params.teamId)
  );

  app.get<{ Params: { teamId: string; channelId: string }; Querystring: { limit?: string } }>(
    '/api/teams/:teamId/channels/:channelId/messages',
    async (req) => {
      const limit = Number(req.query.limit) || 25;
      return getChannelMessages(req.params.teamId, req.params.channelId, limit, true);
    }
  );

  app.post<{
    Params: { teamId: string; channelId: string };
    Body: { content: string; replyToMessageId?: string };
  }>('/api/teams/:teamId/channels/:channelId/send', async (req, reply) => {
    if (!req.body?.content?.trim()) {
      return reply.status(400).send({ error: 'content is required' });
    }
    return postChannelMessage(
      req.params.teamId,
      req.params.channelId,
      req.body.content,
      req.body.replyToMessageId
    );
  });

  app.get<{ Params: { teamId: string; channelId: string } }>(
    '/api/teams/:teamId/channels/:channelId/files',
    async (req) => getChannelFiles(req.params.teamId, req.params.channelId)
  );

  app.get<{ Querystring: { q?: string; live?: string } }>('/api/teams/search', async (req) => {
    const q = (req.query.q || '').trim();
    if (!q) return { ftsHits: [], liveHits: [] };
    const ftsHits = searchFtsIndex(q, undefined, 25);
    const liveHits = req.query.live === 'true' ? await liveSearchTeamsMessages(q, 15) : [];
    return { ftsHits, liveHits };
  });
}
