import crypto from 'node:crypto';
import type {
  AddMeetingUtteranceInput,
  CreateMeetingMissionInput,
  MeetingAgentMission,
  TeamsMessageItem,
  UpdateMeetingMissionInput,
} from '@tzone/shared';
import {
  createConversation,
  createMeetingMission,
  getMeetingMission,
  getTranscriptById,
  listTranscripts,
  searchFtsIndex,
  updateMeetingMission,
} from '../db/repositories.js';
import { runLlmCompletion } from '../llm/provider.js';
import { getAuthStatus } from '../msgraph/authManager.js';
import { graphGet, graphGetAll } from '../msgraph/graphClient.js';
import { getChatMessages, sendChatMessage } from '../msgraph/services/teamsService.js';
import { extractAllTranscripts } from '../msgraph/services/transcriptsService.js';
import { listCalendarEvents } from '../msgraph/services/workspaceService.js';
import { runAgentTurn } from './orchestrator.js';
import { leaveMeetingAsBot, maybeTriggerSpokenReply } from './teamsBrowserBot.js';

export interface CalendarMeetingOption {
  id: string;
  subject: string;
  organizerName: string;
  startDateTime: string;
  endDateTime: string;
  joinUrl: string;
  attendees: Array<{ name: string; email?: string }>;
  isOnlineMeeting: boolean;
}

const answeredChatMessageIds = new Set<string>();

function normalizeJoinUrl(url?: string | null): string {
  if (!url) return '';
  return url.trim().split('?')[0].toLowerCase();
}

