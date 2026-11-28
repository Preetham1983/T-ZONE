import type { FastifyInstance } from 'fastify';
import type { PlannerChecklistItem, PlannerTaskPriority, PlannerTaskStatus } from '@tzone/shared';
import {
  createPlannerBoard,
  createPlannerTaskRecord,
  deletePlannerBoard,
  deletePlannerTaskRecord,
  getPlannerStats,
  getPlannerTask,
  listPlannerBoards,
  listPlannerTasks,
  togglePlannerTaskChecklistItem,
  updatePlannerBoard,
  updatePlannerTaskRecord,
} from '../db/plannerRepository.js';

export async function registerPlannerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/planner/boards', async () => listPlannerBoards());

  app.post<{ Body: { name: string; description?: string; color?: string } }>(
    '/api/planner/boards',
    async (req, reply) => {
      if (!req.body?.name?.trim()) {
        return reply.status(400).send({ error: 'Board name is required' });
      }
      return createPlannerBoard(req.body);
    }
  );

  app.patch<{
    Params: { boardId: string };
    Body: { name?: string; description?: string; color?: string };
  }>('/api/planner/boards/:boardId', async (req) =>
    updatePlannerBoard(req.params.boardId, req.body || {})
  );

  app.delete<{ Params: { boardId: string } }>('/api/planner/boards/:boardId', async (req) =>
    deletePlannerBoard(req.params.boardId)
  );

  app.get<{ Querystring: { boardId?: string } }>('/api/planner/stats', async (req) =>
    getPlannerStats(req.query.boardId)
  );

  app.get<{
    Querystring: {
      boardId?: string;
      status?: PlannerTaskStatus;
      priority?: PlannerTaskPriority;
      q?: string;
    };
  }>('/api/planner/tasks', async (req) =>
    listPlannerTasks({
      boardId: req.query.boardId,
      status: req.query.status,
      priority: req.query.priority,
      search: req.query.q,
    })
  );

  app.get<{ Params: { taskId: string } }>('/api/planner/tasks/:taskId', async (req, reply) => {
    const task = getPlannerTask(req.params.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task;
  });

  app.post<{
    Body: {
      boardId?: string;
      title: string;
      description?: string;
      status?: PlannerTaskStatus;
      priority?: PlannerTaskPriority;
      dueDate?: string | null;
      tags?: string[];
      assignee?: string;
      checklist?: Array<string | PlannerChecklistItem>;
    };
  }>('/api/planner/tasks', async (req, reply) => {
    if (!req.body?.title?.trim()) {
      return reply.status(400).send({ error: 'Task title is required' });
    }
    return createPlannerTaskRecord({ ...req.body, sourceType: 'manual' });
  });

  app.patch<{
    Params: { taskId: string };
    Body: {
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
    };
  }>('/api/planner/tasks/:taskId', async (req) =>
    updatePlannerTaskRecord(req.params.taskId, req.body || {})
  );

  app.post<{ Params: { taskId: string; itemId: string } }>(
    '/api/planner/tasks/:taskId/checklist/:itemId/toggle',
    async (req) => togglePlannerTaskChecklistItem(req.params.taskId, req.params.itemId)
  );

  app.delete<{ Params: { taskId: string } }>('/api/planner/tasks/:taskId', async (req) =>
    deletePlannerTaskRecord(req.params.taskId)
  );
}
