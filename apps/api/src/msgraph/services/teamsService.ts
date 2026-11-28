import type {
  ChannelSummary,
  TeamSummary,
  TeamsChatMember,
  TeamsChatSummary,
  TeamsMessageItem,
} from '@tzone/shared';
import { getAuthStatus } from '../authManager.js';
import { graphGet, graphGetAll, graphPost, stripHtml } from '../graphClient.js';
import { runMsGraphSkill } from '../skillRunner.js';

interface RawGraphChat {
  id: string;
  chatType?: string;
  topic?: string | null;
  lastUpdatedDateTime?: string;
  members?: Array<{ id?: string; displayName?: string; email?: string; userId?: string }>;
  lastMessagePreview?: {
    createdDateTime?: string;
    body?: { content?: string };
    from?: { user?: { displayName?: string } };
  };
}

function resolveChatDisplayTitle(chat: RawGraphChat, members: TeamsChatMember[], selfEmail: string): string {
  if (chat.topic) return chat.topic;
  const others = members.filter(
    (m) => m.email?.toLowerCase() !== selfEmail.toLowerCase() && m.displayName
  );
  if (others.length > 0) {
    return others.map((m) => m.displayName).slice(0, 4).join(', ');
  }
  if (members.length > 0) {
    return members.map((m) => m.displayName).filter(Boolean).join(', ') || '(direct message)';
  }
  return chat.chatType === 'meeting' ? 'Meeting Chat' : '(direct message)';
}

export async function listTeamsChats(limit = 40): Promise<TeamsChatSummary[]> {
  const status = await getAuthStatus();
  const selfEmail = status.username || '';

  let rawChats: RawGraphChat[] = [];
  try {
    rawChats = await graphGetAll<RawGraphChat>(
      '/me/chats',
      { $top: Math.min(50, limit), $expand: 'lastMessagePreview,members' },
      limit
    );
  } catch {
    // Fallback via the exact msgraph skill command if $expand=members is restricted
    const res = await runMsGraphSkill(['teams', '--chats', '--limit', String(limit), '--json']);
    rawChats = Array.isArray(res.parsedJson) ? (res.parsedJson as RawGraphChat[]) : [];
  }

  const summaries: TeamsChatSummary[] = [];
  for (const c of rawChats) {
    let members: TeamsChatMember[] = (c.members || []).map((m) => ({
      id: m.userId || m.id,
      displayName: m.displayName || m.email || 'Unknown',
      email: m.email,
    }));

    // If members weren't expanded (e.g., CLI fallback), resolve 1:1 / group members lazily for top chats
    if (members.length === 0 && !c.topic && summaries.length < 25) {
      try {
        const memRes = await graphGet<{ value?: Array<{ displayName?: string; email?: string; userId?: string }> }>(
          `/me/chats/${encodeURIComponent(c.id)}/members`
        );
        members = (memRes.value || []).map((m) => ({
          id: m.userId,
          displayName: m.displayName || m.email || 'Unknown',
          email: m.email,
        }));
      } catch {
        // Ignore member expansion failures per chat
      }
    }

    const lastUpdated =
      c.lastMessagePreview?.createdDateTime || c.lastUpdatedDateTime || new Date(0).toISOString();

    summaries.push({
      id: c.id,
      chatType: c.chatType || 'oneOnOne',
      topic: c.topic ?? null,
      displayTitle: resolveChatDisplayTitle(c, members, selfEmail),
      lastUpdatedDateTime: lastUpdated,
      members,
      lastMessagePreview: c.lastMessagePreview
        ? {
            createdDateTime: c.lastMessagePreview.createdDateTime,
            bodyText: stripHtml(c.lastMessagePreview.body?.content),
            senderName: c.lastMessagePreview.from?.user?.displayName || 'System',
          }
        : undefined,
    });
  }

  return summaries.sort((a, b) => b.lastUpdatedDateTime.localeCompare(a.lastUpdatedDateTime));
}

interface RawGraphMessage {
  id: string;
  createdDateTime?: string;
  from?: { user?: { displayName?: string; id?: string } };
  body?: { content?: string; contentType?: string };
  replies?: RawGraphMessage[];
}

function mapGraphMessage(m: RawGraphMessage, extra: { chatId?: string; teamId?: string; channelId?: string }): TeamsMessageItem {
  return {
    id: m.id,
    ...extra,
    createdDateTime: m.createdDateTime || '',
    senderName: m.from?.user?.displayName || 'System',
    bodyHtml: m.body?.content || '',
    bodyText: stripHtml(m.body?.content),
    replies: Array.isArray(m.replies)
      ? m.replies
          .map((r) => mapGraphMessage(r, extra))
          .sort((a, b) => a.createdDateTime.localeCompare(b.createdDateTime))
      : undefined,
    replyCount: Array.isArray(m.replies) ? m.replies.length : undefined,
  };
}

