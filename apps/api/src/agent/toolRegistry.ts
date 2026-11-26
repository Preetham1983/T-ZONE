import crypto from 'node:crypto';
import type { ApprovalPolicy, CitationItem, PendingAction } from '@tzone/shared';
import {
  createPendingAction,
  getPendingAction,
  getTranscriptById,
  listTranscripts,
  searchFtsIndex,
  updatePendingAction,
} from '../db/repositories.js';
import type { ChatToolDefinition } from '../llm/provider.js';
import { runMsGraphSkill } from '../msgraph/skillRunner.js';
import {
  getChannelFiles,
  getChannelMessages,
  getChatMessages,
  listJoinedTeams,
  listTeamChannels,
  listTeamsChats,
  liveSearchTeamsMessages,
  postChannelMessage,
  sendChatMessage,
  sendDirectMessageToUser,
} from '../msgraph/services/teamsService.js';
import { extractAllTranscripts } from '../msgraph/services/transcriptsService.js';
import {
  checkAvailability,
  completePlannerTask,
  completeTodoTask,
  createCalendarEvent,
  createEmailDraft,
  createOnenotePage,
  createPlannerTask,
  createTodoTask,
  getOrgOverview,
  listCalendarEvents,
  listDriveItems,
  listEmails,
  listOnenoteNotebooks,
  listOnenotePages,
  listOnenoteSections,
  listOneDriveFiles,
  listPlanBuckets,
  listPlannerPlans,
  listPlanTasks,
  listMyPlannerTasks,
  listSharepointSites,
  listSiteDrives,
  listTodoLists,
  listTodoTasks,
  readEmail,
  readOnenotePage,
  searchPeople,
  sendEmail,
} from '../msgraph/services/workspaceService.js';

export interface ToolExecutionContext {
  conversationId: string;
  messageId: string;
  approvalPolicy: ApprovalPolicy;
  citations: CitationItem[];
  pendingActions: PendingAction[];
}

interface RegisteredTool {
  definition: ChatToolDefinition;
  skillCommand?: string;
  isWrite?: boolean;
  isExternalSend?: boolean;
  describeAction?: (args: Record<string, unknown>) => { title: string; target: string; preview: string };
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<unknown>;
}

const READONLY_SKILL_COMMANDS = new Set([
  'status',
  'claims',
  'me',
  'emails',
  'calendar',
  'sharepoint',
  'teams',
  'channels',
  'onedrive',
  'people',
  'org',
  'onenote',
  'planner',
  'todo',
  'transcripts',
]);

const FORBIDDEN_SKILL_FLAGS = new Set(['--send', '--create', '--complete', '--upload', '--draft', '--force']);

function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
): ChatToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
  };
}

