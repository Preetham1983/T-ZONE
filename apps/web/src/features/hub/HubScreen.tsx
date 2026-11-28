import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaybookDefinition } from '@tzone/shared';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  Mail,
  NotebookPen,
  Paperclip,
  Play,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAppStore, type HubTab } from '../../stores/appStore.js';
import { CalendarView } from './CalendarView.js';

type MailFolder = 'inbox' | 'sentitems' | 'drafts';

export function HubScreen() {
  const qc = useQueryClient();
  const { launchPromptInChat, hubTab: tab, setHubTab: setTab } = useAppStore();
  const [showPlaybooks, setShowPlaybooks] = useState(true);

  // Mail state
  const [mailFolder, setMailFolder] = useState<MailFolder>('inbox');
  const [mailUnreadOnly, setMailUnreadOnly] = useState(false);
  const [mailSearch, setMailSearch] = useState('');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftTo, setDraftTo] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');

  // Tasks state
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDueDate, setTodoDueDate] = useState('');
  const [newListName, setNewListName] = useState('');
  const [showNewList, setShowNewList] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [plannerTitle, setPlannerTitle] = useState('');
  const [plannerBucketId, setPlannerBucketId] = useState('');
  const [plannerDueDate, setPlannerDueDate] = useState('');
  const [taskFeedback, setTaskFeedback] = useState<string | null>(null);

  // Files state
  const [selectedSite, setSelectedSite] = useState<{ id: string; displayName: string } | null>(null);
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null);
  const [oneDrivePath, setOneDrivePath] = useState<string>('');

  // OneNote state
  const [selectedNotebook, setSelectedNotebook] = useState<{ id: string; displayName: string } | null>(null);
  const [selectedSection, setSelectedSection] = useState<{ id: string; displayName: string } | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  const { data: playbooks = [] } = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => apiFetch<PlaybookDefinition[]>('/api/playbooks'),
  });

  const { data: emails = [], isFetching: loadingEmails } = useQuery({
    queryKey: ['m365-emails', mailFolder, mailUnreadOnly, mailSearch],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '25', folder: mailFolder });
      if (mailUnreadOnly && mailFolder === 'inbox') qs.set('unread', 'true');
      if (mailSearch.trim()) qs.set('search', mailSearch.trim());
      return apiFetch<Array<Record<string, any>>>(`/api/m365/emails?${qs.toString()}`);
    },
    enabled: tab === 'mail',
  });

  const { data: activeEmail } = useQuery({
    queryKey: ['m365-email-detail', selectedEmailId],
    queryFn: () => apiFetch<Record<string, any>>(`/api/m365/emails/${encodeURIComponent(selectedEmailId!)}`),
    enabled: tab === 'mail' && Boolean(selectedEmailId),
  });

  const createDraft = useMutation({
    mutationFn: () =>
      apiFetch('/api/m365/emails/draft', {
        method: 'POST',
        body: JSON.stringify({
          to: draftTo.split(',').map((s) => s.trim()).filter(Boolean),
          subject: draftSubject,
          body: draftBody,
        }),
      }),
    onSuccess: () => {
      setShowDraftModal(false);
      setDraftTo('');
      setDraftSubject('');
      setDraftBody('');
      qc.invalidateQueries({ queryKey: ['m365-emails'] });
    },
  });

  const { data: planner } = useQuery({
    queryKey: ['m365-planner'],
    queryFn: () => apiFetch<{ plans: any[]; myTasks: any[] }>('/api/m365/planner'),
    enabled: tab === 'tasks',
  });

  const activePlanId = selectedPlanId || planner?.plans?.[0]?.id || '';
  const { data: planDetail } = useQuery({
    queryKey: ['m365-planner-plan', activePlanId],
    queryFn: () => apiFetch<{ buckets: any[]; tasks: any[] }>(`/api/m365/planner/${encodeURIComponent(activePlanId)}`),
    enabled: tab === 'tasks' && Boolean(activePlanId),
  });

  const createPlannerTaskMut = useMutation({
    mutationFn: () =>
      apiFetch('/api/m365/planner/tasks', {
        method: 'POST',
        body: JSON.stringify({
          planId: activePlanId,
          title: plannerTitle.trim(),
          bucketId: plannerBucketId || undefined,
          dueDate: plannerDueDate || undefined,
        }),
      }),
    onSuccess: () => {
      setPlannerTitle('');
      setPlannerDueDate('');
      setTaskFeedback('Planner task created.');
      qc.invalidateQueries({ queryKey: ['m365-planner'] });
      qc.invalidateQueries({ queryKey: ['m365-planner-plan', activePlanId] });
    },
    onError: (e) => setTaskFeedback((e as Error).message),
  });

  const updatePlannerTaskMut = useMutation({
    mutationFn: ({ taskId, percentComplete }: { taskId: string; percentComplete: number }) =>
      apiFetch(`/api/m365/planner/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ percentComplete }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['m365-planner'] });
      qc.invalidateQueries({ queryKey: ['m365-planner-plan', activePlanId] });
    },
    onError: (e) => setTaskFeedback((e as Error).message),
  });

  const deletePlannerTaskMut = useMutation({
    mutationFn: (taskId: string) =>
      apiFetch(`/api/m365/planner/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['m365-planner'] });
      qc.invalidateQueries({ queryKey: ['m365-planner-plan', activePlanId] });
    },
    onError: (e) => setTaskFeedback((e as Error).message),
  });

  const { data: todoLists = [] } = useQuery({
    queryKey: ['m365-todo-lists'],
    queryFn: () => apiFetch<Array<{ id: string; displayName: string }>>('/api/m365/todo'),
    enabled: tab === 'tasks',
  });

  const activeListId = selectedListId || todoLists[0]?.id || '';
  const { data: todoTasks = [] } = useQuery({
    queryKey: ['m365-todo-tasks', activeListId],
    queryFn: () => apiFetch<Array<Record<string, any>>>(`/api/m365/todo/${encodeURIComponent(activeListId)}/tasks`),
    enabled: tab === 'tasks' && Boolean(activeListId),
  });

  const createTodoListMut = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; displayName: string }>('/api/m365/todo/lists', {
        method: 'POST',
        body: JSON.stringify({ displayName: newListName.trim() }),
      }),
    onSuccess: (created) => {
      setNewListName('');
      setShowNewList(false);
      setSelectedListId(created.id);
      qc.invalidateQueries({ queryKey: ['m365-todo-lists'] });
    },
    onError: (e) => setTaskFeedback((e as Error).message),
  });

  const createTodo = useMutation({
    mutationFn: () =>
      apiFetch('/api/m365/todo/tasks', {
        method: 'POST',
        body: JSON.stringify({
          listId: activeListId,
          title: todoTitle.trim(),
          dueDate: todoDueDate || undefined,
        }),
      }),
    onSuccess: () => {
      setTodoTitle('');
      setTodoDueDate('');
      qc.invalidateQueries({ queryKey: ['m365-todo-tasks', activeListId] });
    },
    onError: (e) => setTaskFeedback((e as Error).message),
  });

  const toggleTodoStatus = useMutation({
    mutationFn: ({ taskId, completed }: { taskId: string; completed: boolean }) =>
      apiFetch(`/api/m365/todo/${encodeURIComponent(activeListId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: completed ? 'completed' : 'notStarted' }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['m365-todo-tasks', activeListId] }),
    onError: (e) => setTaskFeedback((e as Error).message),
  });

  const deleteTodoMut = useMutation({
    mutationFn: (taskId: string) =>
      apiFetch(`/api/m365/todo/${encodeURIComponent(activeListId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['m365-todo-tasks', activeListId] }),
    onError: (e) => setTaskFeedback((e as Error).message),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['m365-sharepoint'],
    queryFn: () => apiFetch<Array<Record<string, any>>>('/api/m365/sharepoint'),
    enabled: tab === 'files',
  });

  const { data: siteDrives = [] } = useQuery({
    queryKey: ['m365-site-drives', selectedSite?.id],
    queryFn: () => apiFetch<Array<Record<string, any>>>(`/api/m365/sharepoint/${encodeURIComponent(selectedSite!.id)}/drives`),
    enabled: tab === 'files' && Boolean(selectedSite?.id),
  });

  const { data: driveItems = [] } = useQuery({
    queryKey: ['m365-drive-items', selectedDriveId],
    queryFn: () => apiFetch<Array<Record<string, any>>>(`/api/m365/drives/${encodeURIComponent(selectedDriveId!)}/items`),
    enabled: tab === 'files' && Boolean(selectedDriveId),
  });

  const { data: onedrive = [] } = useQuery({
    queryKey: ['m365-onedrive', oneDrivePath],
    queryFn: () =>
      apiFetch<Array<Record<string, any>>>(
        `/api/m365/onedrive${oneDrivePath ? `?path=${encodeURIComponent(oneDrivePath)}` : ''}`
      ),
    enabled: tab === 'files',
  });

  const { data: notebooks = [] } = useQuery({
    queryKey: ['m365-onenote'],
    queryFn: () => apiFetch<Array<Record<string, any>>>('/api/m365/onenote'),
    enabled: tab === 'onenote',
  });

  const { data: sections = [] } = useQuery({
    queryKey: ['m365-onenote-sections', selectedNotebook?.id],
    queryFn: () =>
      apiFetch<Array<Record<string, any>>>(
        `/api/m365/onenote/notebooks/${encodeURIComponent(selectedNotebook!.id)}/sections`
      ),
    enabled: tab === 'onenote' && Boolean(selectedNotebook?.id),
  });

  const { data: pages = [] } = useQuery({
    queryKey: ['m365-onenote-pages', selectedSection?.id],
    queryFn: () =>
      apiFetch<Array<Record<string, any>>>(
        `/api/m365/onenote/sections/${encodeURIComponent(selectedSection!.id)}/pages`
      ),
    enabled: tab === 'onenote' && Boolean(selectedSection?.id),
  });

  const { data: activePage } = useQuery({
    queryKey: ['m365-onenote-page', selectedPageId],
    queryFn: () => apiFetch<{ id: string; contentText: string }>(`/api/m365/onenote/pages/${encodeURIComponent(selectedPageId!)}`),
    enabled: tab === 'onenote' && Boolean(selectedPageId),
  });

  const { data: org } = useQuery({
    queryKey: ['m365-org'],
    queryFn: () => apiFetch<{ manager: any; directReports: any[]; people: any[] }>('/api/m365/org'),
    enabled: tab === 'org',
  });

  const tabs: Array<{ id: HubTab; label: string; icon: any }> = [
    { id: 'mail', label: 'Outlook Mail', icon: Mail },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'tasks', label: 'Planner & To Do', icon: CheckCircle2 },
    { id: 'files', label: 'SharePoint & OneDrive', icon: Folder },
    { id: 'onenote', label: 'OneNote', icon: NotebookPen },
    { id: 'org', label: 'Org & People', icon: Users },
  ];

  const getSenderLabel = (e: Record<string, any>) => {
    if (mailFolder === 'drafts') return 'Draft';
    return e.from?.emailAddress?.name || e.from?.emailAddress?.address || 'Microsoft 365';
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* Compact Playbooks Bar */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <h1 className="text-sm font-bold text-slate-900">Agent Playbooks</h1>
            <span className="hidden sm:inline text-xs text-slate-500">
              1-click workflows across Teams, Transcripts &amp; M365
            </span>
          </div>
          <button
            onClick={() => setShowPlaybooks(!showPlaybooks)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            {showPlaybooks ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showPlaybooks ? 'Minimize' : 'Show Playbooks'}
          </button>
        </div>

        {showPlaybooks && (
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {playbooks.map((pb) => (
              <button
                key={pb.id}
                onClick={() => launchPromptInChat(pb.defaultPrompt)}
                title={pb.description}
                className="group flex items-center justify-between gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-left transition hover:border-blue-400 hover:bg-blue-50/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-blue-100/80 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-blue-700">
                      {pb.badge}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs font-bold text-slate-900 group-hover:text-blue-700">
                    {pb.title}
                  </div>
                </div>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-white group-hover:bg-blue-700">
                  <Play className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* M365 Workspace Tabs + Full-Height Content */}
      <div className="flex flex-1 flex-col overflow-hidden p-4 sm:p-5">
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2 shrink-0">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
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

          <div className="flex-1 overflow-y-auto p-4 text-xs">
            {tab === 'mail' && (
              <div className="space-y-3">
                {/* Mail Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                      {([
                        ['inbox', 'Inbox'],
                        ['sentitems', 'Sent'],
                        ['drafts', 'Drafts'],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => {
                            setMailFolder(id);
                            setSelectedEmailId(null);
                          }}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                            mailFolder === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="relative w-56 sm:w-64">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        value={mailSearch}
                        onChange={(e) => setMailSearch(e.target.value)}
                        placeholder="Search emails..."
                        className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs"
                      />
                    </div>

                    {mailFolder === 'inbox' && (
                      <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mailUnreadOnly}
                          onChange={(e) => setMailUnreadOnly(e.target.checked)}
                        />
                        Unread
                      </label>
                    )}
                  </div>

                  <button
                    onClick={() => setShowDraftModal(true)}
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Draft
                  </button>
                </div>

                {/* Split Mail View */}
                <div className={`grid gap-4 ${selectedEmailId ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]' : 'grid-cols-1'}`}>
                  <div className="space-y-2 min-w-0">
                    {loadingEmails && <div className="text-slate-500 py-2">Loading emails...</div>}
                    {!loadingEmails && emails.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                        No emails found in this folder.
                      </div>
                    )}
                    {emails.map((e) => {
                      const isUnread = e.isRead === false && mailFolder === 'inbox';
                      return (
                        <div
                          key={e.id}
                          onClick={() => setSelectedEmailId(e.id)}
                          className={`cursor-pointer rounded-xl border border-l-4 p-3 transition flex items-start justify-between gap-3 ${
                            isUnread ? 'border-l-blue-600 bg-blue-50/20' : 'border-l-slate-200 bg-white'
                          } ${
                            selectedEmailId === e.id
                              ? 'ring-2 ring-blue-500 border-blue-300'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`truncate text-xs ${isUnread ? 'font-bold text-slate-950' : 'font-semibold text-slate-800'}`}>
                                {e.subject || '(no subject)'}
                              </span>
                              {e.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="truncate font-medium text-slate-700">{getSenderLabel(e)}</span>
                              <span>·</span>
                              <span className="font-mono shrink-0">
                                {(e.receivedDateTime || '').slice(0, 16).replace('T', ' ')}
                              </span>
                            </div>
                            <p className="mt-1 text-slate-600 line-clamp-1">{e.bodyPreview}</p>
                          </div>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              launchPromptInChat(
                                `Read Outlook email "${e.subject || '(no subject)'}" from ${getSenderLabel(e)} and summarize key points or help draft a reply.`
                              );
                            }}
                            className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Ask Agent
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {selectedEmailId && activeEmail && (
                    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 h-fit sticky top-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 break-words">
                            {activeEmail.subject || '(no subject)'}
                          </h3>
                          <div className="text-[11px] text-slate-600 mt-0.5 break-all">
                            {activeEmail.from?.emailAddress?.address
                              ? `${activeEmail.from.emailAddress.name || ''} <${activeEmail.from.emailAddress.address}>`
                              : 'Draft / System Message'}
                          </div>
                        </div>
                        <button onClick={() => setSelectedEmailId(null)} className="text-slate-400 hover:text-slate-700">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs whitespace-pre-wrap max-h-[28rem] overflow-y-auto [overflow-wrap:anywhere] leading-relaxed">
                        {activeEmail.bodyText || '(empty body)'}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            setDraftTo(activeEmail.from?.emailAddress?.address || '');
                            setDraftSubject(`Re: ${activeEmail.subject || ''}`);
                            setDraftBody('');
                            setShowDraftModal(true);
                          }}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
                        >
                          Reply Draft
                        </button>
                        <button
                          onClick={() =>
                            launchPromptInChat(
                              `Summarize Outlook email "${activeEmail.subject}" from ${activeEmail.from?.emailAddress?.name || 'sender'} and extract any action items for me.`
                            )
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Extract Tasks with AI
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'calendar' && <CalendarView />}

            {tab === 'tasks' && (
              <div className="space-y-3">
                {taskFeedback && (
                  <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    <span>{taskFeedback}</span>
                    <button onClick={() => setTaskFeedback(null)} className="underline ml-2">Dismiss</button>
                  </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Microsoft Planner */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-900">
                        Microsoft Planner ({(activePlanId ? planDetail?.tasks : planner?.myTasks)?.length || 0})
                      </h3>
                      {(planner?.plans || []).length > 0 && (
                        <select
                          value={activePlanId}
                          onChange={(e) => {
                            setSelectedPlanId(e.target.value);
                            setPlannerBucketId('');
                          }}
                          className="rounded border border-slate-300 px-2 py-1 text-xs max-w-[200px]"
                        >
                          {(planner?.plans || []).map((p: any) => (
                            <option key={p.id} value={p.id}>{p.title || p.id}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {activePlanId ? (
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={plannerTitle}
                          onChange={(e) => setPlannerTitle(e.target.value)}
                          placeholder="Add Planner task..."
                          className="flex-1 min-w-[140px] rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                        />
                        {(planDetail?.buckets || []).length > 0 && (
                          <select
                            value={plannerBucketId}
                            onChange={(e) => setPlannerBucketId(e.target.value)}
                            className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                          >
                            <option value="">Default bucket</option>
                            {(planDetail?.buckets || []).map((b: any) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        )}
                        <input
                          type="date"
                          value={plannerDueDate}
                          onChange={(e) => setPlannerDueDate(e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                        />
                        <button
                          onClick={() => createPlannerTaskMut.mutate()}
                          disabled={!plannerTitle.trim() || createPlannerTaskMut.isPending}
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {createPlannerTaskMut.isPending ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                        No Planner plans found in your M365 groups yet. Assigned Planner tasks appear below, or use Microsoft To Do on the right.
                      </div>
                    )}

                    {(activePlanId ? planDetail?.tasks || [] : planner?.myTasks || []).map((t: any) => (
                      <div key={t.id} className="rounded-lg border border-slate-200 p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className={t.percentComplete === 100 ? 'line-through text-slate-400 truncate' : 'truncate font-medium text-slate-800'}>
                            {t.title}
                          </div>
                          {t.dueDateTime && (
                            <div className="text-[10px] text-slate-400">Due {String(t.dueDateTime).slice(0, 10)}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-mono text-[11px] text-slate-500">{t.percentComplete ?? 0}%</span>
                          {t.percentComplete !== 100 ? (
                            <button
                              onClick={() => updatePlannerTaskMut.mutate({ taskId: t.id, percentComplete: 100 })}
                              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                            >
                              Done
                            </button>
                          ) : (
                            <button
                              onClick={() => updatePlannerTaskMut.mutate({ taskId: t.id, percentComplete: 0 })}
                              className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                            >
                              Reopen
                            </button>
                          )}
                          <button
                            onClick={() => deletePlannerTaskMut.mutate(t.id)}
                            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-600"
                            title="Delete task"
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Microsoft To Do */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-900">Microsoft To Do ({todoTasks.length})</h3>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={activeListId}
                          onChange={(e) => setSelectedListId(e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          {todoLists.map((l) => (
                            <option key={l.id} value={l.id}>{l.displayName}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => setShowNewList((v) => !v)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          + List
                        </button>
                      </div>
                    </div>

                    {showNewList && (
                      <div className="flex gap-2">
                        <input
                          value={newListName}
                          onChange={(e) => setNewListName(e.target.value)}
                          placeholder="New To Do list name..."
                          className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                        />
                        <button
                          onClick={() => createTodoListMut.mutate()}
                          disabled={!newListName.trim() || createTodoListMut.isPending}
                          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          Create List
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <input
                        value={todoTitle}
                        onChange={(e) => setTodoTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && todoTitle.trim() && activeListId) {
                            createTodo.mutate();
                          }
                        }}
                        placeholder="Add a To Do task..."
                        className="flex-1 min-w-[140px] rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <input
                        type="date"
                        value={todoDueDate}
                        onChange={(e) => setTodoDueDate(e.target.value)}
                        className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                      />
                      <button
                        onClick={() => createTodo.mutate()}
                        disabled={!todoTitle.trim() || !activeListId || createTodo.isPending}
                        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {createTodo.isPending ? 'Adding...' : 'Add'}
                      </button>
                    </div>

                    {todoTasks.map((t) => (
                      <div key={t.id} className="rounded-lg border border-slate-200 p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className={t.status === 'completed' ? 'line-through text-slate-400 truncate' : 'truncate font-medium text-slate-800'}>
                            {t.title}
                          </div>
                          {t.dueDateTime?.dateTime && (
                            <div className="text-[10px] text-slate-400">Due {String(t.dueDateTime.dateTime).slice(0, 10)}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {t.status !== 'completed' ? (
                            <button
                              onClick={() => toggleTodoStatus.mutate({ taskId: t.id, completed: true })}
                              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                            >
                              Done
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleTodoStatus.mutate({ taskId: t.id, completed: false })}
                              className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                            >
                              Reopen
                            </button>
                          )}
                          <button
                            onClick={() => deleteTodoMut.mutate(t.id)}
                            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-600"
                            title="Delete task"
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'files' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">
                      SharePoint {selectedSite ? `> ${selectedSite.displayName}` : `Sites (${sites.length})`}
                    </h3>
                    {selectedSite && (
                      <button
                        onClick={() => {
                          setSelectedSite(null);
                          setSelectedDriveId(null);
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        ← All Sites
                      </button>
                    )}
                  </div>

                  {!selectedSite ? (
                    sites.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelectedSite({ id: s.id, displayName: s.displayName });
                          setSelectedDriveId(null);
                        }}
                        className="w-full text-left rounded-lg border border-slate-200 p-2.5 hover:border-blue-300 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <strong className="block text-slate-900 truncate">{s.displayName}</strong>
                          <span className="font-mono text-[10px] text-slate-500 break-all">{s.webUrl}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                    ))
                  ) : !selectedDriveId ? (
                    siteDrives.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDriveId(d.id)}
                        className="w-full text-left rounded-lg border border-slate-200 p-2.5 hover:border-blue-300 flex items-center justify-between"
                      >
                        <span>📚 {d.name}</span>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </button>
                    ))
                  ) : (
                    <div className="space-y-1.5">
                      <button onClick={() => setSelectedDriveId(null)} className="text-blue-600 hover:underline mb-1">
                        ← Back to Libraries
                      </button>
                      {driveItems.map((it) => (
                        <div key={it.id} className="rounded-lg border border-slate-200 p-2 flex justify-between gap-2">
                          <span className="truncate">{it.folder ? '📁' : '📄'} {it.name}</span>
                          {it.webUrl && (
                            <a href={it.webUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline shrink-0">
                              Open
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">OneDrive /{oneDrivePath}</h3>
                    {oneDrivePath && (
                      <button
                        onClick={() => setOneDrivePath(oneDrivePath.split('/').slice(0, -1).join('/'))}
                        className="text-blue-600 hover:underline"
                      >
                        ↑ Up
                      </button>
                    )}
                  </div>
                  {onedrive.map((f) => (
                    <div
                      key={f.id}
                      onClick={() => {
                        if (f.folder) setOneDrivePath(oneDrivePath ? `${oneDrivePath}/${f.name}` : f.name);
                      }}
                      className={`rounded-lg border border-slate-200 p-2.5 flex justify-between items-center gap-2 ${
                        f.folder ? 'cursor-pointer hover:border-blue-300' : ''
                      }`}
                    >
                      <span className="truncate">{f.folder ? '📁' : '📄'} {f.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-slate-400">{(f.lastModifiedDateTime || '').slice(0, 10)}</span>
                        {f.webUrl && (
                          <a
                            href={f.webUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline"
                          >
                            Open
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'onenote' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-900">Notebooks ({notebooks.length})</h3>
                  {notebooks.map((nb) => (
                    <button
                      key={nb.id}
                      onClick={() => {
                        setSelectedNotebook({ id: nb.id, displayName: nb.displayName });
                        setSelectedSection(null);
                        setSelectedPageId(null);
                      }}
                      className={`w-full text-left rounded-lg border p-2.5 ${
                        selectedNotebook?.id === nb.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'
                      }`}
                    >
                      <strong className="text-slate-900">{nb.displayName}</strong>
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <h3 className="font-bold text-slate-900">Sections {selectedNotebook ? `(${sections.length})` : ''}</h3>
                  {sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedSection({ id: s.id, displayName: s.displayName });
                        setSelectedPageId(null);
                      }}
                      className={`w-full text-left rounded-lg border p-2.5 ${
                        selectedSection?.id === s.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'
                      }`}
                    >
                      {s.displayName}
                    </button>
                  ))}
                  {pages.length > 0 && (
                    <div className="pt-2 space-y-1.5">
                      <h4 className="font-bold text-slate-700">Pages ({pages.length})</h4>
                      {pages.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPageId(p.id)}
                          className={`w-full text-left rounded-lg border p-2 ${
                            selectedPageId === p.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'
                          }`}
                        >
                          📄 {p.title || '(untitled)'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 max-h-96 overflow-y-auto">
                  <h3 className="font-bold text-slate-900 mb-2">Page Preview</h3>
                  {activePage ? (
                    <p className="whitespace-pre-wrap text-slate-700 [overflow-wrap:anywhere]">{activePage.contentText}</p>
                  ) : (
                    <span className="text-slate-500">Select a notebook, section, and page to read its notes.</span>
                  )}
                </div>
              </div>
            )}

            {tab === 'org' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="rounded-lg border border-slate-200 p-3">
                  <h3 className="font-bold text-slate-900 mb-2">Manager</h3>
                  {org?.manager ? (
                    <div>
                      <div className="font-semibold">{org.manager.displayName}</div>
                      <div className="text-slate-500">{org.manager.jobTitle}</div>
                      <div className="font-mono text-[11px] text-slate-500">{org.manager.userPrincipalName}</div>
                    </div>
                  ) : (
                    <span className="text-slate-500">No manager listed.</span>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <h3 className="font-bold text-slate-900 mb-2">Direct Reports ({org?.directReports.length || 0})</h3>
                  <div className="space-y-1">
                    {(org?.directReports || []).map((r) => (
                      <div key={r.id}>
                        <strong>{r.displayName}</strong> <span className="text-slate-500">({r.jobTitle})</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <h3 className="font-bold text-slate-900 mb-2">Frequent Collaborators</h3>
                  <div className="space-y-1">
                    {(org?.people || []).slice(0, 10).map((p, i) => (
                      <div key={p.id || i}>{p.displayName}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Draft Email Modal */}
      {showDraftModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setShowDraftModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Create Outlook Draft (Not Sent)</h3>
              <button onClick={() => setShowDraftModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              placeholder="To (comma-separated emails)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              value={draftSubject}
              onChange={(e) => setDraftSubject(e.target.value)}
              placeholder="Subject"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <textarea
              rows={5}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Email body..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDraftModal(false)} className="rounded-lg border border-slate-300 px-3 py-1.5">
                Cancel
              </button>
              <button
                onClick={() => createDraft.mutate()}
                disabled={!draftTo.trim() || !draftSubject.trim() || createDraft.isPending}
                className="rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createDraft.isPending ? 'Saving...' : 'Save to Drafts'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