export async function getChatMessages(chatId: string, maxMessages = 50): Promise<TeamsMessageItem[]> {
  const raw = await graphGetAll<RawGraphMessage>(
    `/me/chats/${encodeURIComponent(chatId)}/messages`,
    { $top: Math.min(50, maxMessages) },
    maxMessages
  );
  return raw
    .map((m) => mapGraphMessage(m, { chatId }))
    .sort((a, b) => a.createdDateTime.localeCompare(b.createdDateTime));
}

export async function sendChatMessage(chatId: string, content: string): Promise<{ id: string }> {
  const res = await graphPost<{ id: string }>(`/me/chats/${encodeURIComponent(chatId)}/messages`, {
    body: { contentType: 'html', content },
  });
  return { id: res.id || '' };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a colleague's AAD user ID and display name by email, UPN, AAD ID, or display name.
 * Falls back to `/me/people` and existing chat members if `/users/{id}` is denied by scope policy.
 */
async function resolveTeamsUser(
  userQuery: string
): Promise<{ id: string; displayName: string; email?: string }> {
  const q = userQuery.trim();
  if (!q) throw new Error('Recipient email, name, or user ID is required.');

  // 1. Direct Graph /users/{idOrUpn} lookup (works when User.ReadBasic.All is granted)
  if (q.includes('@') || UUID_RE.test(q)) {
    try {
      const user = await graphGet<{ id: string; displayName?: string; userPrincipalName?: string; mail?: string }>(
        `/users/${encodeURIComponent(q)}`,
        { $select: 'id,displayName,userPrincipalName,mail' }
      );
      if (user?.id) {
        return {
          id: user.id,
          displayName: user.displayName || user.userPrincipalName || q,
          email: user.mail || user.userPrincipalName,
        };
      }
    } catch {
      // Fall back to /me/people and /me/chats below
    }
  }

  const qLower = q.toLowerCase();

  // 2. Search /me/people (uses People.Read, returns AAD object IDs for org users)
  try {
    const peopleRes = await graphGet<{
      value?: Array<{
        id?: string;
        displayName?: string;
        userPrincipalName?: string;
        scoredEmailAddresses?: Array<{ address?: string }>;
      }>;
    }>('/me/people', { $search: `"${q.replace(/"/g, '')}"`, $top: 15 });

    for (const p of peopleRes.value || []) {
      const candidateEmails = [
        p.userPrincipalName,
        ...(p.scoredEmailAddresses || []).map((e) => e.address),
      ]
        .filter(Boolean)
        .map((e) => String(e).toLowerCase());
      const matchesEmail = candidateEmails.some((e) => e === qLower || e.includes(qLower));
      const matchesName = (p.displayName || '').toLowerCase().includes(qLower);
      if (p.id && UUID_RE.test(p.id) && (matchesEmail || matchesName)) {
        return {
          id: p.id,
          displayName: p.displayName || candidateEmails[0] || q,
          email: candidateEmails[0],
        };
      }
    }
  } catch {
    // Ignore and check existing chats
  }

  // 3. Scan existing Teams chats with expanded members
  try {
    const chats = await graphGetAll<RawGraphChat>(
      '/me/chats',
      { $top: 50, $expand: 'members' },
      100
    );
    for (const c of chats) {
      for (const m of c.members || []) {
        const mEmail = (m.email || '').toLowerCase();
        const mName = (m.displayName || '').toLowerCase();
        if (m.userId && (mEmail === qLower || m.userId.toLowerCase() === qLower || mName.includes(qLower))) {
          return {
            id: m.userId,
            displayName: m.displayName || m.email || q,
            email: m.email,
          };
        }
      }
    }
  } catch {
    // Ignore
  }

  throw new Error(
    `Could not resolve Teams user "${userQuery}". Ensure they are in your organization, or sign in again to grant User.ReadBasic.All.`
  );
}

export async function sendDirectMessageToUser(
  userEmailOrId: string,
  content: string
): Promise<{ chatId: string; messageId: string; recipientName: string }> {
  const user = await resolveTeamsUser(userEmailOrId);
  const me = await graphGet<{ id: string }>('/me', { $select: 'id' });

  const chats = await graphGetAll<RawGraphChat>('/me/chats', { $top: 50, $select: 'id,chatType' }, 150);
  let directChat = chats.find((c) => c.chatType === 'oneOnOne' && c.id.includes(user.id));

  if (!directChat) {
    const created = await graphPost<{ id: string }>('/chats', {
      chatType: 'oneOnOne',
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${me.id}')`,
        },
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${user.id}')`,
        },
      ],
    });
    directChat = { id: created.id, chatType: 'oneOnOne' };
  }

  const sent = await sendChatMessage(directChat.id, content);
  return {
    chatId: directChat.id,
    messageId: sent.id,
    recipientName: user.displayName || user.email || userEmailOrId,
  };
}