export const TOOL_REGISTRY: RegisteredTool[] = [
  {
    definition: def(
      'search_tzone_index',
      'Full-text search across synced Teams chats, channel messages/replies, extracted meeting transcripts, and Copilot insights.',
      {
        query: { type: 'string', description: 'Search keywords' },
        sourceTypes: {
          type: 'array',
          items: { type: 'string', enum: ['chat_message', 'channel_message', 'transcript_segment', 'copilot_insight'] },
          description: 'Optional filter on source types',
        },
        limit: { type: 'number', description: 'Max hits (default 20)' },
      },
      ['query']
    ),
    skillCommand: 'fts5-index',
    execute: async (args, ctx) => {
      const hits = searchFtsIndex(
        String(args.query || ''),
        args.sourceTypes as never,
        Number(args.limit || 20)
      );
      for (const h of hits.slice(0, 6)) {
        ctx.citations.push({
          kind:
            h.sourceType === 'transcript_segment'
              ? 'transcript'
              : h.sourceType === 'copilot_insight'
                ? 'copilot_insight'
                : h.sourceType === 'channel_message'
                  ? 'channel'
                  : 'chat',
          id: h.sourceId,
          title: h.title,
          subtitle: h.speakerOrSender,
          snippet: h.snippet,
          timestamp: h.occurredAt,
        });
      }
      return { count: hits.length, hits };
    },
  },
  {
    definition: def(
      'live_search_teams',
      'Live Microsoft Graph Search across Teams chats and channel messages.',
      { query: { type: 'string' }, limit: { type: 'number' } },
      ['query']
    ),
    skillCommand: 'graph /search/query (chatMessage)',
    execute: async (args, ctx) => {
      const hits = await liveSearchTeamsMessages(String(args.query || ''), Number(args.limit || 15));
      for (const h of hits.slice(0, 5)) {
        ctx.citations.push({
          kind: h.channelId ? 'channel' : 'chat',
          id: h.id,
          title: h.senderName,
          subtitle: h.createdDateTime,
          snippet: h.summary,
          timestamp: h.createdDateTime,
        });
      }
      return { count: hits.length, hits };
    },
  },
  {
    definition: def(
      'list_teams_chats',
      'List Teams 1:1 chats (with resolved participant names), group chats, and meeting chats.',
      { limit: { type: 'number' } }
    ),
    skillCommand: 'msgraph teams --chats',
    execute: async (args) => listTeamsChats(Number(args.limit || 30)),
  },
  {
    definition: def(
      'read_chat_messages',
      'Read messages from a specific Teams chat ID.',
      { chatId: { type: 'string' }, limit: { type: 'number' } },
      ['chatId']
    ),
    skillCommand: 'msgraph teams --messages CHAT_ID',
    execute: async (args, ctx) => {
      const msgs = await getChatMessages(String(args.chatId), Number(args.limit || 40));
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        ctx.citations.push({
          kind: 'chat',
          id: String(args.chatId),
          title: `Teams Chat (${msgs.length} messages)`,
          subtitle: last.senderName,
          snippet: last.bodyText.slice(0, 160),
          timestamp: last.createdDateTime,
        });
      }
      return msgs;
    },
  },
  {
    definition: def(
      'list_joined_teams_and_channels',
      'List all Teams the user belongs to and optionally channels for a specific teamId.',
      { teamId: { type: 'string', description: 'Optional teamId to list channels for' } }
    ),
    skillCommand: 'msgraph teams --teams-list / channels --list',
    execute: async (args) => {
      if (args.teamId) {
        return { teamId: args.teamId, channels: await listTeamChannels(String(args.teamId)) };
      }
      const teams = await listJoinedTeams();
      return { teams };
    },
  },
  {
    definition: def(
      'read_channel_messages',
      'Read messages and reply threads from a Teams channel.',
      {
        teamId: { type: 'string' },
        channelId: { type: 'string' },
        limit: { type: 'number' },
        expandReplies: { type: 'boolean' },
      },
      ['teamId', 'channelId']
    ),
    skillCommand: 'msgraph channels --messages --expand-replies',
    execute: async (args, ctx) => {
      const msgs = await getChannelMessages(
        String(args.teamId),
        String(args.channelId),
        Number(args.limit || 25),
        args.expandReplies !== false
      );
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        ctx.citations.push({
          kind: 'channel',
          id: `${args.teamId}:${args.channelId}`,
          title: `Channel Messages (${msgs.length})`,
          subtitle: last.senderName,
          snippet: last.bodyText.slice(0, 160),
          timestamp: last.createdDateTime,
        });
      }
      return msgs;
    },
  },
  {
    definition: def(
      'list_channel_files',
      'List files shared inside a Teams channel SharePoint folder.',
      { teamId: { type: 'string' }, channelId: { type: 'string' } },
      ['teamId', 'channelId']
    ),
    skillCommand: 'graph /channels/{id}/filesFolder',
    execute: async (args) => getChannelFiles(String(args.teamId), String(args.channelId)),
  },
  {
    definition: def(
      'list_or_extract_transcripts',
      'List already-extracted meeting transcripts OR extract fresh transcripts + Copilot insights from Teams meetings in a date range.',
      {
        mode: { type: 'string', enum: ['list_cached', 'extract_range'], description: 'Use extract_range to fetch fresh transcripts from Microsoft Graph' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        subjectFilter: { type: 'string' },
      }
    ),
    skillCommand: 'msgraph transcripts --vtt --insights',
    execute: async (args, ctx) => {
      if (args.mode === 'extract_range') {
        const today = new Date().toISOString().slice(0, 10);
        const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
        const startDate = String(args.startDate || weekAgo);
        const endDate = String(args.endDate || today);
        let res = await extractAllTranscripts({
          startDate,
          endDate,
          subjectFilter: args.subjectFilter ? String(args.subjectFilter) : undefined,
          includeInsights: true,
        });
        // If a multi-word or mismatched subjectFilter yielded 0 transcripts, retry without subjectFilter
        // so the agent sees all available meetings in range (e.g. "ontology blocker call" -> "Ontology Workshop").
        if (res.transcriptsExtracted.length === 0 && args.subjectFilter) {
          res = await extractAllTranscripts({
            startDate,
            endDate,
            includeInsights: true,
          });
        }
        for (const t of res.transcriptsExtracted.slice(0, 6)) {
          ctx.citations.push({
            kind: 'transcript',
            id: t.id,
            title: t.subject,
            subtitle: `${t.startDateTime.slice(0, 10)} · ${t.segments.length} segments`,
            snippet: t.plainText.slice(0, 180),
            timestamp: t.startDateTime,
          });
        }
        return {
          meetingsScanned: res.meetingsScanned,
          extractedCount: res.transcriptsExtracted.length,
          errors: res.errors,
          transcripts: res.transcriptsExtracted.map((t) => ({
            id: t.id,
            subject: t.subject,
            startDateTime: t.startDateTime,
            organizerName: t.organizerName,
            segmentCount: t.segments.length,
            speakerStats: t.speakerStats,
            insightsStatus: t.insightsStatus,
            insights: t.insights,
          })),
        };
      }

      const cached = listTranscripts();
      const kw = args.subjectFilter ? String(args.subjectFilter).toLowerCase() : '';
      const filtered = cached.filter((t) => (!kw ? true : t.subject.toLowerCase().includes(kw)));
      return filtered.map((t) => ({
        id: t.id,
        subject: t.subject,
        startDateTime: t.startDateTime,
        organizerName: t.organizerName,
        segmentCount: t.segments.length,
        speakerStats: t.speakerStats,
        insightsStatus: t.insightsStatus,
      }));
    },
  },
  {
    definition: def(
      'read_transcript_detail',
      'Read speaker-attributed transcript turns and Copilot AI insights by transcriptRecordId OR meeting subject.',
      {
        transcriptRecordId: { type: 'string', description: 'Record id (meetingId:transcriptId), optional if subject is given' },
        subject: { type: 'string', description: 'Optional meeting subject keyword if record id is unknown' },
        keywordFilter: { type: 'string', description: 'Optional keyword to filter turns' },
        offset: { type: 'number', description: 'Starting turn index for pagination (default 0)' },
        maxTurns: { type: 'number', description: 'Max merged speaker turns to return (default 220)' },
      }
    ),
    skillCommand: 'msgraph transcripts --meeting --transcript --vtt',
    execute: async (args, ctx) => {
      let rec = args.transcriptRecordId ? getTranscriptById(String(args.transcriptRecordId)) : null;
      if (!rec && args.subject) {
        const kwSub = String(args.subject).toLowerCase();
        rec = listTranscripts().find((t) => t.subject.toLowerCase().includes(kwSub)) || null;
      }
      if (!rec) {
        throw new Error(`Transcript not found (${String(args.transcriptRecordId || args.subject || 'missing id')}).`);
      }

      // Merge consecutive segments by the same speaker so long VTT transcripts fit cleanly in context
      const mergedTurns: Array<{ index: number; startTime: string; endTime: string; speaker: string; text: string }> = [];
      for (const seg of rec.segments) {
        const last = mergedTurns[mergedTurns.length - 1];
        if (last && last.speaker === seg.speaker && last.text.length < 900) {
          last.endTime = seg.endTime;
          last.text = `${last.text} ${seg.text}`;
        } else {
          mergedTurns.push({
            index: mergedTurns.length,
            startTime: seg.startTime,
            endTime: seg.endTime,
            speaker: seg.speaker,
            text: seg.text,
          });
        }
      }

      const kw = args.keywordFilter ? String(args.keywordFilter).toLowerCase() : '';
      const filtered = mergedTurns.filter((s) =>
        !kw ? true : s.text.toLowerCase().includes(kw) || s.speaker.toLowerCase().includes(kw)
      );
      const offset = Math.max(0, Number(args.offset || 0));
      const maxTurns = Math.min(300, Math.max(10, Number(args.maxTurns || 220)));
      const page = filtered.slice(offset, offset + maxTurns);

      ctx.citations.push({
        kind: 'transcript',
        id: rec.id,
        title: rec.subject,
        subtitle: `${rec.startDateTime.slice(0, 10)} · ${rec.speakerStats.map((s) => s.speaker).slice(0, 3).join(', ')}`,
        snippet: page[0]?.text || rec.plainText.slice(0, 160),
        timestamp: rec.startDateTime,
      });

      return {
        id: rec.id,
        subject: rec.subject,
        startDateTime: rec.startDateTime,
        speakerStats: rec.speakerStats,
        insightsStatus: rec.insightsStatus,
        insights: rec.insights,
        totalRawSegments: rec.segments.length,
        totalTurns: filtered.length,
        offset,
        hasMore: offset + page.length < filtered.length,
        nextOffset: offset + page.length < filtered.length ? offset + page.length : null,
        turns: page,
      };
    },
  },
  {
    definition: def(
      'list_emails',
      'List or search Outlook emails.',
      {
        limit: { type: 'number' },
        unread: { type: 'boolean' },
        search: { type: 'string' },
        folder: { type: 'string' },
      }
    ),
    skillCommand: 'msgraph emails',
    execute: async (args) =>
      listEmails({
        limit: Number(args.limit || 15),
        unread: Boolean(args.unread),
        search: args.search ? String(args.search) : undefined,
        folder: args.folder ? String(args.folder) : undefined,
      }),
  },
  {
    definition: def(
      'read_email',
      'Read the full body of an Outlook email by message ID.',
      { messageId: { type: 'string' } },
      ['messageId']
    ),
    skillCommand: 'msgraph emails --read',
    execute: async (args, ctx) => {
      const mail = await readEmail(String(args.messageId));
      ctx.citations.push({
        kind: 'email',
        id: mail.id,
        title: mail.subject || '(no subject)',
        subtitle: mail.from?.emailAddress?.name || mail.from?.emailAddress?.address || '',
        snippet: (mail.bodyText || '').slice(0, 160),
        timestamp: mail.receivedDateTime,
      });
      return mail;
    },
  },
  {
    definition: def(
      'list_calendar_events',
      'List upcoming calendar events or check availability in a time window.',
      {
        limit: { type: 'number' },
        availabilityStart: { type: 'string', description: 'Optional ISO start for free/busy check' },
        availabilityEnd: { type: 'string', description: 'Optional ISO end for free/busy check' },
      }
    ),
    skillCommand: 'msgraph calendar',
    execute: async (args) => {
      if (args.availabilityStart && args.availabilityEnd) {
        return checkAvailability(String(args.availabilityStart), String(args.availabilityEnd));
      }
      return listCalendarEvents(Number(args.limit || 15));
    },
  },
  {
    definition: def(
      'list_planner_and_todo',
      'List Planner plans, assigned Planner tasks, plan buckets, or Microsoft To Do lists & tasks.',
      {
        scope: { type: 'string', enum: ['planner_plans', 'planner_my_tasks', 'planner_plan_tasks', 'todo_lists', 'todo_tasks'] },
        planId: { type: 'string' },
        listId: { type: 'string' },
      },
      ['scope']
    ),
    skillCommand: 'msgraph planner / todo',
    execute: async (args) => {
      switch (args.scope) {
        case 'planner_plans':
          return listPlannerPlans();
        case 'planner_my_tasks':
          return listMyPlannerTasks();
        case 'planner_plan_tasks':
          if (!args.planId) throw new Error('planId is required');
          return {
            buckets: await listPlanBuckets(String(args.planId)),
            tasks: await listPlanTasks(String(args.planId)),
          };
        case 'todo_lists':
          return listTodoLists();
        case 'todo_tasks':
          if (!args.listId) throw new Error('listId is required');
          return listTodoTasks(String(args.listId));
        default:
          return [];
      }
    },
  },
  {
    definition: def(
      'browse_sharepoint_or_onedrive',
      'Browse SharePoint sites/drives or OneDrive folders.',
      {
        target: { type: 'string', enum: ['sharepoint_sites', 'site_drives', 'drive_items', 'onedrive'] },
        siteId: { type: 'string' },
        driveId: { type: 'string' },
        path: { type: 'string' },
      },
      ['target']
    ),
    skillCommand: 'msgraph sharepoint / onedrive',
    execute: async (args) => {
      switch (args.target) {
        case 'sharepoint_sites':
          return listSharepointSites();
        case 'site_drives':
          return listSiteDrives(String(args.siteId));
        case 'drive_items':
          return listDriveItems(String(args.driveId), args.path ? String(args.path) : undefined);
        default:
          return listOneDriveFiles(args.path ? String(args.path) : undefined);
      }
    },
  },
  {
    definition: def(
      'browse_onenote',
      'List OneNote notebooks, sections, pages, or read a page.',
      {
        action: { type: 'string', enum: ['notebooks', 'sections', 'pages', 'read'] },
        notebookId: { type: 'string' },
        sectionId: { type: 'string' },
        pageId: { type: 'string' },
      },
      ['action']
    ),
    skillCommand: 'msgraph onenote',
    execute: async (args) => {
      if (args.action === 'notebooks') return listOnenoteNotebooks();
      if (args.action === 'sections') return listOnenoteSections(String(args.notebookId));
      if (args.action === 'pages') return listOnenotePages(String(args.sectionId));
      return readOnenotePage(String(args.pageId));
    },
  },
  {
    definition: def(
      'lookup_people_and_org',
      'Search people/contacts or inspect org chart (manager, direct reports, frequent colleagues).',
      {
        mode: { type: 'string', enum: ['org_overview', 'search_people', 'contacts'] },
        query: { type: 'string' },
      },
      ['mode']
    ),
    skillCommand: 'msgraph people / org',
    execute: async (args) => {
      if (args.mode === 'org_overview') return getOrgOverview();
      return searchPeople(args.query ? String(args.query) : undefined, args.mode === 'contacts');
    },
  },
  {
    definition: def(
      'run_msgraph_skill_readonly',
      'Execute any read-only subcommand of the bundled msgraph.js skill directly when specialized flags are needed.',
      {
        command: { type: 'string', description: 'Top-level msgraph command (e.g. claims, sharepoint, emails, planner)' },
        args: { type: 'array', items: { type: 'string' }, description: 'CLI flags without write flags' },
      },
      ['command']
    ),
    skillCommand: 'msgraph <command>',
    execute: async (args) => {
      const cmd = String(args.command || '');
      if (!READONLY_SKILL_COMMANDS.has(cmd)) {
        throw new Error(`Command "${cmd}" is not permitted via generic readonly skill runner.`);
      }
      const cliArgs = Array.isArray(args.args) ? args.args.map(String) : [];
      for (const a of cliArgs) {
        if (FORBIDDEN_SKILL_FLAGS.has(a)) {
          throw new Error(`Write flag "${a}" must use dedicated action tools so safety policy applies.`);
        }
      }
      const res = await runMsGraphSkill([cmd, ...cliArgs]);
      return res.parsedJson ?? res.stdout;
    },
  },

  // ── WRITE / EXTERNAL ACTION TOOLS ───────────────────────────────────────────
  {
    definition: def(
      'send_teams_chat_message',
      'Send a message to an existing Teams chat ID.',
      { chatId: { type: 'string' }, content: { type: 'string' } },
      ['chatId', 'content']
    ),
    skillCommand: 'msgraph teams --send',
    isWrite: true,
    isExternalSend: true,
    describeAction: (a) => ({
      title: 'Send Teams Chat Message',
      target: `Chat ID: ${String(a.chatId).slice(0, 32)}...`,
      preview: String(a.content || ''),
    }),
    execute: async (args) => sendChatMessage(String(args.chatId), String(args.content)),
  },
  {
    definition: def(
      'send_direct_message_to_user',
      'Send a 1:1 Teams direct message to a colleague by email or AAD user ID.',
      { userEmailOrId: { type: 'string' }, content: { type: 'string' } },
      ['userEmailOrId', 'content']
    ),
    skillCommand: 'msgraph teams --dm --send',
    isWrite: true,
    isExternalSend: true,
    describeAction: (a) => ({
      title: 'Send Teams Direct Message',
      target: `To: ${String(a.userEmailOrId)}`,
      preview: String(a.content || ''),
    }),
    execute: async (args) => sendDirectMessageToUser(String(args.userEmailOrId), String(args.content)),
  },
  {
    definition: def(
      'post_teams_channel_message',
      'Post a message or reply in a Microsoft Teams channel.',
      {
        teamId: { type: 'string' },
        channelId: { type: 'string' },
        content: { type: 'string' },
        replyToMessageId: { type: 'string', description: 'Optional parent message ID to reply in thread' },
      },
      ['teamId', 'channelId', 'content']
    ),
    skillCommand: 'msgraph channels --send',
    isWrite: true,
    isExternalSend: true,
    describeAction: (a) => ({
      title: a.replyToMessageId ? 'Reply to Teams Channel Thread' : 'Post to Teams Channel',
      target: `Team ${String(a.teamId).slice(0, 12)}... > Channel ${String(a.channelId).slice(0, 18)}...`,
      preview: String(a.content || ''),
    }),
    execute: async (args) =>
      postChannelMessage(
        String(args.teamId),
        String(args.channelId),
        String(args.content),
        args.replyToMessageId ? String(args.replyToMessageId) : undefined
      ),
  },
  {
    definition: def(
      'create_email_draft',
      'Create an Outlook email draft in Drafts folder (never sends automatically).',
      {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
        html: { type: 'boolean' },
      },
      ['to', 'subject', 'body']
    ),
    skillCommand: 'msgraph emails --draft',
    isWrite: true,
    isExternalSend: false,
    execute: async (args) =>
      createEmailDraft({
        to: (args.to as string[]) || [],
        cc: (args.cc as string[]) || [],
        subject: String(args.subject || ''),
        body: String(args.body || ''),
        html: Boolean(args.html),
      }),
  },
  {
    definition: def(
      'send_email',
      'Send an Outlook email immediately.',
      {
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
        html: { type: 'boolean' },
      },
      ['to', 'subject', 'body']
    ),
    skillCommand: 'msgraph emails --send',
    isWrite: true,
    isExternalSend: true,
    describeAction: (a) => ({
      title: 'Send Outlook Email',
      target: `To: ${(Array.isArray(a.to) ? a.to : []).join(', ')} · Subject: ${String(a.subject || '')}`,
      preview: String(a.body || ''),
    }),
    execute: async (args) =>
      sendEmail({
        to: (args.to as string[]) || [],
        subject: String(args.subject || ''),
        body: String(args.body || ''),
        html: Boolean(args.html),
      }),
  },
  {
    definition: def(
      'create_calendar_event',
      'Schedule a calendar meeting (optionally online Teams meeting).',
      {
        subject: { type: 'string' },
        start: { type: 'string', description: 'YYYY-MM-DDTHH:MM' },
        end: { type: 'string', description: 'YYYY-MM-DDTHH:MM' },
        timezone: { type: 'string' },
        location: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
      },
      ['subject', 'start', 'end']
    ),
    skillCommand: 'msgraph calendar --create',
    isWrite: true,
    isExternalSend: true,
    describeAction: (a) => ({
      title: 'Schedule Calendar Meeting',
      target: `${String(a.subject)} (${String(a.start)} → ${String(a.end)})`,
      preview: `Attendees: ${(Array.isArray(a.attendees) ? a.attendees : []).join(', ') || 'Self only'}\n${String(a.body || '')}`,
    }),
    execute: async (args) =>
      createCalendarEvent({
        subject: String(args.subject),
        start: String(args.start),
        end: String(args.end),
        timezone: args.timezone ? String(args.timezone) : undefined,
        location: args.location ? String(args.location) : undefined,
        attendees: Array.isArray(args.attendees) ? args.attendees.map(String) : undefined,
        body: args.body ? String(args.body) : undefined,
      }),
  },
  {
    definition: def(
      'create_planner_task',
      'Create a task on a Planner board or mark a Planner task complete.',
      {
        action: { type: 'string', enum: ['create', 'complete'] },
        planId: { type: 'string' },
        title: { type: 'string' },
        bucketId: { type: 'string' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        assignUserId: { type: 'string' },
        taskId: { type: 'string', description: 'Required when action=complete' },
      },
      ['action']
    ),
    skillCommand: 'msgraph planner --create / --complete',
    isWrite: true,
    isExternalSend: false,
    execute: async (args) => {
      if (args.action === 'complete') {
        return completePlannerTask(String(args.taskId));
      }
      return createPlannerTask({
        planId: String(args.planId),
        title: String(args.title),
        bucketId: args.bucketId ? String(args.bucketId) : undefined,
        dueDate: args.dueDate ? String(args.dueDate) : undefined,
        assignUserId: args.assignUserId ? String(args.assignUserId) : undefined,
      });
    },
  },
  {
    definition: def(
      'manage_todo_task',
      'Create or complete a personal Microsoft To Do task.',
      {
        action: { type: 'string', enum: ['create', 'complete'] },
        listId: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        dueDate: { type: 'string' },
        taskId: { type: 'string' },
      },
      ['action', 'listId']
    ),
    skillCommand: 'msgraph todo --create / --complete',
    isWrite: true,
    isExternalSend: false,
    execute: async (args) => {
      if (args.action === 'complete') {
        return completeTodoTask(String(args.listId), String(args.taskId));
      }
      return createTodoTask({
        listId: String(args.listId),
        title: String(args.title),
        body: args.body ? String(args.body) : undefined,
        dueDate: args.dueDate ? String(args.dueDate) : undefined,
      });
    },
  },
  {
    definition: def(
      'create_onenote_page',
      'Create a new OneNote page inside a section.',
      { sectionId: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } },
      ['sectionId', 'title', 'body']
    ),
    skillCommand: 'msgraph onenote --create',
    isWrite: true,
    isExternalSend: false,
    execute: async (args) => createOnenotePage(String(args.sectionId), String(args.title), String(args.body)),
  },
];

