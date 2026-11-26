import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaybookDefinition } from '@tzone/shared';
import { Calendar, CheckCircle2, Folder, Mail, NotebookPen, Play, Users } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAppStore } from '../../stores/appStore.js';

type HubTab = 'mail' | 'calendar' | 'tasks' | 'files' | 'onenote' | 'org';

export function HubScreen() {
  const qc = useQueryClient();
  const { launchPromptInChat } = useAppStore();
  const [tab, setTab] = useState<HubTab>('mail');
  const [todoTitle, setTodoTitle] = useState('');
  const [selectedListId, setSelectedListId] = useState<string>('');

  const { data: playbooks = [] } = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => apiFetch<PlaybookDefinition[]>('/api/playbooks'),
  });

  const { data: emails = [] } = useQuery({
    queryKey: ['m365-emails'],
    queryFn: () => apiFetch<Array<Record<string, any>>>('/api/m365/emails?limit=15'),
    enabled: tab === 'mail',
  });

  const { data: calendar = [] } = useQuery({
    queryKey: ['m365-calendar'],
    queryFn: () => apiFetch<Array<Record<string, any>>>('/api/m365/calendar?limit=15'),
    enabled: tab === 'calendar',
  });

  const { data: planner } = useQuery({
    queryKey: ['m365-planner'],
    queryFn: () => apiFetch<{ plans: any[]; myTasks: any[] }>('/api/m365/planner'),
    enabled: tab === 'tasks',
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

  const { data: sites = [] } = useQuery({
    queryKey: ['m365-sharepoint'],
    queryFn: () => apiFetch<Array<Record<string, any>>>('/api/m365/sharepoint'),
    enabled: tab === 'files',
  });

  const { data: onedrive = [] } = useQuery({
    queryKey: ['m365-onedrive'],
    queryFn: () => apiFetch<Array<Record<string, any>>>('/api/m365/onedrive'),
    enabled: tab === 'files',
  });

  const { data: notebooks = [] } = useQuery({
    queryKey: ['m365-onenote'],
    queryFn: () => apiFetch<Array<Record<string, any>>>('/api/m365/onenote'),
    enabled: tab === 'onenote',
  });

  const { data: org } = useQuery({
    queryKey: ['m365-org'],
    queryFn: () => apiFetch<{ manager: any; directReports: any[]; people: any[] }>('/api/m365/org'),
    enabled: tab === 'org',
  });

  const createTodo = useMutation({
    mutationFn: () =>
      apiFetch('/api/m365/todo/tasks', {
        method: 'POST',
        body: JSON.stringify({ listId: activeListId, title: todoTitle }),
      }),
    onSuccess: () => {
      setTodoTitle('');
      qc.invalidateQueries({ queryKey: ['m365-todo-tasks', activeListId] });
    },
  });

  const completeTodo = useMutation({
    mutationFn: (taskId: string) =>
      apiFetch(`/api/m365/todo/${encodeURIComponent(activeListId)}/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['m365-todo-tasks', activeListId] }),
  });

  const tabs: Array<{ id: HubTab; label: string; icon: any }> = [
    { id: 'mail', label: 'Outlook Mail', icon: Mail },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'tasks', label: 'Planner & To Do', icon: CheckCircle2 },
    { id: 'files', label: 'SharePoint & OneDrive', icon: Folder },
    { id: 'onenote', label: 'OneNote', icon: NotebookPen },
    { id: 'org', label: 'Org & People', icon: Users },
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6 space-y-6">
      {/* Playbooks */}
      <section className="space-y-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Agent Playbooks (msgraph Use Cases)</h1>
          <p className="text-xs text-slate-600">
            Launch pre-configured multi-step workflows across Teams, Transcripts, Outlook, Planner, SharePoint &amp; OneNote.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {playbooks.map((pb) => (
            <div key={pb.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col justify-between gap-3">
              <div>
                <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-mono font-semibold text-blue-700 mb-2">
                  {pb.badge}
                </span>
                <h3 className="text-sm font-bold text-slate-900">{pb.title}</h3>
                <p className="mt-1 text-xs text-slate-600">{pb.description}</p>
              </div>
              <button
                onClick={() => launchPromptInChat(pb.defaultPrompt)}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Play className="h-3.5 w-3.5" /> Run Playbook
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* M365 Workspace Explorer */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 p-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  tab === t.id ? 'bg-white text-blue-700 shadow-2xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-4 text-xs">
          {tab === 'mail' && (
            <div className="space-y-2">
              {emails.map((e) => (
                <div key={e.id} className="rounded-lg border border-slate-200 p-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {!e.isRead && <span className="mr-1.5 text-blue-600">●</span>}
                      {e.subject || '(no subject)'}
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      From: {e.from?.emailAddress?.name || e.from?.emailAddress?.address} ·{' '}
                      {(e.receivedDateTime || '').slice(0, 16).replace('T', ' ')}
                    </div>
                    <p className="mt-1 text-slate-600 line-clamp-2">{e.bodyPreview}</p>
                  </div>
                  <button
                    onClick={() => launchPromptInChat(`Read Outlook email ID ${e.id} ("${e.subject}") and help me respond or extract tasks.`)}
                    className="shrink-0 rounded border border-slate-300 px-2.5 py-1 font-medium hover:bg-slate-50"
                  >
                    Ask Agent
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'calendar' && (
            <div className="space-y-2">
              {calendar.map((ev) => (
                <div key={ev.id} className="rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                  <div>
                    <strong className="text-slate-900">{ev.subject || '(no title)'}</strong>
                    <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                      {(ev.start?.dateTime || '').slice(0, 16).replace('T', ' ')} → {(ev.end?.dateTime || '').slice(11, 16)}{' '}
                      {ev.isOnlineMeeting ? '· Teams Online Meeting' : ''}
                    </div>
                  </div>
                  <span className="text-slate-500">{ev.organizer?.emailAddress?.name}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-bold text-slate-900">My Planner Tasks ({planner?.myTasks.length || 0})</h3>
                {(planner?.myTasks || []).map((t) => (
                  <div key={t.id} className="rounded-lg border border-slate-200 p-2.5 flex justify-between">
                    <span>{t.title}</span>
                    <span className="font-mono text-slate-500">{t.percentComplete ?? 0}%</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Microsoft To Do</h3>
                  <select
                    value={activeListId}
                    onChange={(e) => setSelectedListId(e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    {todoLists.map((l) => (
                      <option key={l.id} value={l.id}>{l.displayName}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    value={todoTitle}
                    onChange={(e) => setTodoTitle(e.target.value)}
                    placeholder="Add a To Do task..."
                    className="flex-1 rounded border border-slate-300 px-2.5 py-1.5"
                  />
                  <button
                    onClick={() => createTodo.mutate()}
                    disabled={!todoTitle.trim() || !activeListId}
                    className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {todoTasks.map((t) => (
                  <div key={t.id} className="rounded-lg border border-slate-200 p-2.5 flex items-center justify-between">
                    <span className={t.status === 'completed' ? 'line-through text-slate-400' : ''}>{t.title}</span>
                    {t.status !== 'completed' && (
                      <button
                        onClick={() => completeTodo.mutate(t.id)}
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                      >
                        Done
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'files' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-bold text-slate-900">SharePoint Sites ({sites.length})</h3>
                {sites.map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-2.5">
                    <strong className="block text-slate-900">{s.displayName}</strong>
                    <span className="font-mono text-[10px] text-slate-500 break-all">{s.webUrl}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-slate-900">OneDrive Root ({onedrive.length})</h3>
                {onedrive.map((f) => (
                  <div key={f.id} className="rounded-lg border border-slate-200 p-2.5 flex justify-between">
                    <span>{f.folder ? '📁' : '📄'} {f.name}</span>
                    <span className="font-mono text-slate-400">{(f.lastModifiedDateTime || '').slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'onenote' && (
            <div className="space-y-2">
              {notebooks.map((nb) => (
                <div key={nb.id} className="rounded-lg border border-slate-200 p-3 flex justify-between items-center">
                  <div>
                    <strong className="text-slate-900">{nb.displayName}</strong>
                    <div className="font-mono text-[10px] text-slate-400">{nb.id}</div>
                  </div>
                  <button
                    onClick={() => launchPromptInChat(`Browse OneNote notebook "${nb.displayName}" (ID: ${nb.id}) and show its recent pages.`)}
                    className="rounded border border-slate-300 px-2.5 py-1 hover:bg-slate-50"
                  >
                    Explore with Agent
                  </button>
                </div>
              ))}
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
      </section>
    </div>
  );
}
