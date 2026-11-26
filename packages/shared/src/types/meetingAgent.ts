import { z } from 'zod';

export type MeetingAgentStatus = 'scheduled' | 'active' | 'completed';

export type MeetingAgentRolePreset = 'researcher' | 'architect' | 'scrum_tracker' | 'custom';

export type GuestBotPhase =
  | 'idle'
  | 'launching'
  | 'opening_url'
  | 'entering_name'
  | 'waiting_in_lobby'
  | 'in_meeting'
  | 'captions_active'
  | 'blocked_auth'
  | 'ended'
  | 'error';

export type VoiceReplyMode = 'conversational' | 'wake_word';

export interface GuestBotState {
  missionId: string;
  botName: string;
  phase: GuestBotPhase;
  statusMessage: string;
  captionsEnabled: boolean;
  micMuted: boolean;
  autoVoiceReply: boolean;
  voiceMode: VoiceReplyMode;
  spokenCount: number;
  captionsCapturedCount: number;
  hasScreenshot: boolean;
  audioReady: boolean;
  ttsEngine: 'piper_neural' | 'espeak' | 'none';
  lastUpdatedAt: string;
  error?: string;
}

export interface MeetingTranscriptChunk {
  id: string;
  timestamp: string;
  speaker: string;
  text: string;
  source: 'mic' | 'manual' | 'teams_chat' | 'teams_bot' | 'bot_voice';
}

export interface MeetingAttendeeInfo {
  name: string;
  email?: string;
}

export interface MeetingAgentMission {
  id: string;
  subject: string;
  organizerName: string;
  startDateTime: string;
  endDateTime: string;
  joinUrl?: string;
  meetingChatId?: string;
  botDisplayName: string;
  attendees: MeetingAttendeeInfo[];
  rolePreset: MeetingAgentRolePreset;
  roleTitle: string;
  roleInstructions: string;
  focusTopics: string[];
  autoNotes: boolean;
  autoRespondChat: boolean;
  autoExtractTranscript: boolean;
  status: MeetingAgentStatus;
  conversationId?: string | null;
  prepBrief: string;
  liveNotes: string;
  utterances: MeetingTranscriptChunk[];
  linkedTranscriptId?: string | null;
  joinedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRolePresetDefinition {
  id: MeetingAgentRolePreset;
  roleTitle: string;
  description: string;
  defaultInstructions: string;
}

export const MEETING_ROLE_PRESETS: MeetingRolePresetDefinition[] = [
  {
    id: 'researcher',
    roleTitle: 'Researcher & Note-Taker',
    description:
      'Captures structured technical notes, verifies facts across Teams/SharePoint/Transcripts, and answers questions on demand.',
    defaultInstructions:
      'Act as an embedded Researcher & Note-Taker for this call. Track technical decisions, research any system names, prior agreements, or blockers mentioned using T-ZONE tools, keep concise timestamped notes, and highlight unresolved questions with suggested follow-ups.',
  },
  {
    id: 'architect',
    roleTitle: 'Technical Architect',
    description:
      'Monitors design trade-offs, data flow constraints, API/permission limits, and cross-checks past architecture workshops.',
    defaultInstructions:
      'Act as a Technical Architect sitting in on this meeting. Evaluate architectural proposals, spot scalability/security risks or integration gaps against prior T-ZONE transcripts and docs, and formulate crisp technical recommendations when asked.',
  },
  {
    id: 'scrum_tracker',
    roleTitle: 'Action & Blocker Tracker',
    description:
      'Extracts concrete commitments, owners, ETAs, blockers, and drafts Planner/To Do tasks and Teams recap messages.',
    defaultInstructions:
      'Act as an Action & Blocker Tracker. Extract every commitment, blocker, dependency, and owner with clear timestamps. Structure output into Decisions, Blockers, and Ready-to-Assign Action Items.',
  },
  {
    id: 'custom',
    roleTitle: 'Custom Meeting Agent',
    description: 'Define your own specialized role, rules, and context instructions for this call.',
    defaultInstructions:
      'Assist during this meeting using the custom role instructions and focus topics configured below.',
  },
];

export const createMeetingMissionSchema = z.object({
  subject: z.string().min(1).max(300),
  organizerName: z.string().optional().default(''),
  startDateTime: z.string().optional().default(''),
  endDateTime: z.string().optional().default(''),
  joinUrl: z.string().optional(),
  meetingChatId: z.string().optional(),
  botDisplayName: z.string().min(1).max(80).optional().default('T-ZONE Agent'),
  attendees: z
    .array(z.object({ name: z.string(), email: z.string().optional() }))
    .optional()
    .default([]),
  rolePreset: z.enum(['researcher', 'architect', 'scrum_tracker', 'custom']).optional().default('researcher'),
  roleTitle: z.string().min(1).max(160),
  roleInstructions: z.string().min(1).max(4000),
  focusTopics: z.array(z.string()).optional().default([]),
  autoNotes: z.boolean().optional().default(true),
  autoRespondChat: z.boolean().optional().default(false),
  autoExtractTranscript: z.boolean().optional().default(true),
});

export type CreateMeetingMissionInput = z.infer<typeof createMeetingMissionSchema>;

export const updateMeetingMissionSchema = createMeetingMissionSchema.partial().extend({
  status: z.enum(['scheduled', 'active', 'completed']).optional(),
  liveNotes: z.string().optional(),
  prepBrief: z.string().optional(),
});

export type UpdateMeetingMissionInput = z.infer<typeof updateMeetingMissionSchema>;

export const addMeetingUtteranceSchema = z.object({
  speaker: z.string().optional().default('Speaker'),
  text: z.string().min(1).max(4000),
  timestamp: z.string().optional(),
  source: z.enum(['mic', 'manual', 'teams_chat', 'teams_bot', 'bot_voice']).optional().default('manual'),
  refreshNotes: z.boolean().optional().default(false),
});

export type AddMeetingUtteranceInput = z.infer<typeof addMeetingUtteranceSchema>;
