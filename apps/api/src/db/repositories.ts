import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentConversation,
  AgentMessage,
  CitationItem,
  FtsSearchResult,
  MeetingTranscriptRecord,
  PendingAction,
  PendingActionStatus,
  TeamsChatSummary,
  TeamSummary,
  ChannelSummary,
  ToolTraceItem,
} from '@tzone/shared';
import { getDb } from './client.js';

export function getSetting<T>(key: string, db: DatabaseSync = getDb()): T | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function setSetting(key: string, value: unknown, db: DatabaseSync = getDb()): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function listConversations(db: DatabaseSync = getDb()): AgentConversation[] {
  const rows = db
    .prepare(
      'SELECT id, title, playbook_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50'
    )
    .all() as Array<{
    id: string;
    title: string;
    playbook_id: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    playbookId: r.playbook_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function createConversation(
  title: string,
  playbookId?: string | null,
  db: DatabaseSync = getDb()
): AgentConversation {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO conversations (id, title, playbook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, title.slice(0, 120), playbookId || null, now, now);
  return { id, title: title.slice(0, 120), playbookId: playbookId || null, createdAt: now, updatedAt: now };
}

export function touchConversation(id: string, title?: string, db: DatabaseSync = getDb()): void {
  const now = new Date().toISOString();
  if (title) {
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
      title.slice(0, 120),
      now,
      id
    );
  } else {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, id);
  }
}

export function deleteConversation(id: string, db: DatabaseSync = getDb()): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function getConversationMessages(
  conversationId: string,
  db: DatabaseSync = getDb()
): AgentMessage[] {
  const msgRows = db
    .prepare(
      `SELECT id, conversation_id, role, content, tool_traces_json, citations_json, provider_label, created_at
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    tool_traces_json: string;
    citations_json: string;
    provider_label: string | null;
    created_at: string;
  }>;

  const actionRows = db
    .prepare(
      `SELECT id, conversation_id, message_id, tool_name, title, target_description, args_json,
              preview_text, status, result_text, created_at
       FROM pending_actions WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    message_id: string;
    tool_name: string;
    title: string;
    target_description: string;
    args_json: string;
    preview_text: string;
    status: PendingActionStatus;
    result_text: string | null;
    created_at: string;
  }>;

  const actionsByMessage = new Map<string, PendingAction[]>();
  for (const a of actionRows) {
    const arr = actionsByMessage.get(a.message_id) || [];
    arr.push({
      id: a.id,
      conversationId: a.conversation_id,
      toolName: a.tool_name,
      title: a.title,
      targetDescription: a.target_description,
      args: JSON.parse(a.args_json) as Record<string, unknown>,
      previewText: a.preview_text,
      status: a.status,
      resultText: a.result_text || undefined,
      createdAt: a.created_at,
    });
    actionsByMessage.set(a.message_id, arr);
  }

  return msgRows.map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role,
    content: m.content,
    toolTraces: JSON.parse(m.tool_traces_json) as ToolTraceItem[],
    citations: JSON.parse(m.citations_json) as CitationItem[],
    pendingActions: actionsByMessage.get(m.id) || [],
    providerLabel: m.provider_label || undefined,
    createdAt: m.created_at,
  }));
}

export function addMessage(
  msg: Omit<AgentMessage, 'pendingActions'>,
  db: DatabaseSync = getDb()
): void {
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, tool_traces_json, citations_json, provider_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.id,
    msg.conversationId,
    msg.role,
    msg.content,
    JSON.stringify(msg.toolTraces),
    JSON.stringify(msg.citations),
    msg.providerLabel || null,
    msg.createdAt
  );
  touchConversation(msg.conversationId, undefined, db);
}

export function createPendingAction(
  action: PendingAction & { messageId: string },
  db: DatabaseSync = getDb()
): void {
  db.prepare(
    `INSERT INTO pending_actions
      (id, conversation_id, message_id, tool_name, title, target_description, args_json, preview_text, status, result_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    action.id,
    action.conversationId,
    action.messageId,
    action.toolName,
    action.title,
    action.targetDescription,
    JSON.stringify(action.args),
    action.previewText,
    action.status,
    action.resultText || null,
    action.createdAt
  );
}

export function getPendingAction(id: string, db: DatabaseSync = getDb()): (PendingAction & { messageId: string }) | null {
  const r = db
    .prepare(
      `SELECT id, conversation_id, message_id, tool_name, title, target_description, args_json,
              preview_text, status, result_text, created_at
       FROM pending_actions WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        conversation_id: string;
        message_id: string;
        tool_name: string;
        title: string;
        target_description: string;
        args_json: string;
        preview_text: string;
        status: PendingActionStatus;
        result_text: string | null;
        created_at: string;
      }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    toolName: r.tool_name,
    title: r.title,
    targetDescription: r.target_description,
    args: JSON.parse(r.args_json) as Record<string, unknown>,
    previewText: r.preview_text,
    status: r.status,
    resultText: r.result_text || undefined,
    createdAt: r.created_at,
  };
}