export function buildMissionContextPrompt(mission: MeetingAgentMission): string {
  const recentUtterances = mission.utterances
    .slice(-45)
    .map((u) => `[${u.timestamp}] ${u.speaker} (${u.source}): ${u.text}`)
    .join('\n');

  const attendeesText = mission.attendees.length
    ? mission.attendees.map((a) => (a.email ? `${a.name} <${a.email}>` : a.name)).join(', ')
    : 'Not listed';

  const parts = [
    `ACTIVE MEETING AGENT ASSIGNMENT:`,
    `- Meeting Subject: ${mission.subject}`,
    `- Scheduled Window: ${mission.startDateTime || 'Ad-hoc'} -> ${mission.endDateTime || 'Open'}`,
    `- Organizer: ${mission.organizerName || 'Unknown'}`,
    `- Attendees: ${attendeesText}`,
    `- Status: ${mission.status.toUpperCase()}`,
    mission.meetingChatId ? `- Linked Teams Meeting Chat ID: ${mission.meetingChatId}` : '',
    `- Configured Role: ${mission.roleTitle} (${mission.rolePreset})`,
    `- Role Instructions & Context:\n${mission.roleInstructions}`,
    mission.focusTopics.length ? `- Focus Topics: ${mission.focusTopics.join(', ')}` : '',
    mission.prepBrief ? `- Pre-Call Research Brief:\n${mission.prepBrief.slice(0, 3000)}` : '',
    mission.liveNotes ? `- Current Rolling Meeting Notes:\n${mission.liveNotes.slice(0, 3500)}` : '',
    recentUtterances ? `- Live Captured Call Utterances (Latest):\n${recentUtterances}` : '',
  ].filter(Boolean);

  return parts.join('\n\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownToSimpleTeamsHtml(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const escaped = escapeHtml(trimmed)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    if (trimmed.startsWith('### ')) {
      out.push(`<h4>${escaped.slice(4)}</h4>`);
    } else if (trimmed.startsWith('## ')) {
      out.push(`<h3>${escaped.slice(3)}</h3>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      out.push(`<p>• ${escaped.slice(2)}</p>`);
    } else {
      out.push(`<p>${escaped}</p>`);
    }
  }
  return out.join('') || `<p>${escapeHtml(input)}</p>`;
}

export async function resolveMeetingChatId(
  joinUrl?: string,
  subject?: string
): Promise<string | undefined> {
  try {
    const auth = await getAuthStatus();
    if (auth.state !== 'LOGGED_IN') return undefined;

    const chats = await graphGetAll<{
      id: string;
      topic?: string;
      onlineMeetingInfo?: { joinWebUrl?: string };
    }>(
      '/me/chats',
      { $filter: "chatType eq 'meeting'", $top: 50, $select: 'id,topic,onlineMeetingInfo' },
      100
    );

    const targetNorm = normalizeJoinUrl(joinUrl);
    if (targetNorm) {
      const byUrl = chats.find((c) => normalizeJoinUrl(c.onlineMeetingInfo?.joinWebUrl) === targetNorm);
      if (byUrl?.id) return byUrl.id;
    }

    if (subject?.trim()) {
      const targetSubject = subject.trim().toLowerCase();
      const bySubject = chats.find(
        (c) => (c.topic || '').trim().toLowerCase() === targetSubject
      );
      if (bySubject?.id) return bySubject.id;
    }
  } catch {
    // Non-fatal: chat resolution may not apply to ad-hoc meetings or unstarted threads
  }
  return undefined;
}

export async function listCalendarMeetingOptions(
  timezone = 'UTC',
  days = 14,
  pastDays = 2
): Promise<CalendarMeetingOption[]> {
  const events = (await listCalendarEvents({
    limit: 60,
    days,
    pastDays,
    timezone,
  })) as Array<{
    id?: string;
    subject?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    organizer?: { emailAddress?: { name?: string; address?: string } };
    isOnlineMeeting?: boolean;
    onlineMeeting?: { joinUrl?: string };
    onlineMeetingUrl?: string;
    attendees?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  }>;

  return events.map((ev) => ({
    id: ev.id || crypto.randomUUID(),
    subject: ev.subject || '(No Subject)',
    organizerName: ev.organizer?.emailAddress?.name || ev.organizer?.emailAddress?.address || 'Unknown',
    startDateTime: ev.start?.dateTime || '',
    endDateTime: ev.end?.dateTime || '',
    joinUrl: ev.onlineMeeting?.joinUrl || ev.onlineMeetingUrl || '',
    attendees: (ev.attendees || []).map((a) => ({
      name: a.emailAddress?.name || a.emailAddress?.address || 'Attendee',
      email: a.emailAddress?.address,
    })),
    isOnlineMeeting: Boolean(ev.isOnlineMeeting || ev.onlineMeeting?.joinUrl || ev.onlineMeetingUrl),
  }));
}

export async function createConfiguredMission(
  input: CreateMeetingMissionInput
): Promise<MeetingAgentMission> {
  const meetingChatId =
    input.meetingChatId || (await resolveMeetingChatId(input.joinUrl, input.subject));
  return createMeetingMission({
    ...input,
    meetingChatId,
  });
}

export async function updateConfiguredMission(
  id: string,
  patch: UpdateMeetingMissionInput
): Promise<MeetingAgentMission | null> {
  let meetingChatId = patch.meetingChatId;
  if (!meetingChatId && patch.joinUrl) {
    meetingChatId = await resolveMeetingChatId(patch.joinUrl, patch.subject);
  }
  return updateMeetingMission(id, { ...patch, meetingChatId });
}

function gatherFtsBackground(mission: MeetingAgentMission): string {
  const queries = [
    mission.subject,
    ...mission.focusTopics.slice(0, 3),
    ...mission.attendees.slice(0, 2).map((a) => a.name),
  ]
    .map((q) => q.trim())
    .filter((q) => q.length >= 3);

  const seen = new Set<string>();
  const hits: string[] = [];

  for (const q of queries.slice(0, 4)) {
    try {
      const results = searchFtsIndex(q, undefined, 5);
      for (const r of results) {
        if (seen.has(r.sourceId)) continue;
        seen.add(r.sourceId);
        hits.push(`- [${r.sourceType}] **${r.title}** (${r.speakerOrSender}): ${r.snippet}`);
      }
    } catch {
      // Ignore individual FTS query failures
    }
  }

  return hits.slice(0, 10).join('\n');
}

export async function generateMissionPrepBrief(id: string): Promise<MeetingAgentMission> {
  const mission = getMeetingMission(id);
  if (!mission) throw new Error('Meeting agent mission not found');

  const ftsHits = gatherFtsBackground(mission);
  const attendeeNames = mission.attendees.map((a) => a.name).join(', ') || 'Team participants';

  let brief = '';
  try {
    const completion = await runLlmCompletion({
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            'You are preparing a pre-meeting research brief for an AI Meeting Copilot. Keep it concise, grounded strictly in provided data, and aligned with the configured role.',
        },
        {
          role: 'user',
          content: `Prepare a short Pre-Call Context & Research Brief for this meeting:
- Subject: ${mission.subject}
- Time: ${mission.startDateTime || 'Upcoming'}
- Organizer: ${mission.organizerName || 'Unknown'}
- Attendees: ${attendeeNames}
- Agent Role: ${mission.roleTitle}
- Role Instructions: ${mission.roleInstructions}
- Focus Topics: ${mission.focusTopics.join(', ') || 'General'}

Relevant prior T-ZONE indexed context (Teams chats & past transcripts):
${ftsHits || '(No matching prior FTS5 records found yet.)'}

Format with:
### Mission Ready
### Relevant Prior Context
### Watchouts & Suggested Questions to Track`,
        },
      ],
    });
    brief = completion.content.trim();
  } catch (err) {
    brief = `### Mission Ready (${mission.roleTitle})\n- **Focus Topics:** ${
      mission.focusTopics.join(', ') || 'General meeting coverage'
    }\n\n### Indexed Background Context\n${
      ftsHits || 'No matching prior transcripts/chats in local FTS5 index yet.'
    }\n\n*(LLM briefing note unavailable: ${(err as Error).message})*`;
  }

  const updated = updateMeetingMission(id, { prepBrief: brief });
  if (!updated) throw new Error('Failed to save prep brief');
  return updated;
}

