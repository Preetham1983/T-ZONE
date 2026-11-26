import { create } from 'zustand';

export type AppScreen = 'auth' | 'chat' | 'transcripts' | 'teams' | 'hub' | 'settings';

interface AppStoreState {
  activeScreen: AppScreen;
  activeConversationId: string | null;
  selectedTranscriptId: string | null;
  pendingDraftPrompt: string | null;
  cmdkOpen: boolean;
  setScreen: (screen: AppScreen) => void;
  setActiveConversationId: (id: string | null) => void;
  setSelectedTranscriptId: (id: string | null) => void;
  launchPromptInChat: (prompt: string) => void;
  clearPendingDraftPrompt: () => void;
  setCmdkOpen: (open: boolean) => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  activeScreen: 'chat',
  activeConversationId: null,
  selectedTranscriptId: null,
  pendingDraftPrompt: null,
  cmdkOpen: false,
  setScreen: (activeScreen) => set({ activeScreen }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setSelectedTranscriptId: (selectedTranscriptId) => set({ selectedTranscriptId }),
  launchPromptInChat: (pendingDraftPrompt) =>
    set({ activeScreen: 'chat', activeConversationId: null, pendingDraftPrompt }),
  clearPendingDraftPrompt: () => set({ pendingDraftPrompt: null }),
  setCmdkOpen: (cmdkOpen) => set({ cmdkOpen }),
}));
