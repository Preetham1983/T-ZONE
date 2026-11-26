import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MEETING_ROLE_PRESETS,
  type AgentMessage,
  type GuestBotState,
  type MeetingAgentMission,
  type MeetingAgentRolePreset,
  type TeamsMessageItem,
  type ToolTraceItem,
} from '@tzone/shared';
import {
  Bot,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FileAudio,
  Headphones,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  NotebookPen,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  User,
  UserCheck,
  Users,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch } from '../../api/client.js';
import { VoiceMicButton, VoiceStatusStrip } from '../../components/VoiceRecorderPill.js';
import { useVoiceInput } from '../../hooks/useVoiceInput.js';
import { useAppStore, type MeetingSetupDraft } from '../../stores/appStore.js';
import { useChatRunStore } from '../../stores/chatRunStore.js';

interface CalendarMeetingOption {
  id: string;
  subject: string;
  organizerName: string;
  startDateTime: string;
  endDateTime: string;
  joinUrl: string;
  attendees: Array<{ name: string; email?: string }>;
  isOnlineMeeting: boolean;
}

interface SpeechRecognitionAlt {
  transcript: string;
}
interface SpeechRecognitionRes {
  isFinal: boolean;
  0: SpeechRecognitionAlt;
}
interface SpeechRecognitionEvt {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionRes>;
}
interface BrowserSpeechRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEvt) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type WorkspaceTab = 'ask' | 'bot' | 'notes' | 'chat' | 'context';