export async function joinMeetingMission(id: string): Promise<MeetingAgentMission> {
  const mission = getMeetingMission(id);
  if (!mission) throw new Error('Meeting agent mission not found');

  const convId =
    mission.conversationId || createConversation(`Meeting Agent: ${mission.subject}`, null).id;
  const chatId =
    mission.meetingChatId || (await resolveMeetingChatId(mission.joinUrl, mission.subject));

  let updated = updateMeetingMission(id, {
    status: 'active',
    joinedAt: mission.joinedAt || new Date().toISOString(),
    conversationId: convId,
    meetingChatId: chatId,
  });
  if (!updated) throw new Error('Failed to activate mission');

  if (!updated.prepBrief) {
    updated = await generateMissionPrepBrief(id);
  }

  return updated;
}

export async function synthesizeMissionLiveNotes(id: string): Promise<MeetingAgentMission> {
  const mission = getMeetingMission(id);
  if (!mission) throw new Error('Meeting agent mission not found');

  const transcriptLog = mission.utterances
    .slice(-80)
    .map((u) => `[${u.timestamp}] ${u.speaker}: ${u.text}`)
    .join('\n');

  const ftsHits = gatherFtsBackground(mission);
  const officialTranscript = mission.linkedTranscriptId
    ? getTranscriptById(mission.linkedTranscriptId)
    : null;

  let notes = mission.liveNotes;
  try {
    const completion = await runLlmCompletion({
      stream: false,
      messages: [
        {
          role: 'system',
          content: `You are T-ZONE Meeting Agent executing role: ${mission.roleTitle}.
Follow these role instructions strictly: ${mission.roleInstructions}
Synthesize clean, structured, non-fabricated Markdown meeting notes strictly from the provided live transcript chunks, existing notes, and retrieved background facts.`,
        },
        {
          role: 'user',
          content: `Meeting: ${mission.subject}
Focus Topics: ${mission.focusTopics.join(', ') || 'All topics'}

Previous Notes:
${mission.liveNotes || '(none yet)'}

Live Captured Utterances:
${transcriptLog || '(none captured yet)'}

${officialTranscript ? `Official VTT Excerpt:\n${officialTranscript.plainText.slice(0, 8000)}` : ''}

Relevant Background Facts (FTS5):
${ftsHits || '(none)'}

Produce updated structured Markdown notes with sections:
## Key Points & Decisions
## Research Findings & Context
## Open Questions & Blockers
## Action Items & Owners`,
        },
      ],
    });
    if (completion.content.trim()) {
      notes = completion.content.trim();
    }
  } catch (err) {
    const fallbackLines = mission.utterances
      .slice(-15)
      .map((u) => `- **[${u.timestamp}] ${u.speaker}:** ${u.text}`)
      .join('\n');
    notes = `## Live Captured Log (${mission.roleTitle})\n${
      fallbackLines || '- Waiting for spoken utterances or pasted notes...'
    }\n\n*(LLM note synthesis unavailable: ${(err as Error).message})*`;
  }

  const saved = updateMeetingMission(id, { liveNotes: notes });
  if (!saved) throw new Error('Failed to update live notes');
  return saved;
}

