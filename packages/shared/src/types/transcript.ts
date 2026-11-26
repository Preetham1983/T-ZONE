import { z } from 'zod';

export interface TranscriptSegment {
  index: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  speaker: string;
  text: string;
}

export interface SpeakerStat {
  speaker: string;
  segmentCount: number;
  wordCount: number;
  sharePercent: number;
}

export interface CopilotMeetingInsight {
  id: string;
  createdDateTime: string;
  meetingNotes: Array<{
    title: string;
    text?: string;
    subpoints?: Array<{ title?: string; text?: string }>;
  }>;
  actionItems: Array<{
    title: string;
    ownerDisplayName?: string;
    text?: string;
  }>;
  mentions: Array<{
    eventDateTime?: string;
    speakerName?: string;
    utterance?: string;
  }>;
}

export interface MeetingTranscriptRecord {
  id: string;
  meetingId: string;
  transcriptId: string;
  subject: string;
  organizerName: string;
  startDateTime: string;
  endDateTime: string;
  joinUrl: string;
  createdDateTime: string;
  rawVtt: string;
  plainText: string;
  segments: TranscriptSegment[];
  speakerStats: SpeakerStat[];
  insightsStatus: 'available' | 'no_copilot_license' | 'not_ready' | 'unavailable';
  insights: CopilotMeetingInsight[];
  extractedAt: string;
}

export const extractTranscriptsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subjectFilter: z.string().optional(),
  includeInsights: z.boolean().optional().default(true),
});

export type ExtractTranscriptsRequest = z.infer<typeof extractTranscriptsSchema>;

export interface SyncStatusResponse {
  lastSyncedAt: string | null;
  chatCount: number;
  channelMessageCount: number;
  transcriptCount: number;
  segmentCount: number;
  isSyncing: boolean;
}
