import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentConversation,
  AgentMessage,
  CitationItem,
  PendingAction,
  ToolTraceItem,
} from '@tzone/shared';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, streamSsePost } from '../../api/client.js';
import { useAppStore } from '../../stores/appStore.js';

type StreamEvent =
  | { type: 'meta'; conversationId: string; userMessageId: string; assistantMessageId: string }
  | { type: 'status'; text: string }
  | { type: 'tool_start'; trace: ToolTraceItem }
  | { type: 'tool_end'; trace: ToolTraceItem }
  | { type: 'pending_action'; action: PendingAction }
  | { type: 'token'; delta: string }
  | { type: 'done'; message: AgentMessage }
  | { type: 'error'; message: string };

function ActionCard({
  action,
  onResolved,
}: {
  action: PendingAction;
  onResolved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editedArgsJson, setEditedArgsJson] = useState(JSON.stringify(action.args, null, 2));

  const resolve = useMutation({
    mutationFn: (payload: { decision: 'approve' | 'reject'; editedArgs?: Record<string, unknown> }) =>
      apiFetch<PendingAction>(`/api/actions/${action.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => onResolved(),
  });

  const badgeColors: Record<PendingAction['status'], string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-300',
    approved: 'bg-blue-100 text-blue-800',
    executed: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-slate-200 text-slate-700',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <div className="mt-3 rounded-lg border-2 border-amber-300 bg-amber-50/70 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-bold text-amber-950">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          {action.title}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold ${badgeColors[action.status]}`}>
          {action.status.toUpperCase()}
        </span>
      </div>
      <div className="font-mono text-[11px] text-slate-700">{action.targetDescription}</div>

      {!editing ? (
        <div className="rounded border border-amber-200 bg-white p-2.5 text-slate-800 whitespace-pre-wrap">
          {action.previewText}
        </div>
      ) : (
        <textarea
          value={editedArgsJson}
          onChange={(e) => setEditedArgsJson(e.target.value)}
          rows={6}
          className="w-full rounded border border-amber-300 bg-white p-2 font-mono text-[11px]"
        />
      )}

      {action.resultText && (
        <div className="rounded bg-white/80 px-2 py-1 font-mono text-[11px] text-slate-700">
          Result: {action.resultText}
        </div>
      )}

      {action.status === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              let parsedArgs: Record<string, unknown> | undefined;
              if (editing) {
                try {
                  parsedArgs = JSON.parse(editedArgsJson) as Record<string, unknown>;
                } catch {
                  alert('Invalid JSON payload');
                  return;
                }
              }
              resolve.mutate({ decision: 'approve', editedArgs: parsedArgs });
            }}
            disabled={resolve.isPending}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Approve &amp; Execute
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            {editing ? 'Preview' : 'Edit JSON'}
          </button>
          <button
            onClick={() => resolve.mutate({ decision: 'reject' })}
            disabled={resolve.isPending}
            className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 font-medium text-red-700 hover:bg-red-100"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function ToolTraceList({ traces }: { traces: ToolTraceItem[] }) {
  const [open, setOpen] = useState(true);
  if (traces.length === 0) return null;

  return (
    <div className="my-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[11px] font-mono">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between font-semibold text-slate-700"
      >
        <span className="flex items-center gap-1">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Skill &amp; Graph Tool Trace ({traces.length})
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {traces.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-slate-700">
              <span className="truncate">
                <span
                  className={
                    t.status === 'success'
                      ? 'text-emerald-600'
                      : t.status === 'error'
                        ? 'text-red-600'
                        : t.status === 'awaiting_approval'
                          ? 'text-amber-600'
                          : 'text-blue-600'
                  }
                >
                  ●
                </span>{' '}
                <strong>{t.toolName}</strong>{' '}
                <span className="text-slate-500">
                  {t.skillCommand ? `[${t.skillCommand}]` : ''}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-500">
                {t.durationMs !== undefined ? `${t.durationMs}ms` : t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const QUICK_PROMPTS = [
  'Extract all transcripts from the last 7 days and summarize key decisions and my action items',
  'Check my unread Teams chats and channel mentions from today',
  'Summarize my upcoming meetings today and check who I am meeting with',
  'Show my open Planner and To Do tasks grouped by priority and due date',
];

export function ChatScreen() {
  const qc = useQueryClient();
  const {
    activeConversationId,
    setActiveConversationId,
    pendingDraftPrompt,
    clearPendingDraftPrompt,
    setScreen,
    setSelectedTranscriptId,
  } = useAppStore();

  const [prompt, setPrompt] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');
  const [liveContent, setLiveContent] = useState('');
  const [liveTraces, setLiveTraces] = useState<ToolTraceItem[]>([]);
  const [liveActions, setLiveActions] = useState<PendingAction[]>([]);
  const [liveUserMsg, setLiveUserMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiFetch<AgentConversation[]>('/api/conversations'),
  });

  const { data: activeConv } = useQuery({
    queryKey: ['conversation', activeConversationId],
    queryFn: () => apiFetch<{ id: string; messages: AgentMessage[] }>(`/api/conversations/${activeConversationId}`),
    enabled: Boolean(activeConversationId),
  });

  const deleteConv = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, deletedId) => {
      if (activeConversationId === deletedId) setActiveConversationId(null);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const sendPrompt = async (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || streaming) return;
    setPrompt('');
    setErrorMsg(null);
    setStreaming(true);
    setLiveUserMsg(clean);
    setLiveContent('');
    setLiveTraces([]);
    setLiveActions([]);
    setStatusLabel('Starting T-ZONE Agent...');

    let targetConvId = activeConversationId;

    try {
      await streamSsePost<StreamEvent>(
        '/api/chat/stream',
        { conversationId: activeConversationId || undefined, prompt: clean },
        (ev) => {
          if (ev.type === 'meta') {
            targetConvId = ev.conversationId;
            setActiveConversationId(ev.conversationId);
          } else if (ev.type === 'status') {
            setStatusLabel(ev.text);
          } else if (ev.type === 'tool_start') {
            setLiveTraces((prev) => [...prev, ev.trace]);
          } else if (ev.type === 'tool_end') {
            setLiveTraces((prev) => prev.map((t) => (t.id === ev.trace.id ? ev.trace : t)));
          } else if (ev.type === 'pending_action') {
            setLiveActions((prev) => [...prev, ev.action]);
          } else if (ev.type === 'token') {
            setLiveContent((prev) => prev + ev.delta);
          } else if (ev.type === 'error') {
            setErrorMsg(ev.message);
          }
        }
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setStreaming(false);
      setLiveUserMsg(null);
      setStatusLabel('');
      qc.invalidateQueries({ queryKey: ['conversations'] });
      if (targetConvId) {
        qc.invalidateQueries({ queryKey: ['conversation', targetConvId] });
      }
    }
  };

  useEffect(() => {
    if (pendingDraftPrompt) {
      const p = pendingDraftPrompt;
      clearPendingDraftPrompt();
      void sendPrompt(p);
    }
  }, [pendingDraftPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages.length, liveContent, liveTraces.length]);

  const messages = activeConv?.messages || [];
  const allCitations: CitationItem[] = messages.flatMap((m) => m.citations).slice(-8).reverse();

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[240px_1fr_290px] overflow-hidden bg-white">
      {/* Left Conversation History */}
      <aside className="hidden lg:flex flex-col border-r border-slate-200 bg-slate-50 p-3 overflow-hidden">
        <button
          onClick={() => setActiveConversationId(null)}
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> New Agent Session
        </button>

        <div className="mb-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
          Sessions
        </div>
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setActiveConversationId(c.id)}
              className={`group flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs cursor-pointer transition ${
                activeConversationId === c.id
                  ? 'border-blue-300 bg-blue-50 text-blue-900'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{c.title}</div>
                <div className="mt-0.5 text-[10px] font-mono text-slate-400">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConv.mutate(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center Stream */}
      <section className="flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-blue-600" />
            <h1 className="text-sm font-bold text-slate-900">Agent Command Center</h1>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-mono text-slate-600">
            msgraph SKILL.md + FTS5
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="mx-auto max-w-2xl py-8 text-center space-y-4">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-200">
                <Sparkles className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Ask T-ZONE anything across Teams &amp; M365</h2>
              <p className="text-sm text-slate-600">
                Search 1:1 chats, channel threads, extract all meeting transcripts with speaker timestamps, or perform Teams, Outlook, Calendar, Planner, and OneNote operations.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left pt-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => void sendPrompt(q)}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 hover:border-blue-400 hover:bg-blue-50/40 transition"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-4 text-sm ${
                m.role === 'user'
                  ? 'ml-auto max-w-2xl border-blue-200 bg-blue-50 text-slate-900'
                  : 'border-slate-200 bg-white text-slate-900 shadow-2xs'
              }`}
            >
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <strong className="text-slate-800">{m.role === 'user' ? 'You' : 'T-ZONE Agent'}</strong>
                {m.providerLabel && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                    {m.providerLabel}
                  </span>
                )}
              </div>

              {m.toolTraces.length > 0 && <ToolTraceList traces={m.toolTraces} />}

              <div className="markdown-body">
                <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
              </div>

              {m.pendingActions.map((act) => (
                <ActionCard
                  key={act.id}
                  action={act}
                  onResolved={() => qc.invalidateQueries({ queryKey: ['conversation', m.conversationId] })}
                />
              ))}
            </div>
          ))}

          {streaming && (
            <>
              {liveUserMsg && (
                <div className="ml-auto max-w-2xl rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
                  <strong className="text-xs text-slate-800 block mb-1">You</strong>
                  {liveUserMsg}
                </div>
              )}
              <div className="rounded-xl border border-blue-200 bg-white p-4 text-sm shadow-xs">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <strong className="text-blue-700">T-ZONE Agent</strong>
                  <span className="font-mono text-[11px] text-blue-600 animate-pulse">{statusLabel}</span>
                </div>
                <ToolTraceList traces={liveTraces} />
                {liveContent && (
                  <div className="markdown-body">
                    <Markdown remarkPlugins={[remarkGfm]}>{liveContent}</Markdown>
                  </div>
                )}
                {liveActions.map((act) => (
                  <ActionCard
                    key={act.id}
                    action={act}
                    onResolved={() =>
                      activeConversationId &&
                      qc.invalidateQueries({ queryKey: ['conversation', activeConversationId] })
                    }
                  />
                ))}
              </div>
            </>
          )}

          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <strong>Error:</strong> {errorMsg}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 bg-slate-50 p-3">
          <div className="rounded-xl border border-slate-300 bg-white p-2.5 shadow-2xs">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendPrompt(prompt);
                }
              }}
              rows={2}
              placeholder="Ask anything in Teams, search transcripts, or tell T-ZONE what action to perform..."
              className="w-full resize-none text-sm outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex gap-1.5 text-[10px] font-mono text-slate-500">
                <span className="rounded bg-slate-100 px-2 py-0.5">Skill: msgraph</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">Enter to send</span>
              </div>
              <button
                onClick={() => void sendPrompt(prompt)}
                disabled={!prompt.trim() || streaming}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {streaming ? 'Running...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Right Context Rail */}
      <aside className="hidden lg:flex flex-col border-l border-slate-200 bg-slate-50 p-3 overflow-y-auto space-y-3">
        <div className="text-xs font-bold text-slate-800">Grounded Sources Cited</div>
        {allCitations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
            Transcripts, Teams chats, channels, and emails referenced by the agent appear here with jump links.
          </div>
        ) : (
          allCitations.map((c, idx) => (
            <div key={`${c.id}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 truncate">{c.title}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                  {c.kind}
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-500 truncate">{c.subtitle}</div>
              <p className="text-[11px] text-slate-600 line-clamp-2">{c.snippet}</p>
              {c.kind === 'transcript' && (
                <button
                  onClick={() => {
                    setSelectedTranscriptId(c.id);
                    setScreen('transcripts');
                  }}
                  className="text-[11px] font-medium text-blue-600 hover:underline"
                >
                  Open in Transcript Vault →
                </button>
              )}
              {(c.kind === 'chat' || c.kind === 'channel') && (
                <button
                  onClick={() => setScreen('teams')}
                  className="text-[11px] font-medium text-blue-600 hover:underline"
                >
                  Open Teams Explorer →
                </button>
              )}
            </div>
          ))
        )}
      </aside>
    </div>
  );
}
