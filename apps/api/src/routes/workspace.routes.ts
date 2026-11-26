import type { FastifyInstance } from 'fastify';
import {
  completePlannerTask,
  completeTodoTask,
  createCalendarEvent,
  createEmailDraft,
  createOnenotePage,
  createPlannerTask,
  createTodoTask,
  getMeProfile,
  getOrgOverview,
  listCalendarEvents,
  listDriveItems,
  listEmails,
  listMyPlannerTasks,
  listOnenoteNotebooks,
  listOnenotePages,
  listOnenoteSections,
  listOneDriveFiles,
  listPlanBuckets,
  listPlannerPlans,
  listPlanTasks,
  listSharepointSites,
  listSiteDrives,
  listTodoLists,
  listTodoTasks,
  readEmail,
  readOnenotePage,
  searchPeople,
  sendEmail,
} from '../msgraph/services/workspaceService.js';

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/m365/me', async () => getMeProfile());
  app.get('/api/m365/org', async () => getOrgOverview());

  app.get<{ Querystring: { q?: string; contacts?: string } }>('/api/m365/people', async (req) =>
    searchPeople(req.query.q, req.query.contacts === 'true')
  );

  app.get<{ Querystring: { limit?: string; unread?: string; search?: string; folder?: string } }>(
    '/api/m365/emails',
    async (req) =>
      listEmails({
        limit: Number(req.query.limit) || 20,
        unread: req.query.unread === 'true',
        search: req.query.search,
        folder: req.query.folder,
      })
  );

  app.get<{ Params: { id: string } }>('/api/m365/emails/:id', async (req) => readEmail(req.params.id));

  app.post<{ Body: { to: string[]; cc?: string[]; subject: string; body: string; html?: boolean } }>(
    '/api/m365/emails/draft',
    async (req) => createEmailDraft(req.body)
  );

  app.post<{ Body: { to: string[]; subject: string; body: string; html?: boolean } }>(
    '/api/m365/emails/send',
    async (req) => sendEmail(req.body)
  );

  app.get<{ Querystring: { limit?: string } }>('/api/m365/calendar', async (req) =>
    listCalendarEvents(Number(req.query.limit) || 20)
  );

  app.post<{
    Body: {
      subject: string;
      start: string;
      end: string;
      timezone?: string;
      location?: string;
      attendees?: string[];
      body?: string;
    };
  }>('/api/m365/calendar/events', async (req) => createCalendarEvent(req.body));

  app.get('/api/m365/planner', async () => ({
    plans: await listPlannerPlans(),
    myTasks: await listMyPlannerTasks(),
  }));

  app.get<{ Params: { planId: string } }>('/api/m365/planner/:planId', async (req) => ({
    buckets: await listPlanBuckets(req.params.planId),
    tasks: await listPlanTasks(req.params.planId),
  }));

  app.post<{
    Body: { planId: string; title: string; bucketId?: string; dueDate?: string; assignUserId?: string };
  }>('/api/m365/planner/tasks', async (req) => createPlannerTask(req.body));

  app.post<{ Params: { taskId: string } }>('/api/m365/planner/tasks/:taskId/complete', async (req) =>
    completePlannerTask(req.params.taskId)
  );

  app.get('/api/m365/todo', async () => listTodoLists());

  app.get<{ Params: { listId: string } }>('/api/m365/todo/:listId/tasks', async (req) =>
    listTodoTasks(req.params.listId)
  );

  app.post<{ Body: { listId: string; title: string; body?: string; dueDate?: string } }>(
    '/api/m365/todo/tasks',
    async (req) => createTodoTask(req.body)
  );

  app.post<{ Params: { listId: string; taskId: string } }>(
    '/api/m365/todo/:listId/tasks/:taskId/complete',
    async (req) => completeTodoTask(req.params.listId, req.params.taskId)
  );

  app.get('/api/m365/sharepoint', async () => listSharepointSites());

  app.get<{ Params: { siteId: string } }>('/api/m365/sharepoint/:siteId/drives', async (req) =>
    listSiteDrives(req.params.siteId)
  );

  app.get<{ Params: { driveId: string }; Querystring: { path?: string } }>(
    '/api/m365/drives/:driveId/items',
    async (req) => listDriveItems(req.params.driveId, req.query.path)
  );

  app.get<{ Querystring: { path?: string } }>('/api/m365/onedrive', async (req) =>
    listOneDriveFiles(req.query.path)
  );

  app.get('/api/m365/onenote', async () => listOnenoteNotebooks());

  app.get<{ Params: { notebookId: string } }>(
    '/api/m365/onenote/notebooks/:notebookId/sections',
    async (req) => listOnenoteSections(req.params.notebookId)
  );

  app.get<{ Params: { sectionId: string } }>(
    '/api/m365/onenote/sections/:sectionId/pages',
    async (req) => listOnenotePages(req.params.sectionId)
  );

  app.get<{ Params: { pageId: string } }>('/api/m365/onenote/pages/:pageId', async (req) =>
    readOnenotePage(req.params.pageId)
  );

  app.post<{ Body: { sectionId: string; title: string; body: string } }>(
    '/api/m365/onenote/pages',
    async (req) => createOnenotePage(req.body.sectionId, req.body.title, req.body.body)
  );
}
