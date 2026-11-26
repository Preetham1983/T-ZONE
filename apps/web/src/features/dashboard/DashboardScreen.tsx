import { useQuery } from '@tanstack/react-query';
import type { AgentConversation, PlaybookDefinition, SyncStatusResponse, TeamsChatSummary } from '@tzone/shared';
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  FileAudio,
  Mail,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Video,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { VoiceMicButton, VoiceStatusStrip } from '../../components/VoiceRecorderPill.js';
import { useVoiceInput } from '../../hooks/useVoiceInput.js';
import { useAppStore } from '../../stores/appStore.js';

interface DashboardResponse {
  authState: 'NOT_LOGGED_IN' | 'TOKEN_EXPIRED' | 'LOGGED_IN';
  displayName: string | null;
  sync: SyncStatusResponse;
  recentConversations: AgentConversation[];
  recentTranscripts: Array<{
    id: string;
    subject: string;
    organizerName: string;
    startDateTime: string;
    segmentCount: number;
    speakerStats: Array<{ speaker: string; sharePercent: number }>;
    insightsStatus: string;
    actionItemCount: number;
  }>;
  recentChats: TeamsChatSummary[];
  upcomingMeetings: Array<{
    id: string;
    subject?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    isCancelled?: boolean;
    isOnlineMeeting?: boolean;
    onlineMeeting?: { joinUrl?: string };
    organizer?: { emailAddress?: { name?: string } };
  }>;
  unreadEmails: Array<{
    id: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    receivedDateTime?: string;
    bodyPreview?: string;
  }>;
  openTasks: Array<{
    id: string;
    title?: string;
    dueDateTime?: string;
    percentComplete?: number;
  }>;
}