export function updatePendingAction(
  id: string,
  status: PendingActionStatus,
  resultText?: string,
  editedArgs?: Record<string, unknown>,
  db: DatabaseSync = getDb()
): void {
  const now = new Date().toISOString();
  if (editedArgs) {
    db.prepare(
      'UPDATE pending_actions SET status = ?, result_text = ?, args_json = ?, resolved_at = ? WHERE id = ?'
    ).run(status, resultText || null, JSON.stringify(editedArgs), now, id);
  } else {
    db.prepare(
      'UPDATE pending_actions SET status = ?, result_text = ?, resolved_at = ? WHERE id = ?'
    ).run(status, resultText || null, now, id);
  }
}

export function saveTranscriptRecord(rec: MeetingTranscriptRecord, db: DatabaseSync = getDb()): void {
  db.prepare(
    `INSERT INTO transcripts
      (id, meeting_id, transcript_id, subject, organizer_name, start_dt, end_dt, join_url, created_dt,
       raw_vtt, plain_text, segments_json, speaker_stats_json, insights_status, insights_json, extracted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       subject = excluded.subject,
       organizer_name = excluded.organizer_name,
       raw_vtt = excluded.raw_vtt,
       plain_text = excluded.plain_text,
       segments_json = excluded.segments_json,
       speaker_stats_json = excluded.speaker_stats_json,
       insights_status = excluded.insights_status,
       insights_json = excluded.insights_json,
       extracted_at = excluded.extracted_at`
  ).run(
    rec.id,
    rec.meetingId,
    rec.transcriptId,
    rec.subject,
    rec.organizerName,
    rec.startDateTime,
    rec.endDateTime,
    rec.joinUrl,
    rec.createdDateTime,
    rec.rawVtt,
    rec.plainText,
    JSON.stringify(rec.segments),
    JSON.stringify(rec.speakerStats),
    rec.insightsStatus,
    JSON.stringify(rec.insights),
    rec.extractedAt
  );
}

function mapTranscriptRow(r: Record<string, unknown>): MeetingTranscriptRecord {
  return {
    id: String(r.id),
    meetingId: String(r.meeting_id),
    transcriptId: String(r.transcript_id),
    subject: String(r.subject),
    organizerName: String(r.organizer_name),
    startDateTime: String(r.start_dt),
    endDateTime: String(r.end_dt),
    joinUrl: String(r.join_url),
    createdDateTime: String(r.created_dt),
    rawVtt: String(r.raw_vtt),
    plainText: String(r.plain_text),
    segments: JSON.parse(String(r.segments_json)),
    speakerStats: JSON.parse(String(r.speaker_stats_json)),
    insightsStatus: String(r.insights_status) as MeetingTranscriptRecord['insightsStatus'],
    insights: JSON.parse(String(r.insights_json)),
    extractedAt: String(r.extracted_at),
  };
}

export function listTranscripts(db: DatabaseSync = getDb()): MeetingTranscriptRecord[] {
  const rows = db
    .prepare('SELECT * FROM transcripts ORDER BY start_dt DESC, extracted_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapTranscriptRow);
}

export function getTranscriptById(id: string, db: DatabaseSync = getDb()): MeetingTranscriptRecord | null {
  const row = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapTranscriptRow(row) : null;
}

export function saveCachedChats(chats: TeamsChatSummary[], db: DatabaseSync = getDb()): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO chats_cache (id, chat_type, topic, display_title, last_updated, members_json, last_message_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       chat_type = excluded.chat_type,
       topic = excluded.topic,
       display_title = excluded.display_title,
       last_updated = excluded.last_updated,
       members_json = excluded.members_json,
       last_message_json = excluded.last_message_json,
       synced_at = excluded.synced_at`
  );
  for (const c of chats) {
    stmt.run(
      c.id,
      c.chatType,
      c.topic,
      c.displayTitle,
      c.lastUpdatedDateTime,
      JSON.stringify(c.members),
      c.lastMessagePreview ? JSON.stringify(c.lastMessagePreview) : null,
      now
    );
  }
}

export function getCachedChats(db: DatabaseSync = getDb()): TeamsChatSummary[] {
  const rows = db
    .prepare('SELECT * FROM chats_cache ORDER BY last_updated DESC LIMIT 100')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    chatType: String(r.chat_type),
    topic: r.topic ? String(r.topic) : null,
    displayTitle: String(r.display_title),
    lastUpdatedDateTime: String(r.last_updated),
    members: JSON.parse(String(r.members_json)),
    lastMessagePreview: r.last_message_json ? JSON.parse(String(r.last_message_json)) : undefined,
  }));
}

export function saveCachedTeams(
  teams: Array<{ team: TeamSummary; channels: ChannelSummary[] }>,
  db: DatabaseSync = getDb()
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO teams_cache (id, display_name, description, channels_json, synced_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       description = excluded.description,
       channels_json = excluded.channels_json,
       synced_at = excluded.synced_at`
  );
  for (const entry of teams) {
    stmt.run(
      entry.team.id,
      entry.team.displayName,
      entry.team.description || null,
      JSON.stringify(entry.channels),
      now
    );
  }
}

