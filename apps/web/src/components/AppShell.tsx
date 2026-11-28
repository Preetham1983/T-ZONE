import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuthStatusResponse,
  LlmSettingsPublic,
  MeetingAgentMission,
  PlannerStats,
  SyncStatusResponse,
} from '@tzone/shared';
import {
  Bot,
  CheckSquare,
  FileAudio,
  Headphones,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { apiFetch } from '../api/client.js';
import { useAppStore, type AppScreen } from '../stores/appStore.js';
import { useChatRunStore } from '../stores/chatRunStore.js';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { activeScreen, setScreen, setCmdkOpen, sidebarCollapsed, toggleSidebar } = useAppStore();
  const activeRunCount = useChatRunStore(
    (s) => Object.values(s.runs).filter((r) => Boolean(r.statusLabel)).length
  );
  const qc = useQueryClient();

  const { data: auth } = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch<AuthStatusResponse>('/api/auth/status'),
    refetchInterval: 30_000,
  });

  const { data: llm } = useQuery({
    queryKey: ['llm-settings'],
    queryFn: () => apiFetch<LlmSettingsPublic>('/api/settings/llm'),
  });

  const { data: sync } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => apiFetch<SyncStatusResponse>('/api/settings/sync-status'),
    refetchInterval: 15_000,
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      apiFetch<SyncStatusResponse>('/api/settings/sync', {
        method: 'POST',
        body: JSON.stringify({ daysBack: 7 }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      qc.invalidateQueries({ queryKey: ['transcripts'] });
      qc.invalidateQueries({ queryKey: ['teams-chats'] });
      qc.invalidateQueries({ queryKey: ['teams-list'] });
    },
  });

  const { data: missions = [] } = useQuery({
    queryKey: ['meeting-missions'],
    queryFn: () => apiFetch<MeetingAgentMission[]>('/api/meeting-agent/missions'),
    refetchInterval: 15_000,
  });

  const activeMissionCount = missions.filter((m) => m.status === 'active').length;

  const { data: plannerStats } = useQuery({
    queryKey: ['tzone-planner-stats'],
    queryFn: () => apiFetch<PlannerStats>('/api/planner/stats'),
    refetchInterval: 15_000,
  });
  const openPlannerCount =
    (plannerStats?.todo ?? 0) + (plannerStats?.inProgress ?? 0) + (plannerStats?.review ?? 0);

  const navItems: Array<{ id: AppScreen; label: string; icon: ReactNode; badge?: string | number }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4 shrink-0" /> },
    {
      id: 'chat',
      label: 'Agent Chat',
      icon: <Bot className="h-4 w-4 shrink-0" />,
      badge: activeRunCount > 0 ? `${activeRunCount} live` : 'AI',
    },
    {
      id: 'planner',
      label: 'Planner & To Do',
      icon: <CheckSquare className="h-4 w-4 shrink-0" />,
      badge: openPlannerCount,
    },
    {
      id: 'meetings',
      label: 'Meeting Agent',
      icon: <Headphones className="h-4 w-4 shrink-0" />,
      badge: activeMissionCount > 0 ? `${activeMissionCount} live` : missions.length,
    },
    {
      id: 'transcripts',
      label: 'Transcript Vault',
      icon: <FileAudio className="h-4 w-4 shrink-0" />,
      badge: sync?.transcriptCount ?? 0,
    },
    {
      id: 'teams',
      label: 'Teams & Channels',
      icon: <MessageSquare className="h-4 w-4 shrink-0" />,
      badge: sync?.chatCount ?? 0,
    },
    { id: 'hub', label: 'M365 Hub & Playbooks', icon: <LayoutGrid className="h-4 w-4 shrink-0" />, badge: 4 },
  ];

  const systemItems: Array<{ id: AppScreen; label: string; icon: ReactNode; badge?: string }> = [
    {
      id: 'auth',
      label: 'Microsoft Sign-In',
      icon: <KeyRound className="h-4 w-4 shrink-0" />,
      badge: auth?.state === 'LOGGED_IN' ? 'OK' : 'LOGIN',
    },
    {
      id: 'settings',
      label: 'LLM & Skill Settings',
      icon: <Settings className="h-4 w-4 shrink-0" />,
      badge: llm?.provider === 'copilot' ? 'COPILOT' : 'DIAL',
    },
  ];

  const isAuthed = auth?.state === 'LOGGED_IN';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100">
      {/* Collapsible Left Rail */}
      <aside
        className={`flex shrink-0 flex-col justify-between border-r border-slate-200 bg-white transition-all duration-200 ${
          sidebarCollapsed ? 'w-16 p-2' : 'w-64 p-3'
        }`}
      >
        <div>
          <div
            className={`flex items-center border-b border-slate-200 pb-3 mb-3 ${
              sidebarCollapsed ? 'flex-col gap-2' : 'justify-between'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-xs font-extrabold text-white shadow-xs">
                TZ
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <div className="text-sm font-bold tracking-tight text-slate-900">T-ZONE</div>
                  <div className="text-[11px] text-slate-500 truncate">Teams &amp; M365 AI Agent</div>
                </div>
              )}
            </div>
            <button
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Hide sidebar'}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          <button
            onClick={() => setCmdkOpen(true)}
            title="Search Teams & VTT (Cmd+K)"
            className={`mb-4 flex w-full items-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500 hover:border-blue-400 hover:text-slate-800 transition ${
              sidebarCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5 shrink-0" />
              {!sidebarCollapsed && <span>Search Teams &amp; VTT...</span>}
            </span>
            {!sidebarCollapsed && (
              <kbd className="rounded border border-slate-300 bg-white px-1 text-[10px] font-mono">⌘K</kbd>
            )}
          </button>

          {!sidebarCollapsed && (
            <div className="mb-1 px-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
              Workspace
            </div>
          )}
          <nav className="space-y-1 mb-4">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setScreen(item.id)}
                title={item.label}
                className={`flex w-full items-center rounded-lg text-xs font-medium transition ${
                  sidebarCollapsed ? 'justify-center p-2.5' : 'justify-between px-2.5 py-2'
                } ${
                  activeScreen === item.id
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-slate-700 hover:bg-slate-100 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {item.icon}
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!sidebarCollapsed && item.badge !== undefined && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {!sidebarCollapsed && (
            <div className="mb-1 px-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
              System
            </div>
          )}
          <nav className="space-y-1">
            {systemItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setScreen(item.id)}
                title={item.label}
                className={`flex w-full items-center rounded-lg text-xs font-medium transition ${
                  sidebarCollapsed ? 'justify-center p-2.5' : 'justify-between px-2.5 py-2'
                } ${
                  activeScreen === item.id
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-slate-700 hover:bg-slate-100 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {item.icon}
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!sidebarCollapsed && item.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold ${
                      item.badge === 'OK'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : item.badge === 'LOGIN'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Footer Status Cards */}
        <div className="space-y-2 border-t border-slate-200 pt-3">
          {sidebarCollapsed ? (
            <>
              <button
                onClick={() => setScreen('auth')}
                title={`MS Graph: ${auth?.username || 'Not signed in'}`}
                className="flex w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-2"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${isAuthed ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              </button>
              <button
                onClick={() => syncMutation.mutate()}
                disabled={!isAuthed || syncMutation.isPending || sync?.isSyncing}
                title="Sync Teams & Transcripts"
                className="flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending || sync?.isSyncing ? 'animate-spin' : ''}`} />
              </button>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px]">
                <div className="flex items-center justify-between font-semibold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${isAuthed ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    MS Graph
                  </span>
                  <span className="font-mono text-[10px] truncate max-w-28 text-slate-600">
                    {auth?.username || 'Not signed in'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                  <span>{auth?.claims?.deviceId ? 'Device Claims ✓' : `PKCE Port ${auth?.callbackPort ?? 8484}`}</span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px]">
                <div className="flex items-center justify-between font-semibold text-slate-800">
                  <span>Active LLM</span>
                  <span className="font-mono text-[10px] uppercase text-blue-700">{llm?.provider || 'dial'}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                  {llm?.provider === 'copilot' ? llm.copilot.model : llm?.dial.chatModelName || '...'}
                </div>
              </div>

              <button
                onClick={() => syncMutation.mutate()}
                disabled={!isAuthed || syncMutation.isPending || sync?.isSyncing}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending || sync?.isSyncing ? 'animate-spin' : ''}`} />
                {syncMutation.isPending || sync?.isSyncing ? 'Syncing Index...' : 'Sync Teams & Transcripts'}
              </button>
              {syncMutation.isError && (
                <p className="text-[10px] text-red-600">{(syncMutation.error as Error).message}</p>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!isAuthed && activeScreen !== 'auth' && activeScreen !== 'settings' && (
          <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900">
            <span>
              <strong>Microsoft 365 not connected yet.</strong> Sign in via the browser PKCE flow so T-ZONE can access Teams chats, channels, and meeting transcripts.
            </span>
            <button
              onClick={() => setScreen('auth')}
              className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700"
            >
              Sign in with Microsoft →
            </button>
          </div>
        )}
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
