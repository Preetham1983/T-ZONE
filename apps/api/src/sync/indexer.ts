import type { SyncStatusResponse } from '@tzone/shared';
import {
  getIndexCounts,
  getSetting,
  replaceFtsForParent,
  saveCachedChats,
  saveCachedTeams,
  setSetting,
} from '../db/repositories.js';
import {
  getChannelMessages,
  getChatMessages,
  listJoinedTeams,
  listTeamChannels,
  listTeamsChats,
} from '../msgraph/services/teamsService.js';
import { extractAllTranscripts } from '../msgraph/services/transcriptsService.js';

let activeSyncPromise: Promise<SyncStatusResponse> | null = null;

export function getSyncStatus(): SyncStatusResponse {
  const counts = getIndexCounts();
  const meta = getSetting<{ lastSyncedAt?: string }>('sync_meta');
  return {
    lastSyncedAt: meta?.lastSyncedAt || null,
    chatCount: counts.chats,
    channelMessageCount: counts.channelMessages,
    transcriptCount: counts.transcripts,
    segmentCount: counts.segments,
    isSyncing: activeSyncPromise !== null,
  };
}

export async function syncWorkspaceIndex(daysBack = 7): Promise<SyncStatusResponse> {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = (async () => {
    try {
      // 1. Sync Teams chats + recent messages
      const chats = await listTeamsChats(35);
      saveCachedChats(chats);

      for (const chat of chats.slice(0, 20)) {
        try {
          const msgs = await getChatMessages(chat.id, 30);
          replaceFtsForParent(
            'chat_message',
            chat.id,
            msgs
              .filter((m) => m.bodyText)
              .map((m) => ({
                id: `chat:${chat.id}:${m.id}`,
                sourceId: m.id,
                title: `Chat: ${chat.displayTitle}`,
                speakerOrSender: m.senderName,
                occurredAt: m.createdDateTime,
                body: m.bodyText,
              }))
          );
        } catch {
          // Skip individual chat errors
        }
      }

      // 2. Sync joined Teams & Channels + recent posts/replies
      const teams = await listJoinedTeams();
      const teamEntries = [];
      for (const team of teams.slice(0, 15)) {
        try {
          const channels = await listTeamChannels(team.id);
          teamEntries.push({ team, channels });
          for (const ch of channels.slice(0, 8)) {
            try {
              const msgs = await getChannelMessages(team.id, ch.id, 20, true);
              const ftsRows = msgs.flatMap((m) => {
                const parentRow = m.bodyText
                  ? [
                      {
                        id: `ch:${ch.id}:${m.id}`,
                        sourceId: m.id,
                        title: `${team.displayName} > #${ch.displayName}`,
                        speakerOrSender: m.senderName,
                        occurredAt: m.createdDateTime,
                        body: m.bodyText,
                      },
                    ]
                  : [];
                const replyRows = (m.replies || [])
                  .filter((r) => r.bodyText)
                  .map((r) => ({
                    id: `ch:${ch.id}:${m.id}:${r.id}`,
                    sourceId: r.id,
                    title: `${team.displayName} > #${ch.displayName} (Reply)`,
                    speakerOrSender: r.senderName,
                    occurredAt: r.createdDateTime,
                    body: r.bodyText,
                  }));
                return [...parentRow, ...replyRows];
              });
              replaceFtsForParent('channel_message', `${team.id}:${ch.id}`, ftsRows);
            } catch {
              // Channel read permissions can vary per team
            }
          }
        } catch {
          // Ignore per-team channel failure
        }
      }
      saveCachedTeams(teamEntries);

      // 3. Extract & index recent meeting transcripts
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - daysBack * 86400 * 1000).toISOString().slice(0, 10);
      await extractAllTranscripts({ startDate, endDate, includeInsights: true });

      setSetting('sync_meta', { lastSyncedAt: new Date().toISOString() });
      return getSyncStatus();
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}
