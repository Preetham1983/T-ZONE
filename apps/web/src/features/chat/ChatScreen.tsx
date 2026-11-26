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
  Copy,
  ExternalLink,
  FileAudio,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch } from '../../api/client.js';
import { VoiceMicButton, VoiceStatusStrip } from '../../components/VoiceRecorderPill.js';
import { useVoiceInput } from '../../hooks/useVoiceInput.js';
import { useAppStore } from '../../stores/appStore.js';
import { useChatRunStore } from '../../stores/chatRunStore.js';

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

function ToolTraceList({ traces, defaultOpen = false }: { traces: ToolTraceItem[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (traces.length === 0) return null;

  const totalMs = traces.reduce((acc, t) => acc + (t.durationMs || 0), 0);
  const hasRunning = traces.some((t) => t.status === 'running');

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 transition"
      >
        <span className="flex items-center gap-2 font-medium">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
          <span>
            {traces.length} {traces.length === 1 ? 'tool step' : 'tool steps'}{' '}
            {hasRunning ? 'running' : 'completed'}
            {totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)}s` : ''}
          </span>
        </span>
        <span className="text-[11px] font-medium text-slate-400">{open ? 'Collapse' : 'Inspect'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {traces.map((t) => {
            const badge =
              t.status === 'success'
                ? { label: 'COMPLETED', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' }
                : t.status === 'error'
                  ? { label: 'ERROR', cls: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' }
                  : t.status === 'awaiting_approval'
                    ? { label: 'APPROVAL', cls: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' }
                    : { label: 'RUNNING', cls: 'border-blue-200 bg-blue-50 text-blue-700 animate-pulse', dot: 'bg-blue-500' };
            return (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-xs shadow-2xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-800 truncate">{t.toolName}</div>
                  {t.skillCommand && (
                    <div className="font-mono text-[10px] text-slate-400 truncate mt-0.5">{t.skillCommand}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.durationMs !== undefined && (
                    <span className="font-mono text-[10px] text-slate-400">{t.durationMs}ms</span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${badge.cls}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>
                </div>
              </div>
            );
          })}
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

function linkifyInlineTimestamps(markdown: string, citations: CitationItem[]): string {
  const transcriptCite = citations.find((c) => c.kind === 'transcript' || c.kind === 'copilot_insight');
  if (!transcriptCite) return markdown;

  // Match [00:57:44] or [00:12:15 - 00:12:40] not already followed by '('
  const parts = markdown.split(/(```[\s\S]*?```|`[^`]*`)/g);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[–-]\s*\d{1,2}:\d{2}(?::\d{2})?)?\](?!\()/g, (full, ts: string) => {
        return `[▶ ${full.slice(1, -1)}](#tzone-cite:transcript:${encodeURIComponent(transcriptCite.id)}:${encodeURIComponent(ts)})`;
      });
    })
    .join('');
}

function CopyResponseButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
      title="Copy response"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function InlineCitationsBar({
  citations,
  onOpenCitation,
  copyText,
}: {
  citations: CitationItem[];
  onOpenCitation: (c: CitationItem) => void;
  copyText?: string;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  if (citations.length === 0 && !copyText) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {copyText && <CopyResponseButton text={copyText} />}
          {citations.length > 0 && (
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-slate-400 ml-1 mr-0.5">
              Sources:
            </span>
          )}
          {citations.slice(0, 6).map((c, idx) => {
            const isTranscript = c.kind === 'transcript' || c.kind === 'copilot_insight';
            const isTeams = c.kind === 'chat' || c.kind === 'channel';
            return (
              <div
                key={`${c.id}-${idx}`}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                  title="Preview quoted snippet"
                >
                  {isTranscript ? (
                    <FileAudio className="h-3 w-3 text-blue-600 shrink-0" />
                  ) : isTeams ? (
                    <MessageSquare className="h-3 w-3 text-indigo-600 shrink-0" />
                  ) : (
                    <Sparkles className="h-3 w-3 text-emerald-600 shrink-0" />
                  )}
                  <span className="font-mono text-[10px] font-semibold text-blue-700">[{idx + 1}]</span>
                  <span className="truncate max-w-44 font-medium">{c.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCitation(c)}
                  className="border-l border-slate-200 px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 inline-flex items-center gap-0.5"
                  title={`Open in ${isTranscript ? 'Transcript Vault' : isTeams ? 'Teams Explorer' : 'M365 Hub'}`}
                >
                  Open <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {expandedIdx !== null && citations[expandedIdx] && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-slate-900">{citations[expandedIdx].title}</strong>
            <span className="font-mono text-[10px] text-slate-500">{citations[expandedIdx].subtitle}</span>
          </div>
          <p className="text-slate-700 [overflow-wrap:anywhere]">{citations[expandedIdx].snippet}</p>
          <button
            type="button"
            onClick={() => onOpenCitation(citations[expandedIdx])}
            className="text-[11px] font-semibold text-blue-700 hover:underline"
          >
            Jump to source →
          </button>
        </div>
      )}
    </div>
  );
}

function UserMessageRow({ content }: { content: string }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[82%] sm:max-w-[75%] min-w-0 rounded-2xl border border-blue-200/90 bg-blue-50/75 px-4 py-3 text-sm text-slate-900 shadow-2xs [overflow-wrap:anywhere]">
        <div className="mb-1 text-[11px] font-semibold text-blue-700">You</div>
        <div className="markdown-body leading-relaxed">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      </div>
      <div
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-white text-blue-600 shadow-2xs"
        title="You"
      >
        <User className="h-4 w-4" />
      </div>
    </div>
  );
}

function AgentMessageRow({
  content,
  providerLabel,
  statusLabel,
  stopping,
  onStop,
  traces,
  defaultTracesOpen = false,
  citations = [],
  pendingActions = [],
  onOpenCitation,
  onCitationAnchor,
  onActionResolved,
  isLive = false,
}: {
  content: string;
  providerLabel?: string;
  statusLabel?: string;
  stopping?: boolean;
  onStop?: () => void;
  traces: ToolTraceItem[];
  defaultTracesOpen?: boolean;
  citations?: CitationItem[];
  pendingActions?: PendingAction[];
  onOpenCitation: (c: CitationItem) => void;
  onCitationAnchor: (href?: string) => boolean;
  onActionResolved: () => void;
  isLive?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-600 shadow-2xs ${
          isLive ? 'border-blue-300 ring-2 ring-blue-100' : 'border-blue-200'
        }`}
        title="T-ZONE Agent"
      >
        <Bot className={`h-4 w-4 ${isLive ? 'animate-pulse' : ''}`} />
      </div>

      <div
        className={`flex-1 min-w-0 rounded-2xl border bg-white px-5 py-4 text-sm text-slate-900 [overflow-wrap:anywhere] ${
          isLive ? 'border-blue-200 shadow-xs' : 'border-slate-200/90 shadow-2xs'
        }`}
      >
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              T-ZONE
            </span>
            {providerLabel && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                {providerLabel}
              </span>
            )}
          </div>

          {isLive && (
            <div className="flex items-center gap-2">
              {statusLabel && (
                <span className="font-mono text-[11px] text-blue-600 animate-pulse">{statusLabel}</span>
              )}
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  disabled={stopping}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  {stopping ? 'Stopping' : 'Stop'}
                </button>
              )}
            </div>
          )}
        </div>

        {traces.length > 0 && <ToolTraceList traces={traces} defaultOpen={defaultTracesOpen} />}

        {content && (
          <div className="markdown-body">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  if (href?.startsWith('#tzone-cite:')) {
                    return (
                      <button
                        type="button"
                        onClick={() => onCitationAnchor(href)}
                        className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-blue-700 hover:bg-blue-100 align-baseline cursor-pointer"
                      >
                        {children}
                      </button>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {!isLive ? linkifyInlineTimestamps(content, citations) : content}
            </Markdown>
          </div>
        )}

        {!isLive && (
          <InlineCitationsBar
            citations={citations}
            onOpenCitation={onOpenCitation}
            copyText={content || undefined}
          />
        )}

        {pendingActions.map((act) => (
          <ActionCard key={act.id} action={act} onResolved={onActionResolved} />
        ))}
      </div>
    </div>
  );
}

export function ChatScreen() {
  const qc = useQueryClient();
  const {
    activeConversationId,
    setActiveConversationId,
    pendingDraftPrompt,
    clearPendingDraftPrompt,
    setScreen,
    jumpToTranscript,
    sessionsCollapsed,
    toggleSessions,
  } = useAppStore();

  const { runs, activeDraftKey, setActiveDraftKey, startRun, stopRun } = useChatRunStore();

  const [prompt, setPrompt] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeRunKey = activeConversationId || activeDraftKey;
  const activeRun = activeRunKey ? runs[activeRunKey] : undefined;
  const streaming = Boolean(activeRun && activeRun.statusLabel !== '');

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiFetch<AgentConversation[]>('/api/conversations'),
  });

  const { data: activeConv } = useQuery({
    queryKey: ['conversation', activeConversationId],
    queryFn: () =>
      apiFetch<{ id: string; isRunning?: boolean; messages: AgentMessage[] }>(
        `/api/conversations/${activeConversationId}`
      ),
    enabled: Boolean(activeConversationId),
  });

  const deleteConv = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, deletedId) => {
      if (activeConversationId === deletedId) setActiveConversationId(null);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const sendPrompt = (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || streaming) return;
    setPrompt('');
    void startRun(activeConversationId, clean, qc);
  };

  const voice = useVoiceInput({
    currentText: prompt,
    onTextChange: setPrompt,
    onSubmitText: (spokenText) => sendPrompt(spokenText),
  });

  useEffect(() => {
    const onGlobalShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (!streaming) voice.toggle();
      } else if (e.key === 'Escape' && voice.isListening) {
        e.preventDefault();
        voice.cancel();
      }
    };
    window.addEventListener('keydown', onGlobalShortcut);
    return () => window.removeEventListener('keydown', onGlobalShortcut);
  }, [streaming, voice.isListening, voice.toggle, voice.cancel]);

  useEffect(() => {
    if (pendingDraftPrompt) {
      const p = pendingDraftPrompt;
      clearPendingDraftPrompt();
      setActiveDraftKey(null);
      void startRun(null, p, qc);
    }
  }, [pendingDraftPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages.length, activeRun?.content, activeRun?.traces.length]);

  const messages = activeConv?.messages || [];
  const showLiveUser = Boolean(
    activeRun &&
      activeRun.userMsg &&
      !(activeRun.userMsgId && messages.some((m) => m.id === activeRun.userMsgId))
  );
  const showLiveAssistant = Boolean(
    activeRun &&
      !(activeRun.assistantMsgId && messages.some((m) => m.id === activeRun.assistantMsgId))
  );

  const openCitation = (c: CitationItem) => {
    if (c.kind === 'transcript' || c.kind === 'copilot_insight') {
      const hashParts = c.id.split('#');
      const recId = c.kind === 'copilot_insight' ? c.id.replace(/^insight:/, '') : hashParts[0];
      const ts = hashParts[1] && /^\d{1,2}:\d{2}/.test(hashParts[1]) ? hashParts[1] : null;
      jumpToTranscript(recId, ts);
    } else if (c.kind === 'chat' || c.kind === 'channel') {
      setScreen('teams');
    } else {
      setScreen('hub');
    }
  };

  const handleCitationAnchor = (href?: string) => {
    if (!href?.startsWith('#tzone-cite:')) return false;
    const [, kind, encodedId, encodedTs] = href.split(':');
    if (kind === 'transcript' && encodedId) {
      jumpToTranscript(decodeURIComponent(encodedId), encodedTs ? decodeURIComponent(encodedTs) : null);
      return true;
    }
    return false;
  };

  const filteredConversations = sessionSearch.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(sessionSearch.trim().toLowerCase()))
    : conversations;

  const gridColsClass = sessionsCollapsed
    ? 'lg:grid-cols-[minmax(0,1fr)]'
    : 'lg:grid-cols-[248px_minmax(0,1fr)]';

  return (
    <div className={`grid h-full grid-cols-1 overflow-hidden bg-white ${gridColsClass}`}>
      {/* Left Conversation History */}
      {!sessionsCollapsed && (
        <aside className="hidden lg:flex min-w-0 flex-col border-r border-slate-200 bg-slate-50 p-3 overflow-hidden">
          <button
            onClick={() => {
              setActiveDraftKey(null);
              setActiveConversationId(null);
            }}
            className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New Agent Session
          </button>

          <div className="mb-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
            Sessions
          </div>
          <div className="relative mb-2.5">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="Search sessions..."
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 outline-none focus:border-blue-400"
            />
            {sessionSearch && (
              <button
                type="button"
                onClick={() => setSessionSearch('')}
                className="absolute right-2 top-1.5 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5">
            {filteredConversations.map((c) => {
              const convRunning = Boolean(runs[c.id]?.statusLabel) || Boolean(c.isRunning);
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    setActiveDraftKey(null);
                    setActiveConversationId(c.id);
                  }}
                  className={`group flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs cursor-pointer transition ${
                    activeConversationId === c.id
                      ? 'border-blue-300 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {convRunning && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-600" />}
                      <div className="truncate font-medium">{c.title}</div>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                      <span>{new Date(c.updatedAt).toLocaleDateString()}</span>
                      {convRunning && <span className="text-blue-600 font-semibold">· running</span>}
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
              );
            })}
            {filteredConversations.length === 0 && sessionSearch.trim() && (
              <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-400">
                No matching sessions
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Center Stream */}
      <section className="flex min-w-0 flex-col overflow-hidden bg-slate-50/30">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 sm:px-8 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={toggleSessions}
              title={sessionsCollapsed ? 'Show sessions' : 'Hide sessions'}
              className="hidden lg:inline-flex rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              {sessionsCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <Bot className="h-4 w-4 shrink-0 text-blue-600" />
            <h1 className="text-sm font-bold text-slate-900 truncate">Agent Command Center</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-block rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-blue-700">
              T-ZONE
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-8 py-5">
          <div className="mx-auto w-full max-w-[1320px] space-y-5">
            {messages.length === 0 && !streaming && (
              <div className="mx-auto max-w-4xl py-10 text-center space-y-4">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-200">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Ask T-ZONE anything across Teams &amp; M365</h2>
                <p className="text-sm text-slate-600 max-w-xl mx-auto">
                  Search 1:1 chats, channel threads, extract all meeting transcripts with speaker timestamps, or perform Teams, Outlook, Calendar, Planner, and OneNote operations.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left pt-2">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      onClick={() => void sendPrompt(q)}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 hover:border-blue-400 hover:bg-blue-50/40 transition shadow-2xs"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <UserMessageRow key={m.id} content={m.content} />
              ) : (
                <AgentMessageRow
                  key={m.id}
                  content={m.content}
                  providerLabel={m.providerLabel}
                  traces={m.toolTraces}
                  citations={m.citations}
                  pendingActions={m.pendingActions}
                  onOpenCitation={openCitation}
                  onCitationAnchor={handleCitationAnchor}
                  onActionResolved={() => qc.invalidateQueries({ queryKey: ['conversation', m.conversationId] })}
                />
              )
            )}

            {activeRun && (
              <>
                {showLiveUser && <UserMessageRow content={activeRun.userMsg} />}
                {showLiveAssistant && activeRun.statusLabel && (
                  <AgentMessageRow
                    content={activeRun.content}
                    statusLabel={activeRun.statusLabel}
                    stopping={activeRun.stopping}
                    onStop={() => void stopRun(activeRun.key)}
                    traces={activeRun.traces}
                    defaultTracesOpen={true}
                    pendingActions={activeRun.actions}
                    onOpenCitation={openCitation}
                    onCitationAnchor={handleCitationAnchor}
                    onActionResolved={() =>
                      activeConversationId &&
                      qc.invalidateQueries({ queryKey: ['conversation', activeConversationId] })
                    }
                    isLive={true}
                  />
                )}
              </>
            )}

            {activeRun?.errorMsg && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <strong>Error:</strong> {activeRun.errorMsg}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 bg-white px-5 sm:px-8 py-3">
          <div
            className={`mx-auto w-full max-w-[1320px] rounded-xl border bg-white p-2.5 shadow-2xs transition ${
              voice.isListening ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-300'
            }`}
          >
            <VoiceStatusStrip
              isListening={voice.isListening}
              elapsedSeconds={voice.elapsedSeconds}
              levels={voice.levels}
              error={voice.error}
              onStop={voice.stop}
              onStopAndSend={streaming ? undefined : voice.stopAndSend}
              onCancel={voice.cancel}
              onClearError={voice.clearError}
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (voice.isListening) {
                    voice.stopAndSend();
                  } else {
                    void sendPrompt(prompt);
                  }
                } else if (e.key === 'Escape' && voice.isListening) {
                  e.preventDefault();
                  voice.cancel();
                }
              }}
              rows={2}
              placeholder={
                voice.isListening
                  ? 'Listening... speak naturally, then press Enter to send or Stop to edit'
                  : 'Ask anything in Teams, search transcripts, or click Mic / Ctrl+M to speak...'
              }
              className="w-full resize-none text-sm outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex gap-1.5 text-[10px] font-mono text-slate-500">
                <span className="rounded bg-slate-100 px-2 py-0.5">T-ZONE Agent</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">Enter to send</span>
                {voice.supported && <span className="hidden sm:inline rounded bg-slate-100 px-2 py-0.5">Ctrl+M voice</span>}
              </div>
              <div className="flex items-center gap-2">
                <VoiceMicButton
                  supported={voice.supported}
                  isListening={voice.isListening}
                  disabled={streaming}
                  onStart={voice.start}
                  onStop={voice.stop}
                />
                {streaming && activeRun ? (
                  <button
                    type="button"
                    onClick={() => void stopRun(activeRun.key)}
                    disabled={activeRun.stopping}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    {activeRun.stopping ? 'Stopping...' : 'Stop'}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (voice.isListening) voice.stopAndSend();
                      else void sendPrompt(prompt);
                    }}
                    disabled={!prompt.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