export function getCachedTeams(db: DatabaseSync = getDb()): Array<{ team: TeamSummary; channels: ChannelSummary[] }> {
  const rows = db.prepare('SELECT * FROM teams_cache ORDER BY display_name ASC').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    team: {
      id: String(r.id),
      displayName: String(r.display_name),
      description: r.description ? String(r.description) : undefined,
    },
    channels: JSON.parse(String(r.channels_json)) as ChannelSummary[],
  }));
}

export function replaceFtsForParent(
  sourceType: FtsSearchResult['sourceType'],
  parentId: string,
  items: Array<{
    id: string;
    sourceId: string;
    title: string;
    speakerOrSender: string;
    occurredAt: string;
    body: string;
  }>,
  db: DatabaseSync = getDb()
): void {
  db.prepare('DELETE FROM fts_items WHERE source_type = ? AND parent_id = ?').run(sourceType, parentId);
  const stmt = db.prepare(
    `INSERT INTO fts_items (id, source_type, source_id, parent_id, title, speaker_or_sender, occurred_at, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of items) {
    stmt.run(
      item.id,
      sourceType,
      item.sourceId,
      parentId,
      item.title,
      item.speakerOrSender,
      item.occurredAt,
      item.body
    );
  }
}

function buildSafeFtsQuery(rawQuery: string): string {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, ''))
    .filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' AND ');
}

export function searchFtsIndex(
  rawQuery: string,
  sourceTypes?: FtsSearchResult['sourceType'][],
  limit = 20,
  db: DatabaseSync = getDb()
): FtsSearchResult[] {
  const matchExpr = buildSafeFtsQuery(rawQuery);
  if (!matchExpr) return [];

  let sql = `
    SELECT id, source_type, source_id, parent_id, title, speaker_or_sender, occurred_at,
           snippet(fts_items, 7, '[', ']', '...', 24) AS snippet,
           bm25(fts_items) AS rank
    FROM fts_items
    WHERE fts_items MATCH ?
  `;
  const params: Array<string | number> = [matchExpr];

  if (sourceTypes && sourceTypes.length > 0) {
    const placeholders = sourceTypes.map(() => '?').join(', ');
    sql += ` AND source_type IN (${placeholders})`;
    params.push(...sourceTypes);
  }

  sql += ' ORDER BY rank ASC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    sourceType: String(r.source_type) as FtsSearchResult['sourceType'],
    sourceId: String(r.source_id),
    parentId: String(r.parent_id),
    title: String(r.title),
    speakerOrSender: String(r.speaker_or_sender),
    occurredAt: String(r.occurred_at),
    snippet: String(r.snippet || ''),
    rank: Number(r.rank || 0),
  }));
}

export function getIndexCounts(db: DatabaseSync = getDb()) {
  const chats = (db.prepare('SELECT COUNT(*) AS c FROM chats_cache').get() as { c: number }).c;
  const transcripts = (db.prepare('SELECT COUNT(*) AS c FROM transcripts').get() as { c: number }).c;
  const segments = (
    db.prepare("SELECT COUNT(*) AS c FROM fts_items WHERE source_type = 'transcript_segment'").get() as { c: number }
  ).c;
  const channelMessages = (
    db.prepare("SELECT COUNT(*) AS c FROM fts_items WHERE source_type = 'channel_message'").get() as { c: number }
  ).c;

  return { chats, transcripts, segments, channelMessages };
}
