import crypto from 'node:crypto';
import type {
  PlannerBoard,
  PlannerChecklistItem,
  PlannerSourceType,
  PlannerStats,
  PlannerTask,
  PlannerTaskPriority,
  PlannerTaskStatus,
} from '@tzone/shared';
import { getDb } from './client.js';

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapBoard(row: Record<string, unknown>): PlannerBoard {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description || ''),
    color: String(row.color || '#2563eb'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTask(row: Record<string, unknown>): PlannerTask {
  return {
    id: String(row.id),
    boardId: String(row.board_id),
    title: String(row.title),
    description: String(row.description || ''),
    status: (row.status as PlannerTaskStatus) || 'todo',
    priority: (row.priority as PlannerTaskPriority) || 'medium',
    dueDate: row.due_date ? String(row.due_date) : null,
    tags: parseJson<string[]>(row.tags_json, []),
    assignee: String(row.assignee || ''),
    checklist: parseJson<PlannerChecklistItem[]>(row.checklist_json, []),
    sourceType: (row.source_type as PlannerSourceType) || 'manual',
    sourceId: row.source_id ? String(row.source_id) : null,
    position: Number(row.position || 0),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function ensureDefaultBoard(): PlannerBoard {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tzone_boards ORDER BY created_at ASC LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  if (existing) return mapBoard(existing);

  const now = nowIso();
  const id = 'default-board';
  db.prepare(
    'INSERT INTO tzone_boards (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, 'My T-ZONE Board', 'Personal & team tasks managed by T-ZONE', '#2563eb', now, now);

  return {
    id,
    name: 'My T-ZONE Board',
    description: 'Personal & team tasks managed by T-ZONE',
    color: '#2563eb',
    createdAt: now,
    updatedAt: now,
  };
}

export function listPlannerBoards(): PlannerBoard[] {
  ensureDefaultBoard();
  const rows = getDb().prepare('SELECT * FROM tzone_boards ORDER BY created_at ASC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(mapBoard);
}

export function createPlannerBoard(input: {
  name: string;
  description?: string;
  color?: string;
}): PlannerBoard {
  const db = getDb();
  const now = nowIso();
  const id = crypto.randomUUID();
  const name = input.name.trim() || 'Untitled Board';
  const description = (input.description || '').trim();
  const color = (input.color || '#2563eb').trim();
  db.prepare(
    'INSERT INTO tzone_boards (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, description, color, now, now);
  return { id, name, description, color, createdAt: now, updatedAt: now };
}

export function updatePlannerBoard(
  boardId: string,
  updates: { name?: string; description?: string; color?: string }
): PlannerBoard {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tzone_boards WHERE id = ?').get(boardId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) throw new Error(`Board not found: ${boardId}`);
  const cur = mapBoard(existing);
  const now = nowIso();
  const next = {
    name: updates.name !== undefined ? updates.name.trim() || cur.name : cur.name,
    description: updates.description !== undefined ? updates.description.trim() : cur.description,
    color: updates.color !== undefined ? updates.color.trim() : cur.color,
  };
  db.prepare('UPDATE tzone_boards SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?').run(
    next.name,
    next.description,
    next.color,
    now,
    boardId
  );
  return { ...cur, ...next, updatedAt: now };
}

export function deletePlannerBoard(boardId: string): { ok: true } {
  const boards = listPlannerBoards();
  if (boards.length <= 1) {
    throw new Error('Cannot delete the last remaining board.');
  }
  getDb().prepare('DELETE FROM tzone_boards WHERE id = ?').run(boardId);
  return { ok: true };
}

export function listPlannerTasks(filters?: {
  boardId?: string;
  status?: PlannerTaskStatus;
  priority?: PlannerTaskPriority;
  search?: string;
}): PlannerTask[] {
  ensureDefaultBoard();
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.boardId) {
    clauses.push('board_id = ?');
    params.push(filters.boardId);
  }
  if (filters?.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.priority) {
    clauses.push('priority = ?');
    params.push(filters.priority);
  }
  if (filters?.search?.trim()) {
    clauses.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags_json) LIKE ?)');
    const like = `%${filters.search.trim().toLowerCase()}%`;
    params.push(like, like, like);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM tzone_tasks ${where} ORDER BY position ASC, created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapTask);
}

export function getPlannerTask(taskId: string): PlannerTask | null {
  const row = getDb().prepare('SELECT * FROM tzone_tasks WHERE id = ?').get(taskId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapTask(row) : null;
}

export function createPlannerTaskRecord(input: {
  boardId?: string;
  title: string;
  description?: string;
  status?: PlannerTaskStatus;
  priority?: PlannerTaskPriority;
  dueDate?: string | null;
  tags?: string[];
  assignee?: string;
  checklist?: Array<string | PlannerChecklistItem>;
  sourceType?: PlannerSourceType;
  sourceId?: string | null;
}): PlannerTask {
  const db = getDb();
  const defaultBoard = ensureDefaultBoard();
  const boardId = input.boardId?.trim() || defaultBoard.id;
  const boardExists = db.prepare('SELECT id FROM tzone_boards WHERE id = ?').get(boardId);
  if (!boardExists) {
    throw new Error(`Board not found: ${boardId}`);
  }

  const now = nowIso();
  const id = crypto.randomUUID();
  const status: PlannerTaskStatus = input.status || 'todo';
  const priority: PlannerTaskPriority = input.priority || 'medium';
  const maxPosRow = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM tzone_tasks WHERE board_id = ? AND status = ?')
    .get(boardId, status) as { max_pos?: number } | undefined;
  const position = Number(maxPosRow?.max_pos ?? -1) + 1;

  const checklist: PlannerChecklistItem[] = (input.checklist || []).map((item) =>
    typeof item === 'string'
      ? { id: crypto.randomUUID(), text: item.trim(), done: false }
      : { id: item.id || crypto.randomUUID(), text: item.text.trim(), done: Boolean(item.done) }
  );

  const tags = (input.tags || []).map((t) => t.trim()).filter(Boolean);
  const completedAt = status === 'done' ? now : null;

  db.prepare(
    `INSERT INTO tzone_tasks
      (id, board_id, title, description, status, priority, due_date, tags_json, assignee, checklist_json, source_type, source_id, position, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    boardId,
    input.title.trim(),
    (input.description || '').trim(),
    status,
    priority,
    input.dueDate || null,
    JSON.stringify(tags),
    (input.assignee || '').trim(),
    JSON.stringify(checklist),
    input.sourceType || 'manual',
    input.sourceId || null,
    position,
    completedAt,
    now,
    now
  );

  return getPlannerTask(id)!;
}

export function updatePlannerTaskRecord(
  taskId: string,
  updates: {
    boardId?: string;
    title?: string;
    description?: string;
    status?: PlannerTaskStatus;
    priority?: PlannerTaskPriority;
    dueDate?: string | null;
    tags?: string[];
    assignee?: string;
    checklist?: PlannerChecklistItem[];
    position?: number;
  }
): PlannerTask {
  const db = getDb();
  const current = getPlannerTask(taskId);
  if (!current) throw new Error(`Task not found: ${taskId}`);

  const now = nowIso();
  const nextStatus = updates.status ?? current.status;
  const completedAt =
    nextStatus === 'done'
      ? current.completedAt || now
      : updates.status !== undefined
        ? null
        : current.completedAt;

  const next = {
    boardId: updates.boardId ?? current.boardId,
    title: updates.title !== undefined ? updates.title.trim() || current.title : current.title,
    description: updates.description !== undefined ? updates.description.trim() : current.description,
    status: nextStatus,
    priority: updates.priority ?? current.priority,
    dueDate: updates.dueDate !== undefined ? updates.dueDate : current.dueDate,
    tags: updates.tags !== undefined ? updates.tags.map((t) => t.trim()).filter(Boolean) : current.tags,
    assignee: updates.assignee !== undefined ? updates.assignee.trim() : current.assignee,
    checklist: updates.checklist !== undefined ? updates.checklist : current.checklist,
    position: updates.position !== undefined ? updates.position : current.position,
  };

  db.prepare(
    `UPDATE tzone_tasks
     SET board_id = ?, title = ?, description = ?, status = ?, priority = ?, due_date = ?,
         tags_json = ?, assignee = ?, checklist_json = ?, position = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    next.boardId,
    next.title,
    next.description,
    next.status,
    next.priority,
    next.dueDate,
    JSON.stringify(next.tags),
    next.assignee,
    JSON.stringify(next.checklist),
    next.position,
    completedAt,
    now,
    taskId
  );

  return getPlannerTask(taskId)!;
}

export function togglePlannerTaskChecklistItem(taskId: string, itemId: string): PlannerTask {
  const task = getPlannerTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const checklist = task.checklist.map((item) =>
    item.id === itemId ? { ...item, done: !item.done } : item
  );
  return updatePlannerTaskRecord(taskId, { checklist });
}

export function deletePlannerTaskRecord(taskId: string): { ok: true; id: string } {
  const res = getDb().prepare('DELETE FROM tzone_tasks WHERE id = ?').run(taskId);
  if (res.changes === 0) throw new Error(`Task not found: ${taskId}`);
  return { ok: true, id: taskId };
}

export function getPlannerStats(boardId?: string): PlannerStats {
  const tasks = listPlannerTasks(boardId ? { boardId } : undefined);
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === 'todo').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    review: tasks.filter((t) => t.status === 'review').length,
    done: tasks.filter((t) => t.status === 'done').length,
    overdue: tasks.filter((t) => t.status !== 'done' && Boolean(t.dueDate) && t.dueDate! < today).length,
  };
}
