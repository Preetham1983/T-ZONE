import { create } from 'zustand';

export type AppScreen =
  | 'dashboard'
  | 'auth'
  | 'chat'
  | 'planner'
  | 'meetings'
  | 'transcripts'
  | 'teams'
  | 'hub'
  | 'settings';
export type HubTab = 'mail' | 'calendar' | 'tasks' | 'files' | 'onenote' | 'org';

export interface MeetingSetupDraft {
  subject: string;
  organizerName?: string;
  startDateTime?: string;
  endDateTime?: string;
  joinUrl?: string;
  attendees?: Array<{ name: string; email?: string }>;
}

interface AppStoreState {
  activeScreen: AppScreen;
  activeConversationId: string | null;
  selectedMissionId: string | null;
  pendingMeetingDraft: MeetingSetupDraft | null;
  selectedTranscriptId: string | null;
  selectedTranscriptTimestamp: string | null;
  selectedChatId: string | null;
  hubTab: HubTab;
  pendingDraftPrompt: string | null;
  cmdkOpen: boolean;
  sidebarCollapsed: boolean;
  sessionsCollapsed: boolean;
  setScreen: (screen: AppScreen) => void;
  setActiveConversationId: (id: string | null) => void;
  setSelectedMissionId: (id: string | null) => void;
  openMeetingAgentWithDraft: (draft: MeetingSetupDraft) => void;
  clearPendingMeetingDraft: () => void;
  setSelectedTranscriptId: (id: string | null) => void;
  jumpToTranscript: (id: string, timestamp?: string | null) => void;
  clearTranscriptTimestamp: () => void;
  jumpToChat: (chatId: string) => void;
  clearSelectedChatId: () => void;
  setHubTab: (tab: HubTab) => void;
  jumpToHub: (tab: HubTab) => void;
  launchPromptInChat: (prompt: string) => void;
  clearPendingDraftPrompt: () => void;
  setCmdkOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleSessions: () => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  activeScreen: 'dashboard',
  activeConversationId: null,
  selectedMissionId: null,
  pendingMeetingDraft: null,
  selectedTranscriptId: null,
  selectedTranscriptTimestamp: null,
  selectedChatId: null,
  hubTab: 'mail',
  pendingDraftPrompt: null,
  cmdkOpen: false,
  sidebarCollapsed: false,
  sessionsCollapsed: false,
  setScreen: (activeScreen) => set({ activeScreen }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setSelectedMissionId: (selectedMissionId) => set({ selectedMissionId }),
  openMeetingAgentWithDraft: (pendingMeetingDraft) =>
    set({ activeScreen: 'meetings', pendingMeetingDraft }),
  clearPendingMeetingDraft: () => set({ pendingMeetingDraft: null }),
  setSelectedTranscriptId: (selectedTranscriptId) =>
    set({ selectedTranscriptId, selectedTranscriptTimestamp: null }),
  jumpToTranscript: (selectedTranscriptId, timestamp = null) =>
    set({
      activeScreen: 'transcripts',
      selectedTranscriptId,
      selectedTranscriptTimestamp: timestamp,
    }),
  clearTranscriptTimestamp: () => set({ selectedTranscriptTimestamp: null }),
  jumpToChat: (selectedChatId) => set({ activeScreen: 'teams', selectedChatId }),
  clearSelectedChatId: () => set({ selectedChatId: null }),
  setHubTab: (hubTab) => set({ hubTab }),
  jumpToHub: (hubTab) => set({ activeScreen: 'hub', hubTab }),
  launchPromptInChat: (pendingDraftPrompt) =>
    set({ activeScreen: 'chat', activeConversationId: null, pendingDraftPrompt }),
  clearPendingDraftPrompt: () => set({ pendingDraftPrompt: null }),
  setCmdkOpen: (cmdkOpen) => set({ cmdkOpen }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleSessions: () => set((s) => ({ sessionsCollapsed: !s.sessionsCollapsed })),
}));
