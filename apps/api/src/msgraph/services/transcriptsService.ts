import type { CopilotMeetingInsight, MeetingTranscriptRecord } from '@tzone/shared';
import { replaceFtsForParent, saveTranscriptRecord } from '../../db/repositories.js';
import { parseVtt } from '../../sync/vttParser.js';
import { GraphApiError, graphGet, graphGetAll, graphGetText } from '../graphClient.js';

interface CalendarMeetingCandidate {
  subject: string;
  organizerName: string;
  startDateTime: string;
  endDateTime: string;
  joinUrl: string;
}

interface RawInsightItem {
  id?: string;
  createdDateTime?: string;
  meetingNotes?: Array<{
    title?: string;
    text?: string;
    subpoints?: Array<{ title?: string; text?: string }>;
  }>;
  actionItems?: Array<{
    title?: string;
    ownerDisplayName?: string;
    text?: string;
  }>;
  viewpoint?: {
    mentionEvents?: Array<{
      eventDateTime?: string;
      speaker?: { user?: { displayName?: string } };
      transcriptUtterance?: string;
    }>;
  };
}

function mapInsight(raw: RawInsightItem): CopilotMeetingInsight {
  return {
    id: raw.id || '',
    createdDateTime: raw.createdDateTime || '',
    meetingNotes: (raw.meetingNotes || []).map((n) => ({
      title: n.title || '',
      text: n.text,
      subpoints: n.subpoints,
    })),
    actionItems: (raw.actionItems || []).map((a) => ({
      title: a.title || '',
      ownerDisplayName: a.ownerDisplayName,
      text: a.text,
    })),
    mentions: (raw.viewpoint?.mentionEvents || []).map((m) => ({
      eventDateTime: m.eventDateTime,
      speakerName: m.speaker?.user?.displayName,
      utterance: m.transcriptUtterance,
    })),
  };
}

async function fetchCopilotInsightsForMeeting(
  userObjectId: string,
  meetingId: string
): Promise<{ status: MeetingTranscriptRecord['insightsStatus']; insights: CopilotMeetingInsight[] }> {
  const basePath = `/copilot/users/${encodeURIComponent(userObjectId)}/onlineMeetings/${encodeURIComponent(meetingId)}/aiInsights`;

  const tryFetch = async (path: string, beta: boolean) => graphGet<{ value?: RawInsightItem[] }>(path, undefined, beta);

  let useBeta = false;
  let list: { value?: RawInsightItem[] };
  try {
    list = await tryFetch(basePath, false);
  } catch (err) {
    if (err instanceof GraphApiError && err.statusCode === 404) {
      useBeta = true;
      try {
        list = await tryFetch(basePath, true);
      } catch (err2) {
        if (err2 instanceof GraphApiError && err2.statusCode === 403) {
          return { status: 'no_copilot_license', insights: [] };
        }
        return { status: 'not_ready', insights: [] };
      }
    } else if (err instanceof GraphApiError && err.statusCode === 403) {
      return { status: 'no_copilot_license', insights: [] };
    } else {
      return { status: 'unavailable', insights: [] };
    }
  }

  const items = list.value || [];
  if (items.length === 0) {
    return { status: 'not_ready', insights: [] };
  }

  const full: CopilotMeetingInsight[] = [];
  for (const ins of items) {
    if (!ins.id) continue;
    try {
      const detail = await graphGet<RawInsightItem>(`${basePath}/${encodeURIComponent(ins.id)}`, undefined, useBeta);
      full.push(mapInsight(detail));
    } catch {
      full.push(mapInsight(ins));
    }
  }

  return { status: 'available', insights: full };
}

export async function discoverMeetingCandidates(
  startDate: string,
  endDate: string,
  subjectFilter?: string
): Promise<CalendarMeetingCandidate[]> {
  const candidatesByJoinUrl = new Map<string, CalendarMeetingCandidate>();

  const calEvents = await graphGetAll<{
    subject?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    organizer?: { emailAddress?: { name?: string } };
    isOnlineMeeting?: boolean;
    onlineMeeting?: { joinUrl?: string };
  }>(
    '/me/calendarView',
    {
      startDateTime: `${startDate}T00:00:00Z`,
      endDateTime: `${endDate}T23:59:59Z`,
      $select: 'subject,start,end,organizer,isOnlineMeeting,onlineMeeting',
      $top: 50,
      $orderby: 'start/dateTime',
    },
    200
  );

  for (const ev of calEvents) {
    const joinUrl = ev.onlineMeeting?.joinUrl;
    if (!ev.isOnlineMeeting || !joinUrl) continue;
    candidatesByJoinUrl.set(joinUrl, {
      subject: ev.subject || '(no title)',
      organizerName: ev.organizer?.emailAddress?.name || 'Unknown',
      startDateTime: ev.start?.dateTime || `${startDate}T00:00:00Z`,
      endDateTime: ev.end?.dateTime || `${endDate}T23:59:59Z`,
      joinUrl,
    });
  }

  // Also check meeting chats (captures ad-hoc / unscheduled calls with onlineMeetingInfo)
  try {
    const meetingChats = await graphGetAll<{
      topic?: string;
      lastUpdatedDateTime?: string;
      chatType?: string;
      onlineMeetingInfo?: { joinWebUrl?: string };
    }>('/me/chats', { $filter: "chatType eq 'meeting'", $top: 50 }, 100);

    for (const chat of meetingChats) {
      const joinUrl = chat.onlineMeetingInfo?.joinWebUrl;
      if (!joinUrl || candidatesByJoinUrl.has(joinUrl)) continue;
      const dt = (chat.lastUpdatedDateTime || '').slice(0, 10);
      if (dt && (dt < startDate || dt > endDate)) continue;
      candidatesByJoinUrl.set(joinUrl, {
        subject: chat.topic || 'Teams Meeting Call',
        organizerName: 'Teams Meeting',
        startDateTime: chat.lastUpdatedDateTime || `${startDate}T00:00:00Z`,
        endDateTime: chat.lastUpdatedDateTime || `${startDate}T00:00:00Z`,
        joinUrl,
      });
    }
  } catch {
    // Non-fatal if meeting chat filter isn't supported
  }

  let list = Array.from(candidatesByJoinUrl.values());
  if (subjectFilter?.trim()) {
    const kw = subjectFilter.trim().toLowerCase();
    list = list.filter((m) => m.subject.toLowerCase().includes(kw));
  }
  return list.sort((a, b) => b.startDateTime.localeCompare(a.startDateTime));
}