export async function appendMeetingUtterance(
  id: string,
  input: AddMeetingUtteranceInput
): Promise<MeetingAgentMission> {
  const mission = getMeetingMission(id);
  if (!mission) throw new Error('Meeting agent mission not found');

  const nowTs =
    input.timestamp ||
    new Date().toLocaleTimeString('en-GB', { hour12: false });

  const chunk = {
    id: crypto.randomUUID(),
    timestamp: nowTs,
    speaker: input.speaker || 'Speaker',
    text: input.text.trim(),
    source: input.source || ('manual' as const),
  };

  const nextUtterances = [...mission.utterances, chunk].slice(-250);
  const updated = updateMeetingMission(id, { utterances: nextUtterances });
  if (!updated) throw new Error('Failed to append utterance');

  if (chunk.source === 'mic' || chunk.source === 'manual') {
    void maybeTriggerSpokenReply(id, chunk.speaker, chunk.text, chunk.source);
  }

  const shouldAutoRefresh =
    input.refreshNotes || (updated.autoNotes && nextUtterances.length % 4 === 0);

  if (shouldAutoRefresh) {
    return synthesizeMissionLiveNotes(id);
  }
  return updated;
}

export async function fetchMeetingTeamsChat(id: string): Promise<{
  meetingChatId?: string;
  messages: TeamsMessageItem[];
}> {
  const mission = getMeetingMission(id);
  if (!mission) throw new Error('Meeting agent mission not found');

  let chatId = mission.meetingChatId;
  if (!chatId) {
    chatId = await resolveMeetingChatId(mission.joinUrl, mission.subject);
    if (chatId) {
      updateMeetingMission(id, { meetingChatId: chatId });
    }
  }
  if (!chatId) return { meetingChatId: undefined, messages: [] };

  const messages = await getChatMessages(chatId, 30);
  return { meetingChatId: chatId, messages };
}

export async function postToMeetingTeamsChat(
  id: string,
  text: string
): Promise<{ meetingChatId: string; messageId: string }> {
  const mission = getMeetingMission(id);
  if (!mission) throw new Error('Meeting agent mission not found');

  const chatId =
    mission.meetingChatId || (await resolveMeetingChatId(mission.joinUrl, mission.subject));
  if (!chatId) {
    throw new Error(
      'No linked Teams meeting chat was found for this meeting yet. Ensure the call has an active Teams chat thread and valid Join URL.'
    );
  }
  if (!mission.meetingChatId) {
    updateMeetingMission(id, { meetingChatId: chatId });
  }

  const html = markdownToSimpleTeamsHtml(text);
  const sent = await sendChatMessage(chatId, html);
  return { meetingChatId: chatId, messageId: sent.id };
}