const TOOL_MAP = new Map(TOOL_REGISTRY.map((t) => [t.definition.function.name, t]));

export function getAllToolDefinitions(): ChatToolDefinition[] {
  return TOOL_REGISTRY.map((t) => t.definition);
}

export function getToolMeta(name: string) {
  return TOOL_MAP.get(name);
}

export async function runRegisteredTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<{ status: 'executed' | 'awaiting_approval' | 'blocked'; data: unknown }> {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  if (tool.isExternalSend && ctx.approvalPolicy === 'draft_only') {
    if (name === 'send_email') {
      const draft = await createEmailDraft({
        to: (args.to as string[]) || [],
        subject: String(args.subject || ''),
        body: String(args.body || ''),
        html: Boolean(args.html),
      });
      return {
        status: 'executed',
        data: { redirectedToDraft: true, message: 'Draft-only policy active: saved to Outlook Drafts instead of sending.', draft },
      };
    }
    return {
      status: 'blocked',
      data: { blocked: true, reason: 'Blocked by "Draft-only safe mode" approval policy in Settings.' },
    };
  }

  if (tool.isExternalSend && ctx.approvalPolicy === 'ask_external') {
    const desc = tool.describeAction?.(args) || {
      title: name,
      target: 'Microsoft 365',
      preview: JSON.stringify(args, null, 2),
    };
    const pending: PendingAction = {
      id: crypto.randomUUID(),
      conversationId: ctx.conversationId,
      toolName: name,
      title: desc.title,
      targetDescription: desc.target,
      args,
      previewText: desc.preview,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    createPendingAction({ ...pending, messageId: ctx.messageId });
    ctx.pendingActions.push(pending);
    return {
      status: 'awaiting_approval',
      data: {
        status: 'awaiting_user_approval',
        actionId: pending.id,
        title: pending.title,
        target: pending.targetDescription,
      },
    };
  }

  const data = await tool.execute(args, ctx);
  return { status: 'executed', data };
}

export async function resolvePendingAction(
  actionId: string,
  decision: 'approve' | 'reject',
  editedArgs?: Record<string, unknown>
): Promise<PendingAction> {
  const existing = getPendingAction(actionId);
  if (!existing) throw new Error('Action not found');
  if (existing.status !== 'pending') return existing;

  if (decision === 'reject') {
    updatePendingAction(actionId, 'rejected', 'Cancelled by user');
    return { ...existing, status: 'rejected', resultText: 'Cancelled by user' };
  }

  const tool = TOOL_MAP.get(existing.toolName);
  if (!tool) throw new Error(`Unknown tool ${existing.toolName}`);

  const finalArgs = editedArgs || existing.args;
  try {
    const result = await tool.execute(finalArgs, {
      conversationId: existing.conversationId,
      messageId: existing.messageId,
      approvalPolicy: 'autonomous',
      citations: [],
      pendingActions: [],
    });
    const resultText = JSON.stringify(result);
    updatePendingAction(actionId, 'executed', resultText, editedArgs);
    return { ...existing, args: finalArgs, status: 'executed', resultText };
  } catch (err) {
    const msg = (err as Error).message;
    updatePendingAction(actionId, 'failed', msg, editedArgs);
    return { ...existing, args: finalArgs, status: 'failed', resultText: msg };
  }
}