export async function extractAllTranscripts(
  options: {
    startDate: string;
    endDate: string;
    subjectFilter?: string;
    includeInsights?: boolean;
  },
  onProgress?: (info: { current: number; total: number; subject: string; extractedCount: number }) => void
): Promise<{
  meetingsScanned: number;
  transcriptsExtracted: MeetingTranscriptRecord[];
  errors: Array<{ subject: string; error: string }>;
}> {
  const me = await graphGet<{ id: string }>('/me', { $select: 'id' });
  const candidates = await discoverMeetingCandidates(
    options.startDate,
    options.endDate,
    options.subjectFilter
  );

  const extracted: MeetingTranscriptRecord[] = [];
  const errors: Array<{ subject: string; error: string }> = [];

  for (let idx = 0; idx < candidates.length; idx++) {
    const cand = candidates[idx];
    onProgress?.({
      current: idx + 1,
      total: candidates.length,
      subject: cand.subject,
      extractedCount: extracted.length,
    });

    try {
      const encodedFilter = `joinWebUrl eq '${cand.joinUrl.replace(/'/g, "''")}'`;
      const om = await graphGet<{ value?: Array<{ id: string; subject?: string }> }>(
        '/me/onlineMeetings',
        { $filter: encodedFilter }
      );
      const meeting = om.value?.[0];
      if (!meeting?.id) continue;

      const tList = await graphGet<{ value?: Array<{ id: string; createdDateTime?: string }> }>(
        `/me/onlineMeetings/${encodeURIComponent(meeting.id)}/transcripts`
      );
      const transcripts = tList.value || [];
      if (transcripts.length === 0) continue;

      const insightsRes = options.includeInsights !== false
        ? await fetchCopilotInsightsForMeeting(me.id, meeting.id)
        : { status: 'unavailable' as const, insights: [] };

      for (const t of transcripts) {
        const rawVtt = await graphGetText(
          `/me/onlineMeetings/${encodeURIComponent(meeting.id)}/transcripts/${encodeURIComponent(t.id)}/content`,
          'text/vtt'
        );
        const parsed = parseVtt(rawVtt);
        const recordId = `${meeting.id}:${t.id}`;

        const record: MeetingTranscriptRecord = {
          id: recordId,
          meetingId: meeting.id,
          transcriptId: t.id,
          subject: meeting.subject || cand.subject,
          organizerName: cand.organizerName,
          startDateTime: cand.startDateTime,
          endDateTime: cand.endDateTime,
          joinUrl: cand.joinUrl,
          createdDateTime: t.createdDateTime || cand.startDateTime,
          rawVtt,
          plainText: parsed.plainText,
          segments: parsed.segments,
          speakerStats: parsed.speakerStats,
          insightsStatus: insightsRes.status,
          insights: insightsRes.insights,
          extractedAt: new Date().toISOString(),
        };

        saveTranscriptRecord(record);
        replaceFtsForParent(
          'transcript_segment',
          recordId,
          parsed.segments.map((seg) => ({
            id: `${recordId}#${seg.index}`,
            sourceId: `${recordId}#${seg.startTime}`,
            title: `${record.subject} (${seg.startTime})`,
            speakerOrSender: seg.speaker,
            occurredAt: record.startDateTime,
            body: seg.text,
          }))
        );

        if (insightsRes.insights.length > 0) {
          const insightText = insightsRes.insights
            .flatMap((ins) => [
              ...ins.meetingNotes.map((n) => `${n.title} ${n.text || ''}`),
              ...ins.actionItems.map((a) => `Action: ${a.title} (${a.ownerDisplayName || ''})`),
            ])
            .join('\n');
          if (insightText.trim()) {
            replaceFtsForParent('copilot_insight', recordId, [
              {
                id: `insight:${recordId}`,
                sourceId: recordId,
                title: `Copilot Recap: ${record.subject}`,
                speakerOrSender: 'Microsoft Copilot',
                occurredAt: record.startDateTime,
                body: insightText,
              },
            ]);
          }
        }

        extracted.push(record);
      }
    } catch (err) {
      errors.push({ subject: cand.subject, error: (err as Error).message });
    }
  }

  return {
    meetingsScanned: candidates.length,
    transcriptsExtracted: extracted,
    errors,
  };
}