export async function pollMeetingChatAutoRespond(id: string): Promise<{
  meetingChatId?: string;
  messages: TeamsMessageItem[];
  autoRepliedCount: number;
}> {
  const { meetingChatId, messages } = await fetchMeetingTeamsChat(id);
  const mission = getMeetingMission(id);
  if (!mission || !meetingChatId || !mission.autoRespondChat || mission.status !== 'active') {
    return { meetingChatId, messages, autoRepliedCount: 0 };
  }

  let meName = '';
  try {
    const me = await graphGet<{ displayName?: string }>('/me', { $select: 'displayName' });
    meName = (me.displayName || '').toLowerCase();
  } catch {
    meName = '';
  }

  let autoRepliedCount = 0;
  const triggerRegex = /(^|\s)(@agent|@tzone|\?research)\b/i;

  for (const msg of messages.slice(-6)) {
    if (!msg.id || answeredChatMessageIds.has(msg.id)) continue;
    const plain = (msg.bodyText || '').trim();
    if (!plain || plain.startsWith('[T-ZONE Meeting Agent]')) continue;
    if (!triggerRegex.test(plain)) continue;

    // Avoid replying if a T-ZONE reply immediately follows
    const idx = messages.findIndex((m) => m.id === msg.id);
    const alreadyFollowedByAgent = messages
      .slice(idx + 1)
      .some((later) => later.bodyText.includes('[T-ZONE Meeting Agent]'));
    if (alreadyFollowedByAgent) {
      answeredChatMessageIds.add(msg.id);
      continue;
    }

    answeredChatMessageIds.add(msg.id);

    const question = plain.replace(triggerRegex, ' ').trim() || plain;
    let answerText = '';
    try {
      await runAgentTurn(
        {
          conversationId: mission.conversationId || undefined,
          prompt: `[Meeting Chat Request from ${msg.senderName} (${meName ? `in call with ${meName}` : 'Teams chat'})]: ${question}`,
          systemContextExtra: buildMissionContextPrompt(mission),
        },
        (ev) => {
          if (ev.type === 'done' || ev.type === 'stopped') {
            answerText = ev.message.content;
          }
        }
      );
      if (answerText) {
        const formatted = `**[T-ZONE Meeting Agent · ${mission.roleTitle}]**\n\n${answerText.slice(0, 2200)}`;
        await postToMeetingTeamsChat(id, formatted);
        autoRepliedCount += 1;
      }
    } catch {
      // Allow retry if send failed
      answeredChatMessageIds.delete(msg.id);
    }
  }

  const latestRes = await fetchMeetingTeamsChat(id);
  return { ...latestRes, autoRepliedCount };
}

export async function endMeetingMission(id: string): Promise<MeetingAgentMission> {
  const mission = getMeetingMission(id);
  if (!mission) throw new Error('Meeting agent mission not found');

  await leaveMeetingAsBot(id).catch(() => {});

  let linkedTranscriptId = mission.linkedTranscriptId || null;
  if (mission.autoExtractTranscript && mission.startDateTime) {
    try {
      const startMs = new Date(mission.startDateTime).getTime();
      const baseMs = Number.isFinite(startMs) ? startMs : Date.now();
      const startDate = new Date(baseMs - 86400 * 1000).toISOString().slice(0, 10);
      const endDate = new Date(baseMs + 86400 * 1000).toISOString().slice(0, 10);

      await extractAllTranscripts({
        startDate,
        endDate,
        includeInsights: true,
      });

      const all = listTranscripts();
      const normUrl = normalizeJoinUrl(mission.joinUrl);
      const match =
        (normUrl && all.find((t) => normalizeJoinUrl(t.joinUrl) === normUrl)) ||
        all.find((t) => t.subject.toLowerCase().includes(mission.subject.toLowerCase().slice(0, 24)));
      if (match) linkedTranscriptId = match.id;
    } catch {
      // Non-fatal if transcript isn't available immediately after call end
    }
  }

  const completed = updateMeetingMission(id, {
    status: 'completed',
    endedAt: new Date().toISOString(),
    linkedTranscriptId,
  });
  if (!completed) throw new Error('Failed to mark mission completed');

  if (completed.utterances.length > 0 || linkedTranscriptId) {
    return synthesizeMissionLiveNotes(id);
  }
  return completed;
}