function formatMeetingTime(iso?: string): string {
  if (!iso) return '--:--';
  const [hStr, mStr] = iso.slice(11, 16).split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${mStr} ${suffix}`;
}

export function DashboardScreen() {
  const {
    setScreen,
    setActiveConversationId,
    jumpToTranscript,
    jumpToChat,
    jumpToHub,
    launchPromptInChat,
  } = useAppStore();

  const [quickPrompt, setQuickPrompt] = useState('');
  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['dashboard', localTz],
    queryFn: () => apiFetch<DashboardResponse>(`/api/dashboard?tz=${encodeURIComponent(localTz)}`),
    refetchInterval: 60_000,
  });

  const { data: playbooks = [] } = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => apiFetch<PlaybookDefinition[]>('/api/playbooks'),
  });

  const activeMeetings = (data?.upcomingMeetings || []).filter(
    (m) => !m.isCancelled && !(m.subject || '').toLowerCase().startsWith('canceled:')
  );
  const nextMeeting = activeMeetings[0] || null;

  const submitQuickAsk = (overrideText?: string) => {
    const clean = (overrideText ?? quickPrompt).trim();
    if (!clean) return;
    setQuickPrompt('');
    launchPromptInChat(clean);
  };

  const voice = useVoiceInput({
    currentText: quickPrompt,
    onTextChange: setQuickPrompt,
    onSubmitText: (spoken) => submitQuickAsk(spoken),
  });

  const quickFocusChips = [
    'Catch me up on today: unread Teams, upcoming calls, and urgent emails',
    'Extract all transcripts from the last 7 days and list my action items',
    'Check my recent Teams chats for any questions waiting on my reply',
    'Summarize the latest meeting transcript with key decisions and blockers',
  ];

  const firstName = data?.displayName ? data.displayName.split(' ')[0] : '';

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-5 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Hero Command Strip */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {firstName ? `Welcome back, ${firstName}` : 'T-ZONE Command Dashboard'}
                </h1>
                <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-blue-700">
                  T-ZONE
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Unified pulse across your Teams chats, meeting transcripts, Outlook inbox, calendar, and tasks.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data?.sync.lastSyncedAt && (
                <span className="text-[11px] font-mono text-slate-400">
                  Synced {new Date(data.sync.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Quick Ask Box */}
          <div>
            <VoiceStatusStrip
              isListening={voice.isListening}
              elapsedSeconds={voice.elapsedSeconds}
              levels={voice.levels}
              error={voice.error}
              onStop={voice.stop}
              onStopAndSend={voice.stopAndSend}
              onCancel={voice.cancel}
              onClearError={voice.clearError}
            />
            <div
              className={`rounded-xl border p-2 flex items-center gap-2 transition ${
                voice.isListening
                  ? 'border-rose-300 bg-white ring-2 ring-rose-100'
                  : 'border-slate-300 bg-slate-50/70 focus-within:border-blue-500 focus-within:bg-white'
              }`}
            >
              <Sparkles className="h-4 w-4 text-blue-600 ml-2 shrink-0" />
              <input
                value={quickPrompt}
                onChange={(e) => setQuickPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (voice.isListening) voice.stopAndSend();
                    else submitQuickAsk();
                  } else if (e.key === 'Escape' && voice.isListening) {
                    e.preventDefault();
                    voice.cancel();
                  }
                }}
                placeholder={
                  voice.isListening
                    ? 'Listening... speak naturally, press Enter to ask or Stop to edit'
                    : 'Ask T-ZONE anything across Teams, meeting transcripts, emails, or tasks...'
                }
                className="flex-1 bg-transparent text-sm outline-none py-1.5"
              />
              <VoiceMicButton
                supported={voice.supported}
                isListening={voice.isListening}
                onStart={voice.start}
                onStop={voice.stop}
              />
              <button
                onClick={() => {
                  if (voice.isListening) voice.stopAndSend();
                  else submitQuickAsk();
                }}
                disabled={!quickPrompt.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" /> Ask Agent
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {quickFocusChips.map((chip) => (
              <button
                key={chip}
                onClick={() => launchPromptInChat(chip)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-700 hover:border-blue-300 hover:bg-blue-50 transition"
              >
                {chip}
              </button>
            ))}
          </div>
        </section>

        {/* 4 KPI Summary Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          <button
            onClick={() => setScreen('transcripts')}
            className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-blue-300 transition group"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Transcript Vault</span>
              <FileAudio className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">
              {data?.sync.transcriptCount ?? 0}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>{data?.sync.segmentCount ?? 0} speaker lines indexed</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600" />
            </div>
          </button>

          <button
            onClick={() => setScreen('teams')}
            className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-blue-300 transition group"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Teams &amp; Channels</span>
              <MessageSquare className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">
              {data?.sync.chatCount ?? 0}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>{data?.sync.channelMessageCount ?? 0} channel posts synced</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600" />
            </div>
          </button>

          <button
            onClick={() => jumpToHub('calendar')}
            className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-blue-300 transition group"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Upcoming Meetings</span>
              <Calendar className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{activeMeetings.length}</div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span className="truncate">
                {nextMeeting ? `Next: ${formatMeetingTime(nextMeeting.start?.dateTime)}` : 'Calendar clear'}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
            </div>
          </button>

          <button
            onClick={() => jumpToHub('mail')}
            className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-blue-300 transition group"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Unread &amp; Open Tasks</span>
              <Mail className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">
              {(data?.unreadEmails.length ?? 0) + (data?.openTasks.length ?? 0)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                {data?.unreadEmails.length ?? 0} unread mail · {data?.openTasks.length ?? 0} tasks
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600" />
            </div>
          </button>
        </section>

        {/* Main 2-Column Operational Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left 7 Cols: Recent Transcripts + Teams Chats */}
          <div className="lg:col-span-7 space-y-5 min-w-0">
            {/* Recent Meeting Transcripts */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileAudio className="h-4 w-4 text-blue-600" />
                  <h2 className="text-sm font-bold text-slate-900">Recent Meeting Transcripts</h2>
                </div>
                <button
                  onClick={() => setScreen('transcripts')}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  Open Vault →
                </button>
              </div>

              {(data?.recentTranscripts.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
                  No transcripts extracted yet. Open <strong>Transcript Vault</strong> to extract your calls.
                </div>
              ) : (
                <div className="space-y-2">
                  {data?.recentTranscripts.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3 hover:border-slate-300"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs text-slate-900 truncate">{t.subject}</div>
                        <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                          {t.startDateTime.slice(0, 16).replace('T', ' ')} · {t.speakerStats.length} speakers ·{' '}
                          {t.segmentCount} lines
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => jumpToTranscript(t.id)}
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Read VTT
                        </button>
                        <button
                          onClick={() =>
                            launchPromptInChat(
                              `Analyze the full transcript of "${t.subject}" from ${t.startDateTime.slice(0, 10)} and summarize decisions, blockers, and action items.`
                            )
                          }
                          className="rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Summarize
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Teams Chats */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">Recent Teams Conversations</h2>
                </div>
                <button
                  onClick={() => setScreen('teams')}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  Open Teams →
                </button>
              </div>

              {(data?.recentChats.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
                  Sync Teams or open <strong>Teams &amp; Channels</strong> to view recent conversations.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data?.recentChats.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => jumpToChat(c.id)}
                      className="text-left rounded-xl border border-slate-200 p-3 hover:border-blue-300 hover:bg-blue-50/30 transition min-w-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-xs text-slate-900 truncate">{c.displayTitle}</strong>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 shrink-0">
                          {c.chatType === 'oneOnOne' ? '1:1' : c.chatType}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500 line-clamp-1">
                        {c.lastMessagePreview?.bodyText || 'Open chat'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right 5 Cols: Schedule + Unread/Tasks + Agent Sessions */}
          <div className="lg:col-span-5 space-y-5 min-w-0">
            {/* Schedule Snapshot */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-emerald-600" />
                  <h2 className="text-sm font-bold text-slate-900">Upcoming Schedule</h2>
                </div>
                <button
                  onClick={() => jumpToHub('calendar')}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  Full Calendar →
                </button>
              </div>

              {activeMeetings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                  No upcoming meetings in the next 5 days.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeMeetings.slice(0, 4).map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-xl border border-slate-200 border-l-4 border-l-blue-600 p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                          <Clock className="h-3 w-3" />
                          <span>
                            {(ev.start?.dateTime || '').slice(5, 10)} · {formatMeetingTime(ev.start?.dateTime)}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-slate-900 truncate mt-0.5">
                          {ev.subject || '(no title)'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {ev.onlineMeeting?.joinUrl && (
                          <a
                            href={ev.onlineMeeting.joinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                          >
                            <Video className="h-3 w-3" /> Join
                          </a>
                        )}
                        <button
                          onClick={() =>
                            launchPromptInChat(
                              `Prepare me for "${ev.subject}" with ${ev.organizer?.emailAddress?.name || 'the team'}.`
                            )
                          }
                          className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Prep
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Unread Mail & Planner Tasks */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-amber-600" />
                  <h2 className="text-sm font-bold text-slate-900">Inbox &amp; Open Tasks</h2>
                </div>
                <button
                  onClick={() => jumpToHub('tasks')}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  View All →
                </button>
              </div>

              <div className="space-y-1.5">
                {(data?.unreadEmails || []).slice(0, 3).map((em) => (
                  <button
                    key={em.id}
                    onClick={() => jumpToHub('mail')}
                    className="w-full text-left rounded-lg border border-slate-200 p-2 text-xs hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900 truncate">
                      <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0" />
                      <span className="truncate">{em.subject || '(no subject)'}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate pl-3.5">
                      {em.from?.emailAddress?.name || em.from?.emailAddress?.address}
                    </div>
                  </button>
                ))}
                {(data?.openTasks || []).slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => jumpToHub('tasks')}
                    className="w-full text-left rounded-lg border border-slate-200 p-2 text-xs flex items-center justify-between gap-2 hover:bg-slate-50"
                  >
                    <span className="truncate text-slate-800">☐ {t.title}</span>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">{t.percentComplete ?? 0}%</span>
                  </button>
                ))}
                {(data?.unreadEmails.length ?? 0) === 0 && (data?.openTasks.length ?? 0) === 0 && (
                  <div className="text-xs text-slate-500 py-2">All caught up on unread emails and open tasks.</div>
                )}
              </div>
            </div>

            {/* Recent Agent Sessions */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-blue-600" />
                  <h2 className="text-sm font-bold text-slate-900">Recent Agent Sessions</h2>
                </div>
                <button
                  onClick={() => setScreen('chat')}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  Open Chat →
                </button>
              </div>
              <div className="space-y-1.5">
                {(data?.recentConversations || []).slice(0, 4).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setActiveConversationId(c.id);
                      setScreen('chat');
                    }}
                    className="w-full text-left rounded-lg border border-slate-200 px-3 py-2 text-xs flex items-center justify-between gap-2 hover:border-blue-300 hover:bg-blue-50/30"
                  >
                    <span className="truncate font-medium text-slate-800">{c.title}</span>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      {c.isRunning ? 'running' : new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Bottom Playbooks Strip */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2.5">
          <div className="text-xs font-bold text-slate-900">1-Click Agent Playbooks</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {playbooks.map((pb) => (
              <button
                key={pb.id}
                onClick={() => launchPromptInChat(pb.defaultPrompt)}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:border-blue-400 hover:bg-blue-50/40 transition"
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-mono font-semibold text-blue-700">{pb.badge}</div>
                  <div className="text-xs font-bold text-slate-900 truncate">{pb.title}</div>
                </div>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-white">
                  <Play className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
