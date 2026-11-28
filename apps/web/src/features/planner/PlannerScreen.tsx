import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PlannerBoard,
  PlannerChecklistItem,
  PlannerStats,
  PlannerTask,
  PlannerTaskPriority,
  PlannerTaskStatus,
} from '@tzone/shared';
import {
  Calendar,
  CheckCircle2,
  CheckSquare,
  Circle,
  Columns3,
  List,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAppStore } from '../../stores/appStore.js';

const COLUMNS: Array<{
  id: PlannerTaskStatus;
  label: string;
  dot: string;
  headerBg: string;
}> = [
  { id: 'todo', label: 'To Do', dot: 'bg-slate-400', headerBg: 'bg-slate-100/80' },
  { id: 'in_progress', label: 'In Progress', dot: 'bg-blue-500', headerBg: 'bg-blue-50/80' },
  { id: 'review', label: 'Review', dot: 'bg-amber-500', headerBg: 'bg-amber-50/80' },
  { id: 'done', label: 'Done', dot: 'bg-emerald-500', headerBg: 'bg-emerald-50/80' },
];

const PRIORITY_BADGE: Record<PlannerTaskPriority, string> = {
  low: 'bg-slate-100 text-slate-600 border-slate-200',
  medium: 'bg-blue-50 text-blue-700 border-blue-200',
  high: 'bg-amber-50 text-amber-700 border-amber-200',
  urgent: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function PlannerScreen() {
  const qc = useQueryClient();
  const launchPromptInChat = useAppStore((s) => s.launchPromptInChat);

  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // Quick add state
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<PlannerTaskPriority>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [newTags, setNewTags] = useState('');

  // New board modal
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');

  // Task detail modal
  const [editingTask, setEditingTask] = useState<PlannerTask | null>(null);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const { data: boards = [] } = useQuery({
    queryKey: ['tzone-planner-boards'],
    queryFn: () => apiFetch<PlannerBoard[]>('/api/planner/boards'),
  });

  const activeBoardId = selectedBoardId || boards[0]?.id || 'default-board';

  const { data: stats } = useQuery({
    queryKey: ['tzone-planner-stats', activeBoardId],
    queryFn: () => apiFetch<PlannerStats>(`/api/planner/stats?boardId=${encodeURIComponent(activeBoardId)}`),
    enabled: Boolean(activeBoardId),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tzone-planner-tasks', activeBoardId, priorityFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams({ boardId: activeBoardId });
      if (priorityFilter !== 'all') qs.set('priority', priorityFilter);
      if (search.trim()) qs.set('q', search.trim());
      return apiFetch<PlannerTask[]>(`/api/planner/tasks?${qs.toString()}`);
    },
    enabled: Boolean(activeBoardId),
  });

  const invalidatePlanner = () => {
    qc.invalidateQueries({ queryKey: ['tzone-planner-tasks'] });
    qc.invalidateQueries({ queryKey: ['tzone-planner-stats'] });
    qc.invalidateQueries({ queryKey: ['tzone-planner-boards'] });
  };

  const createBoardMut = useMutation({
    mutationFn: () =>
      apiFetch<PlannerBoard>('/api/planner/boards', {
        method: 'POST',
        body: JSON.stringify({ name: newBoardName.trim() }),
      }),
    onSuccess: (created) => {
      setNewBoardName('');
      setShowNewBoard(false);
      setSelectedBoardId(created.id);
      invalidatePlanner();
    },
  });

  const createTaskMut = useMutation({
    mutationFn: () =>
      apiFetch<PlannerTask>('/api/planner/tasks', {
        method: 'POST',
        body: JSON.stringify({
          boardId: activeBoardId,
          title: newTitle.trim(),
          priority: newPriority,
          dueDate: newDueDate || null,
          tags: newTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      }),
    onSuccess: () => {
      setNewTitle('');
      setNewDueDate('');
      setNewTags('');
      invalidatePlanner();
    },
  });

  const updateTaskMut = useMutation({
    mutationFn: ({
      taskId,
      patch,
    }: {
      taskId: string;
      patch: Partial<PlannerTask> & { checklist?: PlannerChecklistItem[] };
    }) =>
      apiFetch<PlannerTask>(`/api/planner/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (updated) => {
      if (editingTask?.id === updated.id) setEditingTask(updated);
      invalidatePlanner();
    },
  });

  const deleteTaskMut = useMutation({
    mutationFn: (taskId: string) =>
      apiFetch(`/api/planner/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
    onSuccess: (_res, taskId) => {
      if (editingTask?.id === taskId) setEditingTask(null);
      invalidatePlanner();
    },
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* Top Header */}
      <header className="border-b border-slate-200 bg-white px-5 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <h1 className="text-base font-bold text-slate-900">T-ZONE Planner &amp; To Do</h1>
              <p className="text-[11px] text-slate-500">
                Native workspace planner · AI Agent &amp; MCP ready (<code>POST /api/mcp</code>)
              </p>
            </div>

            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {boards.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBoardId(b.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    activeBoardId === b.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {b.name}
                </button>
              ))}
              <button
                onClick={() => setShowNewBoard((v) => !v)}
                className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                title="Create new board"
              >
                + Board
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                Open: {(stats?.todo ?? 0) + (stats?.inProgress ?? 0) + (stats?.review ?? 0)}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                Done: {stats?.done ?? 0}
              </span>
              {(stats?.overdue ?? 0) > 0 && (
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">
                  Overdue: {stats?.overdue}
                </span>
              )}
            </div>

            <button
              onClick={() =>
                launchPromptInChat(
                  'Review my T-ZONE Planner tasks, prioritize what is overdue or high priority, and suggest a plan for today.'
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              <Sparkles className="h-3.5 w-3.5" /> Ask AI
            </button>

            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                onClick={() => setViewMode('board')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                  viewMode === 'board' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                <Columns3 className="h-3.5 w-3.5" /> Board
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                  viewMode === 'list' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                <List className="h-3.5 w-3.5" /> List
              </button>
            </div>
          </div>
        </div>

        {showNewBoard && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-2">
            <input
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBoardName.trim()) createBoardMut.mutate();
              }}
              placeholder="New board name (e.g. Q4 Roadmap, Personal To Do)..."
              className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            />
            <button
              onClick={() => createBoardMut.mutate()}
              disabled={!newBoardName.trim() || createBoardMut.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Create Board
            </button>
            <button
              onClick={() => setShowNewBoard(false)}
              className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Quick Add + Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 min-w-[260px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 focus-within:border-blue-500">
            <Plus className="h-4 w-4 text-blue-600 shrink-0" />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTitle.trim()) createTaskMut.mutate();
              }}
              placeholder="Quick add a task (press Enter)..."
              className="flex-1 bg-transparent text-xs outline-none"
            />
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as PlannerTaskPriority)}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px]"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px]"
            />
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="tags"
              className="hidden sm:block w-24 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px]"
            />
            <button
              onClick={() => createTaskMut.mutate()}
              disabled={!newTitle.trim() || createTaskMut.isPending}
              className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks..."
                className="w-32 bg-transparent text-xs outline-none"
              />
            </div>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-5">
        {viewMode === 'board' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 h-full min-h-[420px]">
            {COLUMNS.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.id);
              return (
                <div
                  key={col.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedTaskId) {
                      updateTaskMut.mutate({ taskId: draggedTaskId, patch: { status: col.id } });
                      setDraggedTaskId(null);
                    }
                  }}
                  className="flex flex-col rounded-xl border border-slate-200 bg-slate-100/70 overflow-hidden"
                >
                  <div className={`flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 ${col.headerBg}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                      <span className="text-xs font-bold text-slate-800">{col.label}</span>
                    </div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-mono text-slate-600 border border-slate-200">
                      {colTasks.length}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                    {colTasks.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-[11px] text-slate-400">
                        Drop tasks here
                      </div>
                    ) : (
                      colTasks.map((task) => {
                        const doneChecks = task.checklist.filter((c) => c.done).length;
                        const isOverdue = task.status !== 'done' && Boolean(task.dueDate) && task.dueDate! < today;
                        return (
                          <div
                            key={task.id}
                            draggable
                            onDragStart={() => setDraggedTaskId(task.id)}
                            onClick={() => setEditingTask(task)}
                            className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-2xs hover:border-blue-300 hover:shadow-xs transition space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className={`text-xs font-semibold leading-snug ${
                                  task.status === 'done' ? 'line-through text-slate-400' : 'text-slate-900'
                                }`}
                              >
                                {task.title}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateTaskMut.mutate({
                                    taskId: task.id,
                                    patch: { status: task.status === 'done' ? 'todo' : 'done' },
                                  });
                                }}
                                className="shrink-0 text-slate-400 hover:text-emerald-600"
                                title={task.status === 'done' ? 'Reopen' : 'Mark Done'}
                              >
                                {task.status === 'done' ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                ) : (
                                  <Circle className="h-4 w-4" />
                                )}
                              </button>
                            </div>

                            {task.description && (
                              <p className="text-[11px] text-slate-500 line-clamp-2">{task.description}</p>
                            )}

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${PRIORITY_BADGE[task.priority]}`}
                              >
                                {task.priority}
                              </span>
                              {task.dueDate && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono ${
                                    isOverdue
                                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  <Calendar className="h-2.5 w-2.5" />
                                  {task.dueDate}
                                </span>
                              )}
                              {task.checklist.length > 0 && (
                                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                                  <CheckSquare className="h-2.5 w-2.5" />
                                  {doneChecks}/{task.checklist.length}
                                </span>
                              )}
                              {task.sourceType === 'agent' && (
                                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                                  AI
                                </span>
                              )}
                            </div>

                            {task.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {task.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {tasks.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-400">
                No tasks yet. Add one above or ask Agent Chat to create tasks for you!
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tasks.map((task) => {
                  const isOverdue = task.status !== 'done' && Boolean(task.dueDate) && task.dueDate! < today;
                  return (
                    <div
                      key={task.id}
                      onClick={() => setEditingTask(task)}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateTaskMut.mutate({
                              taskId: task.id,
                              patch: { status: task.status === 'done' ? 'todo' : 'done' },
                            });
                          }}
                          className="shrink-0 text-slate-400 hover:text-emerald-600"
                        >
                          {task.status === 'done' ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Circle className="h-4 w-4" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div
                            className={`text-xs font-semibold truncate ${
                              task.status === 'done' ? 'line-through text-slate-400' : 'text-slate-900'
                            }`}
                          >
                            {task.title}
                          </div>
                          {task.description && (
                            <div className="text-[11px] text-slate-500 truncate">{task.description}</div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={task.status}
                          onChange={(e) =>
                            updateTaskMut.mutate({
                              taskId: task.id,
                              patch: { status: e.target.value as PlannerTaskStatus },
                            })
                          }
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                        >
                          {COLUMNS.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                        <span
                          className={`rounded border px-2 py-0.5 text-[10px] font-medium capitalize ${PRIORITY_BADGE[task.priority]}`}
                        >
                          {task.priority}
                        </span>
                        {task.dueDate && (
                          <span
                            className={`font-mono text-[11px] ${
                              isOverdue ? 'text-rose-600 font-semibold' : 'text-slate-500'
                            }`}
                          >
                            {task.dueDate}
                          </span>
                        )}
                        <button
                          onClick={() => deleteTaskMut.mutate(task.id)}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Delete task"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task Detail Modal */}
      {editingTask && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          onClick={() => setEditingTask(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <input
                value={editingTask.title}
                onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                className="flex-1 text-sm font-bold text-slate-900 border-b border-transparent focus:border-blue-500 outline-none pb-1"
              />
              <button onClick={() => setEditingTask(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Status</label>
                <select
                  value={editingTask.status}
                  onChange={(e) =>
                    setEditingTask({ ...editingTask, status: e.target.value as PlannerTaskStatus })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                >
                  {COLUMNS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Priority</label>
                <select
                  value={editingTask.priority}
                  onChange={(e) =>
                    setEditingTask({ ...editingTask, priority: e.target.value as PlannerTaskPriority })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Due Date</label>
                <input
                  type="date"
                  value={editingTask.dueDate || ''}
                  onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value || null })}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Description</label>
              <textarea
                rows={3}
                value={editingTask.description}
                onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                placeholder="Add notes, links, or details..."
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Assignee</label>
                <input
                  value={editingTask.assignee}
                  onChange={(e) => setEditingTask({ ...editingTask, assignee: e.target.value })}
                  placeholder="Optional owner"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Tags (comma-separated)</label>
                <input
                  value={editingTask.tags.join(', ')}
                  onChange={(e) =>
                    setEditingTask({
                      ...editingTask,
                      tags: e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="backend, sprint"
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </div>
            </div>

            {/* Subtask Checklist */}
            <div className="space-y-2">
              <label className="block text-[10px] font-semibold uppercase text-slate-400">Checklist</label>
              <div className="space-y-1.5">
                {editingTask.checklist.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() =>
                          setEditingTask({
                            ...editingTask,
                            checklist: editingTask.checklist.map((c) =>
                              c.id === item.id ? { ...c, done: !c.done } : c
                            ),
                          })
                        }
                      />
                      <span className={item.done ? 'line-through text-slate-400' : 'text-slate-800'}>
                        {item.text}
                      </span>
                    </label>
                    <button
                      onClick={() =>
                        setEditingTask({
                          ...editingTask,
                          checklist: editingTask.checklist.filter((c) => c.id !== item.id),
                        })
                      }
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newCheckItem}
                  onChange={(e) => setNewCheckItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCheckItem.trim()) {
                      setEditingTask({
                        ...editingTask,
                        checklist: [
                          ...editingTask.checklist,
                          { id: crypto.randomUUID(), text: newCheckItem.trim(), done: false },
                        ],
                      });
                      setNewCheckItem('');
                    }
                  }}
                  placeholder="Add checklist item..."
                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <button
                  onClick={() => {
                    if (!newCheckItem.trim()) return;
                    setEditingTask({
                      ...editingTask,
                      checklist: [
                        ...editingTask.checklist,
                        { id: crypto.randomUUID(), text: newCheckItem.trim(), done: false },
                      ],
                    });
                    setNewCheckItem('');
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <button
                onClick={() => deleteTaskMut.mutate(editingTask.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete Task
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingTask(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updateTaskMut.mutate({
                      taskId: editingTask.id,
                      patch: {
                        title: editingTask.title,
                        description: editingTask.description,
                        status: editingTask.status,
                        priority: editingTask.priority,
                        dueDate: editingTask.dueDate,
                        tags: editingTask.tags,
                        assignee: editingTask.assignee,
                        checklist: editingTask.checklist,
                      },
                    });
                    setEditingTask(null);
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