export async function listJoinedTeams(): Promise<TeamSummary[]> {
  try {
    const data = await graphGet<{ value?: TeamSummary[] }>('/me/joinedTeams', {
      $select: 'id,displayName,description',
    });
    return data.value || [];
  } catch {
    const res = await runMsGraphSkill(['teams', '--teams-list', '--json']);
    return Array.isArray(res.parsedJson) ? (res.parsedJson as TeamSummary[]) : [];
  }
}

export async function listTeamChannels(teamId: string): Promise<ChannelSummary[]> {
  const data = await graphGet<{ value?: Array<Omit<ChannelSummary, 'teamId'>> }>(
    `/teams/${encodeURIComponent(teamId)}/channels`,
    { $select: 'id,displayName,description,membershipType' }
  );
  return (data.value || []).map((c) => ({ ...c, teamId }));
}

export async function listTeamMembers(teamId: string) {
  return graphGetAll<{ id: string; displayName?: string; userPrincipalName?: string; mail?: string }>(
    `/groups/${encodeURIComponent(teamId)}/members/microsoft.graph.user`,
    { $select: 'id,displayName,userPrincipalName,mail', $top: 100 },
    300
  );
}

export async function getChannelMessages(
  teamId: string,
  channelId: string,
  limit = 25,
  expandReplies = true
): Promise<TeamsMessageItem[]> {
  const params: Record<string, string | number> = { $top: limit };
  if (expandReplies) params.$expand = 'replies';

  const data = await graphGet<{ value?: RawGraphMessage[] }>(
    `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
    params
  );

  return (data.value || [])
    .map((m) => mapGraphMessage(m, { teamId, channelId }))
    .sort((a, b) => a.createdDateTime.localeCompare(b.createdDateTime));
}

export async function postChannelMessage(
  teamId: string,
  channelId: string,
  content: string,
  replyToMessageId?: string
): Promise<{ id: string }> {
  const ep = replyToMessageId
    ? `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(replyToMessageId)}/replies`
    : `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`;
  const res = await graphPost<{ id: string }>(ep, {
    body: { contentType: 'html', content },
  });
  return { id: res.id || '' };
}

export async function getChannelFiles(teamId: string, channelId: string) {
  const folder = await graphGet<{ id: string; parentReference?: { driveId?: string }; webUrl?: string }>(
    `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/filesFolder`
  );
  if (!folder.parentReference?.driveId) return { folder, items: [] };
  const items = await graphGet<{ value?: Array<Record<string, unknown>> }>(
    `/drives/${encodeURIComponent(folder.parentReference.driveId)}/items/${encodeURIComponent(folder.id)}/children`,
    { $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder', $top: 50 }
  );
  return { folder, items: items.value || [] };
}

export async function liveSearchTeamsMessages(query: string, limit = 15) {
  try {
    const res = await graphPost<{
      value?: Array<{
        hitsContainers?: Array<{
          hits?: Array<{
            summary?: string;
            resource?: {
              id?: string;
              createdDateTime?: string;
              from?: { user?: { displayName?: string } };
              body?: { content?: string };
              chatId?: string;
              channelIdentity?: { teamId?: string; channelId?: string };
            };
          }>;
        }>;
      }>;
    }>('/search/query', {
      requests: [
        {
          entityTypes: ['chatMessage'],
          query: { queryString: query },
          from: 0,
          size: limit,
        },
      ],
    });
    const hits = res.value?.[0]?.hitsContainers?.[0]?.hits || [];
    return hits.map((h) => ({
      id: h.resource?.id || '',
      createdDateTime: h.resource?.createdDateTime || '',
      senderName: h.resource?.from?.user?.displayName || 'Unknown',
      summary: stripHtml(h.summary || h.resource?.body?.content || ''),
      chatId: h.resource?.chatId,
      teamId: h.resource?.channelIdentity?.teamId,
      channelId: h.resource?.channelIdentity?.channelId,
    }));
  } catch {
    return [];
  }
}
