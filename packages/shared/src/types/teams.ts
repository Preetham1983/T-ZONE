export interface TeamsChatMember {
  id?: string;
  displayName: string;
  email?: string;
}

export interface TeamsChatSummary {
  id: string;
  chatType: 'oneOnOne' | 'group' | 'meeting' | string;
  topic: string | null;
  displayTitle: string;
  lastUpdatedDateTime: string;
  lastMessagePreview?: {
    createdDateTime?: string;
    bodyText?: string;
    senderName?: string;
  };
  members: TeamsChatMember[];
}

export interface TeamsMessageItem {
  id: string;
  chatId?: string;
  teamId?: string;
  channelId?: string;
  createdDateTime: string;
  senderName: string;
  senderEmail?: string;
  bodyText: string;
  bodyHtml?: string;
  replyCount?: number;
  replies?: TeamsMessageItem[];
}

export interface TeamSummary {
  id: string;
  displayName: string;
  description?: string;
}

export interface ChannelSummary {
  id: string;
  teamId: string;
  displayName: string;
  description?: string;
  membershipType?: string;
}

export interface FtsSearchResult {
  id: string;
  sourceType: 'chat_message' | 'channel_message' | 'transcript_segment' | 'copilot_insight';
  sourceId: string;
  parentId: string;
  title: string;
  speakerOrSender: string;
  occurredAt: string;
  snippet: string;
  rank: number;
}