function formatShortDateTime(iso?: string): string {
  if (!iso) return 'Ad-hoc';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getPresetById(id: MeetingAgentRolePreset) {
  return MEETING_ROLE_PRESETS.find((p) => p.id === id) || MEETING_ROLE_PRESETS[0];
}

function MissionConfigModal({
  initialDraft,
  editingMission,
  localTz,
  onClose,
  onSaved,
}: {
  initialDraft?: MeetingSetupDraft | null;
  editingMission?: MeetingAgentMission | null;
  localTz: string;
  onClose: () => void;
  onSaved: (mission: MeetingAgentMission) => void;
}) {
  const defaultPreset = getPresetById(editingMission?.rolePreset || 'researcher');

  const [subject, setSubject] = useState(editingMission?.subject || initialDraft?.subject || '');
  const [organizerName, setOrganizerName] = useState(
    editingMission?.organizerName || initialDraft?.organizerName || ''
  );
  const [startDateTime, setStartDateTime] = useState(
    editingMission?.startDateTime || initialDraft?.startDateTime || ''
  );
  const [endDateTime, setEndDateTime] = useState(
    editingMission?.endDateTime || initialDraft?.endDateTime || ''
  );
  const [joinUrl, setJoinUrl] = useState(editingMission?.joinUrl || initialDraft?.joinUrl || '');
  const [botDisplayName, setBotDisplayName] = useState(
    editingMission?.botDisplayName || 'T-ZONE Agent'
  );
  const [attendees, setAttendees] = useState<Array<{ name: string; email?: string }>>(
    editingMission?.attendees || initialDraft?.attendees || []
  );

  const [rolePreset, setRolePreset] = useState<MeetingAgentRolePreset>(
    editingMission?.rolePreset || 'researcher'
  );
  const [roleTitle, setRoleTitle] = useState(editingMission?.roleTitle || defaultPreset.roleTitle);
  const [roleInstructions, setRoleInstructions] = useState(
    editingMission?.roleInstructions || defaultPreset.defaultInstructions
  );
  const [focusTopicsText, setFocusTopicsText] = useState(
    (editingMission?.focusTopics || []).join(', ')
  );
  const [autoNotes, setAutoNotes] = useState(editingMission?.autoNotes ?? true);
  const [autoRespondChat, setAutoRespondChat] = useState(editingMission?.autoRespondChat ?? false);
  const [autoExtractTranscript, setAutoExtractTranscript] = useState(
    editingMission?.autoExtractTranscript ?? true
  );
  const [calFilter, setCalFilter] = useState('');

  const { data: calendarOptions = [], isLoading: calLoading } = useQuery({
    queryKey: ['meeting-agent-calendar', localTz],
    queryFn: () =>
      apiFetch<CalendarMeetingOption[]>(
        `/api/meeting-agent/calendar-options?tz=${encodeURIComponent(localTz)}&days=14&pastDays=2`
      ),
    enabled: !editingMission,
  });

  const filteredCalendar = useMemo(() => {
    const q = calFilter.trim().toLowerCase();
    if (!q) return calendarOptions;
    return calendarOptions.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.organizerName.toLowerCase().includes(q) ||
        c.startDateTime.toLowerCase().includes(q)
    );
  }, [calendarOptions, calFilter]);

  const applyPreset = (id: MeetingAgentRolePreset) => {
    const p = getPresetById(id);
    setRolePreset(id);
    setRoleTitle(p.roleTitle);
    setRoleInstructions(p.defaultInstructions);
  };

  const selectCalendarMeeting = (ev: CalendarMeetingOption) => {
    setSubject(ev.subject);
    setOrganizerName(ev.organizerName);
    setStartDateTime(ev.startDateTime);
    setEndDateTime(ev.endDateTime);
    setJoinUrl(ev.joinUrl);
    setAttendees(ev.attendees);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const focusTopics = focusTopicsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const body = {
        subject,
        organizerName,
        startDateTime,
        endDateTime,
        joinUrl: joinUrl.trim() || undefined,
        botDisplayName: botDisplayName.trim() || 'T-ZONE Agent',
        attendees,
        rolePreset,
        roleTitle,
        roleInstructions,
        focusTopics,
        autoNotes,
        autoRespondChat,
        autoExtractTranscript,
      };
      if (editingMission) {
        return apiFetch<MeetingAgentMission>(`/api/meeting-agent/missions/${editingMission.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      return apiFetch<MeetingAgentMission>('/api/meeting-agent/missions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (saved) => {
      onSaved(saved);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">
              {editingMission ? 'Update Meeting Agent Context' : 'Configure Teams Meeting Agent'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Calendar Picker when creating */}
          {!editingMission && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Calendar className="h-3.5 w-3.5 text-blue-600" />
                  1. Pick a Calendar Meeting (or fill manually below)
                </div>
                <input
                  type="text"
                  value={calFilter}
                  onChange={(e) => setCalFilter(e.target.value)}
                  placeholder="Filter by title, date (26), organizer..."
                  className="w-60 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs outline-none focus:border-blue-400"
                />
              </div>

              {calLoading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Outlook/Teams calendar...
                </div>
              ) : filteredCalendar.length === 0 ? (
                <div className="py-2 text-xs text-slate-500">
                  No matching calendar meetings found. Enter meeting details manually below.
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {filteredCalendar.map((ev) => {
                    const active = subject === ev.subject && startDateTime === ev.startDateTime;
                    return (
                      <button
                        type="button"
                        key={ev.id}
                        onClick={() => selectCalendarMeeting(ev)}
                        className={`text-left rounded-lg border p-2.5 text-xs transition ${
                          active
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300'
                            : 'border-slate-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5 font-mono text-[10px] text-slate-500">
                          <span>{formatShortDateTime(ev.startDateTime)}</span>
                          {ev.isOnlineMeeting && (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 font-semibold">
                              Teams
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-semibold text-slate-900 truncate">{ev.subject}</div>
                        <div className="text-[11px] text-slate-500 truncate">{ev.organizerName}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Meeting Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Meeting Subject *</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g., Ontology Requirement and Architecture Workshop"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Organizer / Host</label>
              <input
                type="text"
                value={organizerName}
                onChange={(e) => setOrganizerName(e.target.value)}
                placeholder="Organizer name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Guest Bot Name <span className="text-slate-400 font-normal">(shown in Teams call roster)</span>
              </label>
              <input
                type="text"
                value={botDisplayName}
                onChange={(e) => setBotDisplayName(e.target.value)}
                placeholder="T-ZONE Agent"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Teams Join URL <span className="text-slate-400 font-normal">(required for Guest Bot &amp; Meeting Chat link)</span>
              </label>
              <input
                type="text"
                value={joinUrl}
                onChange={(e) => setJoinUrl(e.target.value)}
                placeholder="https://teams.microsoft.com/l/meetup-join/..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Agent Role & Context */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-800">2. Assign Agent Role &amp; Context</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MEETING_ROLE_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    rolePreset === p.id
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-semibold">{p.roleTitle}</div>
                  <div className="mt-1 text-[10px] text-slate-500 line-clamp-2">{p.description}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role Name</label>
                <input
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Focus Topics <span className="text-slate-400 font-normal">(comma separated)</span>
                </label>
                <input
                  type="text"
                  value={focusTopicsText}
                  onChange={(e) => setFocusTopicsText(e.target.value)}
                  placeholder="Ontology, Retrieval, Blockers, Owners"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Context &amp; Job Instructions *
              </label>
              <textarea
                rows={4}
                value={roleInstructions}
                onChange={(e) => setRoleInstructions(e.target.value)}
                placeholder="Tell the agent exactly what role to play, what research to perform, and what notes to keep..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
            <div className="font-bold text-slate-800 mb-1">3. Live Capabilities</div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoNotes}
                onChange={(e) => setAutoNotes(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span>
                <strong>Auto-synthesize structured live notes</strong> as spoken audio or pasted captions arrive
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRespondChat}
                onChange={(e) => setAutoRespondChat(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span>
                <strong>Auto-answer Teams Meeting Chat triggers</strong> when someone in the meeting chat types{' '}
                <code className="rounded bg-white px-1 border border-slate-200">@agent</code>,{' '}
                <code className="rounded bg-white px-1 border border-slate-200">@tzone</code>, or{' '}
                <code className="rounded bg-white px-1 border border-slate-200">?research</code> while Teams Chat sync is active
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoExtractTranscript}
                onChange={(e) => setAutoExtractTranscript(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span>
                <strong>Auto-pull official WebVTT transcript</strong> and finalize notes when ending the session
              </span>
            </label>
          </div>

          {saveMutation.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              {saveMutation.error.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!subject.trim() || !roleTitle.trim() || !roleInstructions.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editingMission ? 'Save Changes' : 'Save Meeting Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MeetingAgentScreen() {
  const qc = useQueryClient();
  const {
    selectedMissionId,
    setSelectedMissionId,
    pendingMeetingDraft,
    clearPendingMeetingDraft,
    jumpToTranscript,
    setScreen,
    setActiveConversationId,
  } = useAppStore();
  const { runs, startRun, stopRun } = useChatRunStore();

  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingMission, setEditingMission] = useState<MeetingAgentMission | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'scheduled' | 'completed'>('all');
  const [tab, setTab] = useState<WorkspaceTab>('ask');

  // Q&A composer
  const [askPrompt, setAskPrompt] = useState('');
  const [postedMsgIds, setPostedMsgIds] = useState<Record<string, boolean>>({});
  const askBottomRef = useRef<HTMLDivElement>(null);

  // Manual utterance / caption capture
  const [manualSpeaker, setManualSpeaker] = useState('You');
  const [manualText, setManualText] = useState('');

  // Teams Meeting Chat Bridge
  const [chatAutoSync, setChatAutoSync] = useState(false);
  const [chatDraft, setChatDraft] = useState('');

  // Guest Browser Bot controls
  const [botSpeakDraft, setBotSpeakDraft] = useState('');
  const [botImgTick, setBotImgTick] = useState(Date.now());

  // Call Live Mic Listener (Browser SpeechRecognition -> Meeting Utterances)
  const [callListening, setCallListening] = useState(false);
  const [interimCallText, setInterimCallText] = useState('');
  const [callListenError, setCallListenError] = useState<string | null>(null);
  const callRecRef = useRef<BrowserSpeechRec | null>(null);
  const callActiveRef = useRef(false);
  const selectedMissionIdRef = useRef<string | null>(null);
  const manualSpeakerRef = useRef('You');
  manualSpeakerRef.current = manualSpeaker;

  useEffect(() => {
    if (pendingMeetingDraft) {
      setEditingMission(null);
      setShowConfigModal(true);
    }
  }, [pendingMeetingDraft]);

  const { data: missions = [] } = useQuery({
    queryKey: ['meeting-missions'],
    queryFn: () => apiFetch<MeetingAgentMission[]>('/api/meeting-agent/missions'),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (!selectedMissionId && missions.length > 0) {
      setSelectedMissionId(missions[0].id);
    }
  }, [missions, selectedMissionId, setSelectedMissionId]);

  const activeMission = useMemo(
    () => missions.find((m) => m.id === selectedMissionId) || null,
    [missions, selectedMissionId]
  );
  selectedMissionIdRef.current = activeMission?.id || null;

  const { data: convData } = useQuery({
    queryKey: ['conversation', activeMission?.conversationId],
    queryFn: () =>
      apiFetch<{ id: string; messages: AgentMessage[] }>(
        `/api/conversations/${activeMission?.conversationId}`
      ),
    enabled: Boolean(activeMission?.conversationId),
  });

  const activeRun = activeMission?.conversationId ? runs[activeMission.conversationId] : undefined;
  const streaming = Boolean(activeRun && activeRun.statusLabel !== '');

  const invalidateMissions = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['meeting-missions'] });
  }, [qc]);

  const { data: botState, refetch: refetchBotState } = useQuery({
    queryKey: ['meeting-bot-state', activeMission?.id],
    queryFn: () =>
      apiFetch<GuestBotState>(`/api/meeting-agent/missions/${activeMission?.id}/bot/state`),
    enabled: Boolean(activeMission?.id),
    refetchInterval: (q) => {
      const ph = q.state.data?.phase;
      return ph && ph !== 'idle' && ph !== 'ended' && ph !== 'error' && ph !== 'blocked_auth'
        ? 2500
        : false;
    },
  });

  useEffect(() => {
    if (botState?.hasScreenshot) {
      setBotImgTick(Date.now());
    }
  }, [botState?.lastUpdatedAt, botState?.hasScreenshot]);

  useEffect(() => {
    if (activeMission?.conversationId && (botState?.spokenCount ?? 0) > 0) {
      void qc.invalidateQueries({ queryKey: ['conversation', activeMission.conversationId] });
      invalidateMissions();
    }
  }, [botState?.spokenCount, activeMission?.conversationId, invalidateMissions, qc]);

  const botJoinMutation = useMutation({
    mutationFn: ({ id, botName }: { id: string; botName?: string }) =>
      apiFetch<GuestBotState>(`/api/meeting-agent/missions/${id}/bot/join`, {
        method: 'POST',
        body: JSON.stringify({ botName }),
      }),
    onSuccess: (st) => {
      qc.setQueryData(['meeting-bot-state', st.missionId], st);
      setTab('bot');
      invalidateMissions();
    },
  });

  const botLeaveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<GuestBotState>(`/api/meeting-agent/missions/${id}/bot/leave`, { method: 'POST' }),
    onSuccess: (st) => {
      qc.setQueryData(['meeting-bot-state', st.missionId], st);
    },
  });

  const botSpeakMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiFetch<GuestBotState>(`/api/meeting-agent/missions/${id}/bot/speak`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: (st) => {
      setBotSpeakDraft('');
      qc.setQueryData(['meeting-bot-state', st.missionId], st);
      invalidateMissions();
    },
  });

  const botMuteMutation = useMutation({
    mutationFn: ({ id, muted }: { id: string; muted: boolean }) =>
      apiFetch<GuestBotState>(`/api/meeting-agent/missions/${id}/bot/mute`, {
        method: 'POST',
        body: JSON.stringify({ muted }),
      }),
    onSuccess: (st) => {
      qc.setQueryData(['meeting-bot-state', st.missionId], st);
    },
  });

  const botAutoReplyMutation = useMutation({
    mutationFn: ({
      id,
      enabled,
      voiceMode,
    }: {
      id: string;
      enabled?: boolean;
      voiceMode?: 'conversational' | 'wake_word';
    }) =>
      apiFetch<GuestBotState>(`/api/meeting-agent/missions/${id}/bot/auto-reply`, {
        method: 'POST',
        body: JSON.stringify({ enabled, voiceMode }),
      }),
    onSuccess: (st) => {
      qc.setQueryData(['meeting-bot-state', st.missionId], st);
    },
  });

  const joinMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<MeetingAgentMission>(`/api/meeting-agent/missions/${id}/join`, { method: 'POST' }),
    onSuccess: (m) => {
      invalidateMissions();
      setSelectedMissionId(m.id);
      if (m.conversationId) {
        void qc.invalidateQueries({ queryKey: ['conversation', m.conversationId] });
      }
    },
  });

  const endMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<MeetingAgentMission>(`/api/meeting-agent/missions/${id}/end`, { method: 'POST' }),
    onSuccess: () => {
      stopCallListener();
      invalidateMissions();
      void qc.invalidateQueries({ queryKey: ['transcripts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/meeting-agent/missions/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, deletedId) => {
      if (selectedMissionId === deletedId) setSelectedMissionId(null);
      invalidateMissions();
    },
  });

  const prepMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<MeetingAgentMission>(`/api/meeting-agent/missions/${id}/prep`, { method: 'POST' }),
    onSuccess: invalidateMissions,
  });

  const synthNotesMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<MeetingAgentMission>(`/api/meeting-agent/missions/${id}/synthesize-notes`, {
        method: 'POST',
      }),
    onSuccess: invalidateMissions,
  });

  const addUtteranceMutation = useMutation({
    mutationFn: ({
      id,
      speaker,
      text,
      source,
      refreshNotes,
    }: {
      id: string;
      speaker: string;
      text: string;
      source: 'mic' | 'manual';
      refreshNotes?: boolean;
    }) =>
      apiFetch<MeetingAgentMission>(`/api/meeting-agent/missions/${id}/utterances`, {
        method: 'POST',
        body: JSON.stringify({ speaker, text, source, refreshNotes }),
      }),
    onSuccess: invalidateMissions,
  });

  const {
    data: chatData,
    isFetching: chatLoading,
    refetch: refetchChat,
  } = useQuery({
    queryKey: ['meeting-chat', activeMission?.id],
    queryFn: () =>
      apiFetch<{ meetingChatId?: string; messages: TeamsMessageItem[] }>(
        `/api/meeting-agent/missions/${activeMission?.id}/chat`
      ),
    enabled: Boolean(activeMission?.id && (tab === 'chat' || chatAutoSync)),
  });

  const pollChatMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ meetingChatId?: string; messages: TeamsMessageItem[]; autoRepliedCount: number }>(
        `/api/meeting-agent/missions/${id}/chat/poll`,
        { method: 'POST' }
      ),
    onSuccess: (res) => {
      qc.setQueryData(['meeting-chat', activeMission?.id], {
        meetingChatId: res.meetingChatId,
        messages: res.messages,
      });
      if (res.autoRepliedCount > 0 && activeMission?.conversationId) {
        void qc.invalidateQueries({ queryKey: ['conversation', activeMission.conversationId] });
      }
    },
  });

  const sendChatMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiFetch(`/api/meeting-agent/missions/${id}/chat/send`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      setChatDraft('');
      void refetchChat();
    },
  });

  useEffect(() => {
    if (!chatAutoSync || !activeMission?.id || activeMission.status !== 'active') return;
    const timer = window.setInterval(() => {
      pollChatMutation.mutate(activeMission.id);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [chatAutoSync, activeMission?.id, activeMission?.status]);

  // Continuous Call Listener using Web Speech API
  const stopCallListener = useCallback(() => {
    callActiveRef.current = false;
    setCallListening(false);
    setInterimCallText('');
    const rec = callRecRef.current;
    callRecRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // ignore stop error
      }
    }
  }, []);

  const startCallListener = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRec;
      webkitSpeechRecognition?: new () => BrowserSpeechRec;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setCallListenError('Live browser speech listener requires Chrome or Microsoft Edge.');
      return;
    }
    if (callActiveRef.current) return;

    setCallListenError(null);
    callActiveRef.current = true;
    setCallListening(true);

    const launch = () => {
      if (!callActiveRef.current) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';

      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const item = ev.results[i];
          const t = (item[0]?.transcript || '').trim();
          if (!t) continue;
          if (item.isFinal) {
            const targetId = selectedMissionIdRef.current;
            if (targetId) {
              addUtteranceMutation.mutate({
                id: targetId,
                speaker: manualSpeakerRef.current.trim() || 'Speaker',
                text: t,
                source: 'mic',
              });
            }
          } else {
            interim += `${t} `;
          }
        }
        setInterimCallText(interim.trim());
      };

      rec.onerror = (ev) => {
        if (ev.error === 'no-speech') return;
        setCallListenError(
          ev.error === 'not-allowed'
            ? 'Microphone permission denied — allow mic access for localhost:3100.'
            : `Speech listener error: ${ev.error}`
        );
        stopCallListener();
      };

      rec.onend = () => {
        if (!callActiveRef.current) return;
        launch();
      };

      callRecRef.current = rec;
      try {
        rec.start();
      } catch (err) {
        setCallListenError((err as Error).message);
        stopCallListener();
      }
    };

    launch();
  }, [addUtteranceMutation, stopCallListener]);

  useEffect(() => {
    return () => stopCallListener();
  }, [stopCallListener]);

  const sendAskPrompt = (text: string) => {
    const clean = text.trim();
    if (!clean || !activeMission || streaming) return;
    setAskPrompt('');
    void startRun(activeMission.conversationId || null, clean, qc, {
      endpoint: `/api/meeting-agent/missions/${activeMission.id}/ask/stream`,
      updateActiveConv: false,
    });
  };

  const voiceAsk = useVoiceInput({
    currentText: askPrompt,
    onTextChange: setAskPrompt,
    onSubmitText: (spoken) => sendAskPrompt(spoken),
  });

  const handleStartAskMic = () => {
    if (callListening) stopCallListener();
    voiceAsk.start();
  };

  useEffect(() => {
    askBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [convData?.messages.length, activeRun?.content, activeRun?.traces.length]);

  const visibleMissions = useMemo(
    () =>
      statusFilter === 'all' ? missions : missions.filter((m) => m.status === statusFilter),
    [missions, statusFilter]
  );

  const askMessages = convData?.messages || [];

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] overflow-hidden bg-slate-50">
      {/* Left: Configured Missions */}
      <aside className="flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 bg-white p-3.5 overflow-hidden">
        <button
          onClick={() => {
            setEditingMission(null);
            setShowConfigModal(true);
          }}
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 shadow-2xs transition"
        >
          <Plus className="h-4 w-4" /> Configure Meeting Agent
        </button>

        <div className="mb-2.5 flex flex-wrap gap-1">
          {(['all', 'active', 'scheduled', 'completed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-2 py-1 text-[10px] font-mono uppercase transition ${
                statusFilter === s
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
          {visibleMissions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
              No meeting agents configured yet. Click <strong>Configure Meeting Agent</strong> above to assign one to an upcoming call!
            </div>
          ) : (
            visibleMissions.map((m) => {
              const selected = activeMission?.id === m.id;
              const statusBadge =
                m.status === 'active'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : m.status === 'scheduled'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-slate-100 text-slate-600';
              return (
                <div
                  key={m.id}
                  onClick={() => setSelectedMissionId(m.id)}
                  className={`group cursor-pointer rounded-xl border p-3 transition ${
                    selected
                      ? 'border-blue-400 bg-blue-50/70 shadow-2xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase ${statusBadge}`}>
                      {m.status === 'active' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                      )}
                      {m.status === 'active' ? 'LIVE' : m.status}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(m.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600"
                      title="Delete mission"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-1.5 text-xs font-bold text-slate-900 line-clamp-2">{m.subject}</div>
                  <div className="mt-1 text-[11px] font-mono text-slate-500 truncate">
                    {formatShortDateTime(m.startDateTime)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                      {m.roleTitle}
                    </span>
                    {m.meetingChatId && (
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-mono text-indigo-700">
                        Chat ✓
                      </span>
                    )}
                    {m.utterances.length > 0 && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-mono text-amber-700">
                        {m.utterances.length} notes
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Workspace */}
      <section className="flex min-w-0 flex-col overflow-hidden bg-white">
        {!activeMission ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-lg text-center space-y-4">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-600">
                <Headphones className="h-7 w-7" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">T-ZONE Meeting Agent</h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Assign a configurable AI Researcher, Architect, or Note-Taker to any calendar meeting.
                When the call starts, activate your Meeting Copilot to listen, capture notes, answer your
                live questions across Teams &amp; SharePoint, post updates to the Teams meeting chat, and
                pull the final WebVTT transcript when finished.
              </p>
              <button
                onClick={() => {
                  setEditingMission(null);
                  setShowConfigModal(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs"
              >
                <Plus className="h-4 w-4" /> Assign Agent to a Meeting
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Mission Top Header */}
            <header className="border-b border-slate-200 bg-white px-5 py-3.5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-semibold uppercase ${
                        activeMission.status === 'active'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : activeMission.status === 'scheduled'
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-slate-100 text-slate-700'
                      }`}
                    >
                      {activeMission.status === 'active' && (
                        <Radio className="h-3 w-3 animate-pulse" />
                      )}
                      {activeMission.status === 'active' ? 'Live Copilot Active' : activeMission.status}
                    </span>
                    <span className="rounded-md bg-violet-50 border border-violet-200 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                      {activeMission.roleTitle}
                    </span>
                    {activeMission.meetingChatId && (
                      <span className="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-mono text-indigo-700">
                        Meeting Chat Linked ✓
                      </span>
                    )}
                  </div>
                  <h1 className="text-base font-bold text-slate-900 truncate">{activeMission.subject}</h1>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono">
                    <span>{formatShortDateTime(activeMission.startDateTime)}</span>
                    {activeMission.organizerName && <span>Host: {activeMission.organizerName}</span>}
                    {activeMission.attendees.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" /> {activeMission.attendees.length} attendees
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMission(activeMission);
                      setShowConfigModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Settings2 className="h-3.5 w-3.5" /> Edit Role &amp; Context
                  </button>

                  {activeMission.joinUrl && (
                    <a
                      href={activeMission.joinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      <Video className="h-3.5 w-3.5" /> Open Teams Call <ExternalLink className="h-3 w-3" />
                    </a>
                  )}

                  {activeMission.joinUrl &&
                    (!botState ||
                    botState.phase === 'idle' ||
                    botState.phase === 'ended' ||
                    botState.phase === 'error' ||
                    botState.phase === 'blocked_auth' ? (
                      <button
                        type="button"
                        onClick={() =>
                          botJoinMutation.mutate({
                            id: activeMission.id,
                            botName: activeMission.botDisplayName || 'T-ZONE Agent',
                          })
                        }
                        disabled={botJoinMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 shadow-2xs"
                        title={`Join Teams Web as unverified guest "${activeMission.botDisplayName || 'T-ZONE Agent'}"`}
                      >
                        {botJoinMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5" />
                        )}
                        Join Call as Guest Bot
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => botLeaveMutation.mutate(activeMission.id)}
                        disabled={botLeaveMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        <Square className="h-3 w-3 fill-current" /> Leave Bot
                      </button>
                    ))}

                  {activeMission.status !== 'active' ? (
                    <button
                      type="button"
                      onClick={() => joinMutation.mutate(activeMission.id)}
                      disabled={joinMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-2xs"
                    >
                      {joinMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {activeMission.status === 'completed' ? 'Resume Copilot' : 'Start Copilot Only'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={callListening ? stopCallListener : startCallListener}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                          callListening
                            ? 'border-rose-300 bg-rose-600 text-white hover:bg-rose-700'
                            : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                        }`}
                        title="Continuously listen via browser mic & capture timestamped call utterances"
                      >
                        {callListening ? (
                          <>
                            <MicOff className="h-3.5 w-3.5" /> Stop Mic
                          </>
                        ) : (
                          <>
                            <Mic className="h-3.5 w-3.5" /> Listen (My Mic)
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => endMutation.mutate(activeMission.id)}
                        disabled={endMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {endMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3 fill-current" />
                        )}
                        End Call &amp; Pull Transcript
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Workspace Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                  {(
                    [
                      { id: 'ask', label: 'Ask Agent Live', icon: Bot },
                      {
                        id: 'bot',
                        label:
                          botState && botState.phase !== 'idle' && botState.phase !== 'ended'
                            ? `Guest Bot (${botState.phase.replace(/_/g, ' ')})`
                            : 'Guest Bot View',
                        icon: Eye,
                      },
                      { id: 'notes', label: `Live Notes & Log (${activeMission.utterances.length})`, icon: NotebookPen },
                      { id: 'chat', label: 'Teams Chat Bridge', icon: MessageSquare },
                      { id: 'context', label: 'Role & Config', icon: Settings2 },
                    ] as const
                  ).map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                          tab === t.id
                            ? 'bg-white text-blue-700 shadow-2xs border border-slate-200'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {activeMission.linkedTranscriptId && (
                  <button
                    type="button"
                    onClick={() => jumpToTranscript(activeMission.linkedTranscriptId!, null)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    <FileAudio className="h-3.5 w-3.5" /> Open Official VTT Transcript →
                  </button>
                )}
              </div>

              {botState && botState.phase !== 'idle' && botState.phase !== 'ended' && (
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                    botState.phase === 'blocked_auth' || botState.phase === 'error'
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : botState.phase === 'waiting_in_lobby'
                        ? 'border-blue-200 bg-blue-50 text-blue-900'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        botState.phase === 'blocked_auth' || botState.phase === 'error'
                          ? 'bg-amber-500'
                          : 'bg-emerald-500 animate-ping'
                      }`}
                    />
                    <span className="truncate font-medium">{botState.statusMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('bot')}
                    className="shrink-0 font-semibold underline hover:no-underline"
                  >
                    View Bot Screen →
                  </button>
                </div>
              )}

              {botJoinMutation.isError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  {botJoinMutation.error.message}
                </div>
              )}

              {callListenError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  {callListenError}
                </div>
              )}

              {callListening && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full bg-rose-600 animate-ping shrink-0" />
                    <span className="font-semibold text-rose-700 shrink-0">Listening to call mic:</span>
                    <span className="truncate italic text-slate-700">
                      {interimCallText || 'Speak naturally — finalized phrases are logged automatically...'}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-rose-700">Speaker: {manualSpeaker}</span>
                </div>
              )}
            </header>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {tab === 'ask' && (
                <div className="flex flex-1 min-h-0 flex-col">
                  <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-4 space-y-4">
                    {/* Pre-Call Briefing Card */}
                    {activeMission.prepBrief && (
                      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 text-xs space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-bold text-indigo-800">
                            <Sparkles className="h-3.5 w-3.5" /> Pre-Call Context &amp; Research Brief
                          </span>
                          <button
                            type="button"
                            onClick={() => prepMutation.mutate(activeMission.id)}
                            disabled={prepMutation.isPending}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                          >
                            <RefreshCw className={`h-3 w-3 ${prepMutation.isPending ? 'animate-spin' : ''}`} />
                            Refresh Brief
                          </button>
                        </div>
                        <div className="markdown-body text-slate-800">
                          <Markdown remarkPlugins={[remarkGfm]}>{activeMission.prepBrief}</Markdown>
                        </div>
                      </div>
                    )}

                    {askMessages.length === 0 && !streaming && (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5 space-y-3">
                        <div className="text-xs font-semibold text-slate-800">
                          Ask your {activeMission.roleTitle} anything during the call:
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {[
                            `Research recent Teams chats & SharePoint context related to "${activeMission.subject}"`,
                            'Summarize decisions, blockers, and open questions captured so far',
                            'Suggest 3 smart follow-up questions I can ask right now on the call',
                          ].map((q) => (
                            <button
                              key={q}
                              onClick={() => sendAskPrompt(q)}
                              className="rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 hover:border-blue-400 hover:bg-blue-50/40 transition"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {askMessages.map((m) =>
                      m.role === 'user' ? (
                        <div key={m.id} className="flex items-start justify-end gap-3">
                          <div className="max-w-[80%] min-w-0 rounded-2xl border border-blue-200 bg-blue-50/75 px-4 py-3 text-sm text-slate-900 [overflow-wrap:anywhere]">
                            <div className="mb-1 text-[11px] font-semibold text-blue-700">You</div>
                            <div className="markdown-body">{m.content}</div>
                          </div>
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-white text-blue-600">
                            <User className="h-4 w-4" />
                          </div>
                        </div>
                      ) : (
                        <div key={m.id} className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600">
                            <Bot className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 shadow-2xs [overflow-wrap:anywhere]">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                                <Sparkles className="h-3.5 w-3.5" /> {activeMission.roleTitle}
                              </span>
                              {m.providerLabel && (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-500">
                                  {m.providerLabel}
                                </span>
                              )}
                            </div>
                            <div className="markdown-body">
                              <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void navigator.clipboard.writeText(m.content)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                                >
                                  <Copy className="h-3 w-3" /> Copy
                                </button>
                                {activeMission.meetingChatId && (
                                  <button
                                    type="button"
                                    disabled={sendChatMutation.isPending || postedMsgIds[m.id]}
                                    onClick={() =>
                                      sendChatMutation.mutate(
                                        {
                                          id: activeMission.id,
                                          text: `**[T-ZONE · ${activeMission.roleTitle}]**\n\n${m.content}`,
                                        },
                                        {
                                          onSuccess: () =>
                                            setPostedMsgIds((prev) => ({ ...prev, [m.id]: true })),
                                        }
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                                  >
                                    {postedMsgIds[m.id] ? (
                                      <>
                                        <Check className="h-3 w-3 text-emerald-600" /> Posted to Teams Chat
                                      </>
                                    ) : (
                                      <>
                                        <Send className="h-3 w-3" /> Post to Teams Meeting Chat
                                      </>
                                    )}
                                  </button>
                                )}
                                {(botState?.phase === 'in_meeting' ||
                                  botState?.phase === 'captions_active') &&
                                  botState.audioReady && (
                                    <button
                                      type="button"
                                      disabled={botSpeakMutation.isPending}
                                      onClick={() =>
                                        botSpeakMutation.mutate({
                                          id: activeMission.id,
                                          text: m.content.replace(/[#*_`>]/g, ' ').slice(0, 600),
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60"
                                      title="Unmute Guest Bot and speak this answer aloud into Teams call"
                                    >
                                      <Volume2 className="h-3 w-3" /> Speak Aloud in Call
                                    </button>
                                  )}
                              </div>
                              {activeMission.conversationId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveConversationId(activeMission.conversationId!);
                                    setScreen('chat');
                                  }}
                                  className="text-[11px] text-blue-600 hover:underline"
                                >
                                  Open in Agent Chat →
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    )}

                    {activeRun && (
                      <>
                        {!(activeRun.userMsgId && askMessages.some((m) => m.id === activeRun.userMsgId)) && (
                          <div className="flex items-start justify-end gap-3">
                            <div className="max-w-[80%] rounded-2xl border border-blue-200 bg-blue-50/75 px-4 py-3 text-sm text-slate-900">
                              <div className="mb-1 text-[11px] font-semibold text-blue-700">You</div>
                              {activeRun.userMsg}
                            </div>
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-white text-blue-600">
                              <User className="h-4 w-4" />
                            </div>
                          </div>
                        )}
                        {activeRun.statusLabel && (
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-300 bg-blue-50 text-blue-600 ring-2 ring-blue-100">
                              <Bot className="h-4 w-4 animate-pulse" />
                            </div>
                            <div className="flex-1 min-w-0 rounded-2xl border border-blue-200 bg-white px-4 py-3.5 text-sm shadow-xs">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-blue-700">{activeMission.roleTitle}</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] text-blue-600 animate-pulse">
                                    {activeRun.statusLabel}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void stopRun(activeRun.key)}
                                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700"
                                  >
                                    <Square className="h-2.5 w-2.5 fill-current" /> Stop
                                  </button>
                                </div>
                              </div>
                              {activeRun.traces.length > 0 && (
                                <div className="mb-2 space-y-1">
                                  {activeRun.traces.map((t: ToolTraceItem) => (
                                    <div key={t.id} className="text-[11px] font-mono text-slate-500">
                                      ● {t.toolName} ({t.status})
                                    </div>
                                  ))}
                                </div>
                              )}
                              {activeRun.content && (
                                <div className="markdown-body">
                                  <Markdown remarkPlugins={[remarkGfm]}>{activeRun.content}</Markdown>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    <div ref={askBottomRef} />
                  </div>

                  {/* Ask Composer with Voice */}
                  <div className="border-t border-slate-200 bg-slate-50 px-5 sm:px-8 py-3">
                    <div
                      className={`rounded-xl border bg-white p-2.5 shadow-2xs transition ${
                        voiceAsk.isListening ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-300'
                      }`}
                    >
                      <VoiceStatusStrip
                        isListening={voiceAsk.isListening}
                        elapsedSeconds={voiceAsk.elapsedSeconds}
                        levels={voiceAsk.levels}
                        error={voiceAsk.error}
                        onStop={voiceAsk.stop}
                        onStopAndSend={voiceAsk.stopAndSend}
                        onCancel={voiceAsk.cancel}
                        onClearError={voiceAsk.clearError}
                      />
                      <textarea
                        rows={2}
                        value={askPrompt}
                        onChange={(e) => setAskPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (voiceAsk.isListening) voiceAsk.stopAndSend();
                            else sendAskPrompt(askPrompt);
                          }
                        }}
                        placeholder={`Ask ${activeMission.roleTitle} anything about this meeting, Teams docs, or prior calls...`}
                        className="w-full resize-none text-sm outline-none"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-slate-400">
                          Context attached: Role + {activeMission.utterances.length} utterances + Notes + FTS5/Graph
                        </span>
                        <div className="flex items-center gap-2">
                          <VoiceMicButton
                            supported={voiceAsk.supported}
                            isListening={voiceAsk.isListening}
                            disabled={streaming}
                            onStart={handleStartAskMic}
                            onStop={voiceAsk.stop}
                          />
                          {streaming && activeRun ? (
                            <button
                              type="button"
                              onClick={() => void stopRun(activeRun.key)}
                              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                            >
                              <Square className="h-3 w-3 fill-current" /> Stop
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={!askPrompt.trim()}
                              onClick={() =>
                                voiceAsk.isListening ? voiceAsk.stopAndSend() : sendAskPrompt(askPrompt)
                              }
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Send className="h-3.5 w-3.5" /> Ask Agent
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'bot' && (
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">
                            Teams Guest Browser Bot ({activeMission.botDisplayName || 'T-ZONE Agent'})
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-mono font-semibold uppercase text-slate-700">
                            {botState?.phase?.replace(/_/g, ' ') || 'idle'}
                          </span>
                          {botState?.captionsEnabled && (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-700">
                              Live Captions ON ✓
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-600">
                          {botState?.statusMessage || 'Ready to join the Teams Web call as an unverified guest.'}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void refetchBotState();
                            setBotImgTick(Date.now());
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Refresh View
                        </button>

                        {(botState?.phase === 'in_meeting' || botState?.phase === 'captions_active') && (
                          <>
                            <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={botState.autoVoiceReply ?? true}
                                onChange={(e) =>
                                  botAutoReplyMutation.mutate({
                                    id: activeMission.id,
                                    enabled: e.target.checked,
                                  })
                                }
                              />
                              Auto-Speak
                            </label>
                            <select
                              value={botState.voiceMode || 'conversational'}
                              onChange={(e) =>
                                botAutoReplyMutation.mutate({
                                  id: activeMission.id,
                                  voiceMode: e.target.value as 'conversational' | 'wake_word',
                                })
                              }
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-500"
                              title="Choose when the bot automatically speaks back in Teams"
                            >
                              <option value="conversational">Direct Questions (Natural)</option>
                              <option value="wake_word">Wake-Word Only (&ldquo;Hey T-ZONE&rdquo;)</option>
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                botMuteMutation.mutate({
                                  id: activeMission.id,
                                  muted: !botState.micMuted,
                                })
                              }
                              disabled={botMuteMutation.isPending}
                              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                                botState.micMuted
                                  ? 'border-slate-300 bg-white text-slate-700'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {botState.micMuted ? (
                                <>
                                  <VolumeX className="h-3.5 w-3.5" /> Bot Muted
                                </>
                              ) : (
                                <>
                                  <Volume2 className="h-3.5 w-3.5" /> Bot Unmuted
                                </>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[10px] font-mono text-slate-400">CAPTIONS CAPTURED</div>
                        <div className="font-bold text-slate-900">{botState?.captionsCapturedCount ?? 0}</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[10px] font-mono text-slate-400">SPOKEN REPLIES</div>
                        <div className="font-bold text-slate-900">{botState?.spokenCount ?? 0}</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[10px] font-mono text-slate-400">VOICE ENGINE</div>
                        <div className="font-bold text-slate-900">
                          {botState?.ttsEngine === 'piper_neural'
                            ? 'Piper Neural Voice ✓'
                            : botState?.audioReady
                              ? 'Virtual Mic Ready'
                              : 'Host Dev Mode'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[10px] font-mono text-slate-400">PARTICIPANT NAME</div>
                        <div className="font-bold text-slate-900 truncate">
                          {activeMission.botDisplayName || 'T-ZONE Agent'} (Guest)
                        </div>
                      </div>
                    </div>

                    {/* Speak in Call form */}
                    {(botState?.phase === 'in_meeting' || botState?.phase === 'captions_active') && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!botSpeakDraft.trim()) return;
                          botSpeakMutation.mutate({ id: activeMission.id, text: botSpeakDraft.trim() });
                        }}
                        className="flex flex-wrap gap-2 pt-1"
                      >
                        <input
                          type="text"
                          value={botSpeakDraft}
                          onChange={(e) => setBotSpeakDraft(e.target.value)}
                          placeholder="Type what the T-ZONE Agent should speak aloud in the Teams call..."
                          className="flex-1 min-w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-violet-500"
                        />
                        <button
                          type="submit"
                          disabled={!botSpeakDraft.trim() || botSpeakMutation.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                          {botSpeakMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Volume2 className="h-3.5 w-3.5" />
                          )}
                          Speak Aloud in Call
                        </button>
                      </form>
                    )}

                    {botSpeakMutation.isError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                        {botSpeakMutation.error.message}
                      </div>
                    )}
                  </div>

                  {/* Live Browser Viewport Screenshot */}
                  {botState?.hasScreenshot &&
                  botState.phase !== 'idle' &&
                  botState.phase !== 'ended' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">Live Teams Browser Viewport</span>
                        <span className="font-mono text-[10px]">
                          Updated {formatShortDateTime(botState.lastUpdatedAt)}
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-900 shadow-xs">
                        <img
                          src={`/api/meeting-agent/missions/${activeMission.id}/bot/screenshot?t=${botImgTick}`}
                          alt="Live Teams Guest Bot viewport"
                          className="w-full max-h-[520px] object-contain mx-auto"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-3">
                      <UserCheck className="mx-auto h-8 w-8 text-violet-600" />
                      <div className="text-sm font-bold text-slate-900">
                        Send &ldquo;{activeMission.botDisplayName || 'T-ZONE Agent'}&rdquo; Into the Teams Call
                      </div>
                      <p className="mx-auto max-w-xl text-xs text-slate-600 leading-relaxed">
                        Clicking <strong>Join Call as Guest Bot</strong> launches a real browser session in
                        T-ZONE, opens the Teams meeting link, enters your configured Bot Name, and waits
                        in the lobby. Once admitted by the host, everyone in the meeting sees the agent in
                        Participants, Teams Live Captions feed notes straight into T-ZONE, and the agent can
                        unmute its virtual mic to speak.
                      </p>
                      <p className="mx-auto max-w-xl text-[11px] text-slate-500">
                        Note: If your organization&rsquo;s Teams meeting blocks anonymous/unverified guests from
                        entering the lobby, this screen will show the sign-in screen and you can continue
                        using Copilot + Teams Chat Bridge seamlessly.
                      </p>
                      {activeMission.joinUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            botJoinMutation.mutate({
                              id: activeMission.id,
                              botName: activeMission.botDisplayName || 'T-ZONE Agent',
                            })
                          }
                          disabled={botJoinMutation.isPending}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                          <UserCheck className="h-4 w-4" /> Join Call as Guest Bot Now
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tab === 'notes' && (
                <div className="grid flex-1 min-h-0 grid-cols-1 xl:grid-cols-[1fr_1.15fr] overflow-hidden">
                  {/* Left: Utterance / Caption Feed */}
                  <div className="flex flex-col border-b xl:border-b-0 xl:border-r border-slate-200 p-4 overflow-hidden">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">Live Spoken / Caption Feed</div>
                        <div className="text-[11px] text-slate-500">
                          Mic capture logs your speech automatically; paste Teams live captions below anytime.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={callListening ? stopCallListener : startCallListener}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium border ${
                          callListening
                            ? 'border-rose-300 bg-rose-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {callListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                        {callListening ? 'Stop Mic' : 'Start Mic'}
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      {activeMission.utterances.length === 0 ? (
                        <div className="py-10 text-center text-xs text-slate-400">
                          No utterances captured yet. Turn on <strong>Listen Live (Mic)</strong> or log a note/caption below.
                        </div>
                      ) : (
                        activeMission.utterances.map((u) => (
                          <div key={u.id} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <strong className="text-slate-900">{u.speaker}</strong>
                              <span className="font-mono text-[10px] text-slate-400">
                                {u.timestamp} · {u.source.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-slate-700 [overflow-wrap:anywhere]">{u.text}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Quick Utterance Capture Bar */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!manualText.trim()) return;
                        addUtteranceMutation.mutate(
                          {
                            id: activeMission.id,
                            speaker: manualSpeaker.trim() || 'Speaker',
                            text: manualText.trim(),
                            source: 'manual',
                          },
                          { onSuccess: () => setManualText('') }
                        );
                      }}
                      className="mt-3 flex flex-wrap gap-2"
                    >
                      <input
                        type="text"
                        value={manualSpeaker}
                        onChange={(e) => setManualSpeaker(e.target.value)}
                        placeholder="Speaker"
                        className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
                      />
                      <input
                        type="text"
                        value={manualText}
                        onChange={(e) => setManualText(e.target.value)}
                        placeholder="Log key point or paste Teams live caption..."
                        className="flex-1 min-w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-blue-500"
                      />
                      <button
                        type="submit"
                        disabled={!manualText.trim() || addUtteranceMutation.isPending}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </form>
                  </div>

                  {/* Right: AI Structured Notes */}
                  <div className="flex flex-col p-4 overflow-hidden">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-slate-900">Structured Notes &amp; Action Items</div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => synthNotesMutation.mutate(activeMission.id)}
                          disabled={synthNotesMutation.isPending}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3 w-3 ${synthNotesMutation.isPending ? 'animate-spin' : ''}`} />
                          Synthesize Notes
                        </button>
                        {activeMission.liveNotes && (
                          <>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard.writeText(activeMission.liveNotes)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                            >
                              <Copy className="h-3 w-3" /> Copy
                            </button>
                            {activeMission.meetingChatId && (
                              <button
                                type="button"
                                disabled={sendChatMutation.isPending}
                                onClick={() =>
                                  sendChatMutation.mutate({
                                    id: activeMission.id,
                                    text: `**[T-ZONE Meeting Notes · ${activeMission.roleTitle}]**\n\n${activeMission.liveNotes}`,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                              >
                                <Send className="h-3 w-3" /> Post Notes to Teams Chat
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
                      {activeMission.liveNotes ? (
                        <div className="markdown-body text-sm">
                          <Markdown remarkPlugins={[remarkGfm]}>{activeMission.liveNotes}</Markdown>
                        </div>
                      ) : (
                        <div className="py-10 text-center text-xs text-slate-400">
                          Click <strong>Synthesize Notes</strong> after capturing utterances or after the official transcript arrives.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'chat' && (
                <div className="flex flex-1 min-h-0 flex-col p-5 space-y-3 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-900">Teams Meeting Chat Bridge</div>
                      <div className="text-[11px] text-slate-500">
                        {chatData?.meetingChatId
                          ? 'Connected to the Teams meeting chat thread. Post notes directly or enable auto-reply to @agent / ?research.'
                          : 'No Teams meeting chat thread matched yet (ensure meeting Join URL is set and Teams call chat has initialized).'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chatAutoSync}
                          onChange={(e) => setChatAutoSync(e.target.checked)}
                        />
                        Auto-sync chat (10s)
                      </label>
                      <button
                        type="button"
                        onClick={() => pollChatMutation.mutate(activeMission.id)}
                        disabled={chatLoading || pollChatMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${chatLoading || pollChatMutation.isPending ? 'animate-spin' : ''}`}
                        />
                        Sync Now
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    {(chatData?.messages || []).length === 0 ? (
                      <div className="py-10 text-center text-xs text-slate-400">
                        No messages loaded from Teams meeting chat yet.
                      </div>
                    ) : (
                      (chatData?.messages || []).map((msg) => (
                        <div key={msg.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-slate-900">{msg.senderName}</strong>
                            <span className="font-mono text-[10px] text-slate-400">
                              {formatShortDateTime(msg.createdDateTime)}
                            </span>
                          </div>
                          <p className="text-slate-700 whitespace-pre-wrap [overflow-wrap:anywhere]">
                            {msg.bodyText}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!chatDraft.trim()) return;
                      sendChatMutation.mutate({ id: activeMission.id, text: chatDraft.trim() });
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={chatDraft}
                      onChange={(e) => setChatDraft(e.target.value)}
                      placeholder="Send message to this meeting's Teams chat thread..."
                      className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-xs outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={!chatDraft.trim() || sendChatMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" /> Send to Chat
                    </button>
                  </form>
                </div>
              )}

              {tab === 'context' && (
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 text-xs">
                      <div className="font-bold text-slate-900">Agent Role &amp; Prompt Context</div>
                      <div>
                        <span className="text-slate-500">Role Title:</span>{' '}
                        <strong className="text-slate-900">{activeMission.roleTitle}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Focus Topics:</span>{' '}
                        <span className="text-slate-800">
                          {activeMission.focusTopics.join(', ') || 'None specified'}
                        </span>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700 whitespace-pre-wrap">
                        {activeMission.roleInstructions}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                        <span className="rounded bg-slate-100 px-2 py-0.5">
                          Auto Notes: {activeMission.autoNotes ? 'ON' : 'OFF'}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-0.5">
                          Chat @agent Auto-Reply: {activeMission.autoRespondChat ? 'ON' : 'OFF'}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-0.5">
                          Auto Pull VTT: {activeMission.autoExtractTranscript ? 'ON' : 'OFF'}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 text-xs">
                      <div className="font-bold text-slate-900">How Joining &amp; Voice Work</div>
                      <p className="text-slate-600 leading-relaxed">
                        With delegated user Graph permissions (<code>OnlineMeetings.Read</code>,{' '}
                        <code>Chat.ReadWrite</code>, <code>OnlineMeetingTranscript.Read.All</code>),
                        T-ZONE links directly to your Teams meeting chat, transcribes your live mic
                        input via Chrome/Edge Web Speech API, researches your live questions across Teams
                        &amp; SharePoint, posts answers into the meeting chat, and pulls the official
                        speaker WebVTT once the call finishes.
                      </p>
                      <p className="text-slate-500 leading-relaxed">
                        Autonomous audio-only bot dial-in (speaking with synthetic voice as a headless
                        participant) requires M365 Tenant Admin approval for Application Permissions{' '}
                        <code>Calls.JoinGroupCall.All</code> &amp; <code>Calls.AccessMedia.All</code>.
                      </p>
                      {activeMission.attendees.length > 0 && (
                        <div>
                          <div className="font-semibold text-slate-800 mb-1">
                            Meeting Attendees ({activeMission.attendees.length})
                          </div>
                          <div className="max-h-36 overflow-y-auto space-y-1">
                            {activeMission.attendees.map((a, idx) => (
                              <div key={idx} className="text-slate-600">
                                • {a.name} {a.email ? `<${a.email}>` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {showConfigModal && (
        <MissionConfigModal
          initialDraft={editingMission ? null : pendingMeetingDraft}
          editingMission={editingMission}
          localTz={localTz}
          onClose={() => {
            setShowConfigModal(false);
            setEditingMission(null);
            clearPendingMeetingDraft();
          }}
          onSaved={(saved) => {
            setShowConfigModal(false);
            setEditingMission(null);
            clearPendingMeetingDraft();
            invalidateMissions();
            setSelectedMissionId(saved.id);
          }}
        />
      )}
    </div>
  );
}
