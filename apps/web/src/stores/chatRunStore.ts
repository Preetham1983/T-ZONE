import type { QueryClient } from '@tanstack/react-query';
import type { AgentMessage, PendingAction, ToolTraceItem } from '@tzone/shared';
import { create } from 'zustand';
import { apiFetch, streamSsePost } from '../api/client.js';
import { useAppStore } from './appStore.js';

export type ChatStreamEvent =
  | { type: 'meta'; conversationId: string; userMessageId: string; assistantMessageId: string }
  | { type: 'status'; text: string }
  | { type: 'tool_start'; trace: ToolTraceItem }
  | { type: 'tool_end'; trace: ToolTraceItem }
  | { type: 'pending_action'; action: PendingAction }
  | { type: 'token'; delta: string }
  | { type: 'done'; message: AgentMessage }
  | { type: 'stopped'; message: AgentMessage }
  | { type: 'error'; message: string };

export interface ActiveChatRun {
  key: string;
  conversationId: string | null;
  userMsg: string;
  userMsgId: string | null;
  assistantMsgId: string | null;
  statusLabel: string;
  content: string;
  traces: ToolTraceItem[];
  actions: PendingAction[];
  errorMsg: string | null;
  stopping: boolean;
  abortController: AbortController;
}

interface StartRunOptions {
  endpoint?: string;
  updateActiveConv?: boolean;
}

interface ChatRunStoreState {
  runs: Record<string, ActiveChatRun>;
  activeDraftKey: string | null;
  setActiveDraftKey: (key: string | null) => void;
  startRun: (
    existingConvId: string | null,
    prompt: string,
    qc: QueryClient,
    options?: StartRunOptions
  ) => Promise<void>;
  stopRun: (runKeyOrConvId: string) => Promise<void>;
}

export const useChatRunStore = create<ChatRunStoreState>((set, get) => ({
  runs: {},
  activeDraftKey: null,

  setActiveDraftKey: (activeDraftKey) => set({ activeDraftKey }),

  startRun: async (existingConvId, prompt, qc, options = {}) => {
    const clean = prompt.trim();
    if (!clean) return;
    const endpoint = options.endpoint || '/api/chat/stream';
    const updateActiveConv = options.updateActiveConv !== false;

    const initialKey = existingConvId || `draft-${crypto.randomUUID()}`;
    if (get().runs[initialKey]) return;

    const abortController = new AbortController();
    const initialRun: ActiveChatRun = {
      key: initialKey,
      conversationId: existingConvId,
      userMsg: clean,
      userMsgId: null,
      assistantMsgId: null,
      statusLabel: 'Starting T-ZONE Agent...',
      content: '',
      traces: [],
      actions: [],
      errorMsg: null,
      stopping: false,
      abortController,
    };

    set((state) => ({
      runs: { ...state.runs, [initialKey]: initialRun },
      activeDraftKey: existingConvId || !updateActiveConv ? state.activeDraftKey : initialKey,
    }));

    let currentKey = initialKey;
    let resolvedConvId = existingConvId;

    const updateCurrent = (updater: (prev: ActiveChatRun) => ActiveChatRun) => {
      set((state) => {
        const cur = state.runs[currentKey];
        if (!cur) return state;
        return { runs: { ...state.runs, [currentKey]: updater(cur) } };
      });
    };

    try {
      await streamSsePost<ChatStreamEvent>(
        endpoint,
        endpoint === '/api/chat/stream'
          ? { conversationId: existingConvId || undefined, prompt: clean }
          : { prompt: clean },
        (ev) => {
          if (ev.type === 'meta') {
            resolvedConvId = ev.conversationId;
            const prevKey = currentKey;
            const newKey = ev.conversationId;
            currentKey = newKey;

            set((state) => {
              const cur = state.runs[prevKey];
              if (!cur) return state;
              const nextRuns = { ...state.runs };
              delete nextRuns[prevKey];
              nextRuns[newKey] = {
                ...cur,
                key: newKey,
                conversationId: ev.conversationId,
                userMsgId: ev.userMessageId,
                assistantMsgId: ev.assistantMessageId,
              };
              return { runs: nextRuns };
            });

            // Only switch the user's open view if they are still looking at this specific draft thread
            if (updateActiveConv && !existingConvId && get().activeDraftKey === prevKey) {
              const app = useAppStore.getState();
              if (app.activeConversationId === null) {
                app.setActiveConversationId(ev.conversationId);
              }
              set({ activeDraftKey: null });
            }
            void qc.invalidateQueries({ queryKey: ['conversations'] });
            if (endpoint !== '/api/chat/stream') {
              void qc.invalidateQueries({ queryKey: ['meeting-missions'] });
            }
          } else if (ev.type === 'status') {
            updateCurrent((r) => ({ ...r, statusLabel: ev.text }));
          } else if (ev.type === 'tool_start') {
            updateCurrent((r) => ({ ...r, traces: [...r.traces, ev.trace] }));
          } else if (ev.type === 'tool_end') {
            updateCurrent((r) => ({
              ...r,
              traces: r.traces.map((t) => (t.id === ev.trace.id ? ev.trace : t)),
            }));
          } else if (ev.type === 'pending_action') {
            updateCurrent((r) => ({ ...r, actions: [...r.actions, ev.action] }));
          } else if (ev.type === 'token') {
            updateCurrent((r) => ({ ...r, content: r.content + ev.delta }));
          } else if (ev.type === 'error') {
            updateCurrent((r) => ({ ...r, errorMsg: ev.message }));
          }
        },
        abortController.signal
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateCurrent((r) => ({ ...r, errorMsg: (err as Error).message }));
      }
    } finally {
      if (resolvedConvId) {
        await qc.invalidateQueries({ queryKey: ['conversation', resolvedConvId] });
      }
      await qc.invalidateQueries({ queryKey: ['conversations'] });

      set((state) => {
        const cur = state.runs[currentKey];
        const nextRuns = { ...state.runs };
        // Keep brief error visibility if stream errored without persisting, otherwise clear run
        if (cur?.errorMsg) {
          nextRuns[currentKey] = { ...cur, statusLabel: '', stopping: false };
          setTimeout(() => {
            set((s) => {
              const copy = { ...s.runs };
              delete copy[currentKey];
              return { runs: copy };
            });
          }, 8000);
        } else {
          delete nextRuns[currentKey];
        }
        return {
          runs: nextRuns,
          activeDraftKey: state.activeDraftKey === initialKey ? null : state.activeDraftKey,
        };
      });
    }
  },

  stopRun: async (runKeyOrConvId) => {
    const run = get().runs[runKeyOrConvId];
    if (!run) return;

    set((state) => {
      const cur = state.runs[runKeyOrConvId];
      if (!cur) return state;
      return {
        runs: {
          ...state.runs,
          [runKeyOrConvId]: { ...cur, stopping: true, statusLabel: 'Stopping...' },
        },
      };
    });

    if (run.conversationId) {
      try {
        await apiFetch(`/api/conversations/${encodeURIComponent(run.conversationId)}/stop`, {
          method: 'POST',
        });
      } catch {
        // Fallback to frontend abort below
      }
    }

    // Guarantee stream closes promptly even if backend is mid-HTTP read
    setTimeout(() => {
      const stillRunning = get().runs[runKeyOrConvId];
      if (stillRunning && !stillRunning.abortController.signal.aborted) {
        stillRunning.abortController.abort();
      }
    }, 1200);
  },
}));
