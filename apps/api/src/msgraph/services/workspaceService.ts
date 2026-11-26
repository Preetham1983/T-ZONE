import { graphGet, graphGetAll, graphGetText, graphPatch, graphPost, stripHtml } from '../graphClient.js';
import { runMsGraphSkill } from '../skillRunner.js';

export async function getMeProfile() {
  const res = await runMsGraphSkill(['me', '--json']);
  return res.parsedJson || (await graphGet('/me'));
}

export async function getOrgOverview() {
  let manager: Record<string, unknown> | null = null;
  try {
    manager = await graphGet('/me/manager', { $select: 'id,displayName,userPrincipalName,jobTitle,department' });
  } catch {
    manager = null;
  }
  const directReports = await graphGetAll('/me/directReports', {
    $select: 'id,displayName,userPrincipalName,jobTitle',
  });
  const people = await graphGetAll('/me/people', { $top: 15 }, 15);
  return { manager, directReports, people };
}

export async function searchPeople(query?: string, contactsOnly = false) {
  if (contactsOnly) {
    const params: Record<string, string | number> = {
      $top: 25,
      $select: 'id,displayName,emailAddresses,mobilePhone,jobTitle,companyName',
    };
    if (query) params.$search = `"${query}"`;
    return (await graphGet<{ value?: unknown[] }>('/me/contacts', params)).value || [];
  }
  const params: Record<string, string | number> = { $top: 25 };
  if (query) params.$search = `"${query}"`;
  return (await graphGet<{ value?: unknown[] }>('/me/people', params)).value || [];
}

export async function listEmails(options: {
  limit?: number;
  unread?: boolean;
  search?: string;
  folder?: string;
}) {
  const params: Record<string, string | number> = {
    $top: options.limit || 20,
    $select: 'id,subject,from,receivedDateTime,isRead,hasAttachments,importance,bodyPreview,conversationId',
    $orderby: 'receivedDateTime desc',
  };
  if (options.search) {
    params.$search = `"${options.search}"`;
    delete params.$orderby;
  }
  if (options.unread) {
    params.$filter = 'isRead eq false';
  }
  const endpoint = options.folder ? `/me/mailFolders/${encodeURIComponent(options.folder)}/messages` : '/me/messages';
  const data = await graphGet<{ value?: unknown[] }>(endpoint, params);
  return data.value || [];
}

export async function readEmail(messageId: string) {
  const msg = await graphGet<{
    id: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
    receivedDateTime?: string;
    isRead?: boolean;
    body?: { contentType?: string; content?: string };
  }>(`/me/messages/${encodeURIComponent(messageId)}`);
  return {
    ...msg,
    bodyText: msg.body?.contentType === 'text' ? msg.body.content : stripHtml(msg.body?.content),
  };
}

export async function createEmailDraft(args: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: boolean;
}) {
  return graphPost<{ id: string; subject: string; webLink?: string }>('/me/messages', {
    subject: args.subject,
    body: { contentType: args.html ? 'HTML' : 'Text', content: args.body },
    toRecipients: args.to.map((address) => ({ emailAddress: { address } })),
    ccRecipients: (args.cc || []).map((address) => ({ emailAddress: { address } })),
  });
}

export async function sendEmail(args: { to: string[]; subject: string; body: string; html?: boolean }) {
  return graphPost('/me/sendMail', {
    message: {
      subject: args.subject,
      body: { contentType: args.html ? 'HTML' : 'Text', content: args.body },
      toRecipients: args.to.map((address) => ({ emailAddress: { address } })),
    },
  });
}

export async function listCalendarEvents(limit = 20) {
  const now = new Date();
  const future = new Date(now.getTime() + 45 * 86400 * 1000);
  const data = await graphGet<{ value?: unknown[] }>('/me/calendarView', {
    startDateTime: `${now.toISOString().slice(0, 19)}Z`,
    endDateTime: `${future.toISOString().slice(0, 19)}Z`,
    $top: limit,
    $select: 'id,subject,start,end,location,organizer,isOnlineMeeting,onlineMeeting',
    $orderby: 'start/dateTime',
  });
  return data.value || [];
}

export async function checkAvailability(startDateTime: string, endDateTime: string) {
  const data = await graphGet<{ value?: unknown[] }>('/me/calendarView', {
    startDateTime,
    endDateTime,
    $select: 'subject,start,end,showAs',
    $orderby: 'start/dateTime',
  });
  return data.value || [];
}

export async function createCalendarEvent(args: {
  subject: string;
  start: string;
  end: string;
  timezone?: string;
  location?: string;
  attendees?: string[];
  body?: string;
  isOnlineMeeting?: boolean;
}) {
  const tz = args.timezone || 'UTC';
  return graphPost('/me/events', {
    subject: args.subject,
    start: { dateTime: args.start, timeZone: tz },
    end: { dateTime: args.end, timeZone: tz },
    location: args.location ? { displayName: args.location } : undefined,
    body: args.body ? { contentType: 'Text', content: args.body } : undefined,
    isOnlineMeeting: args.isOnlineMeeting ?? true,
    attendees: args.attendees?.map((address) => ({
      emailAddress: { address: address.trim() },
      type: 'required',
    })),
  });
}

export async function listPlannerPlans() {
  const data = await graphGet<{ value?: Array<{ id: string; title: string }> }>('/me/planner/plans');
  return data.value || [];
}

export async function listMyPlannerTasks() {
  const data = await graphGet<{ value?: Array<Record<string, unknown>> }>('/me/planner/tasks');
  return data.value || [];
}

export async function listPlanBuckets(planId: string) {
  const data = await graphGet<{ value?: Array<Record<string, unknown>> }>(
    `/planner/plans/${encodeURIComponent(planId)}/buckets`
  );
  return data.value || [];
}

export async function listPlanTasks(planId: string) {
  const data = await graphGet<{ value?: Array<Record<string, unknown>> }>(
    `/planner/plans/${encodeURIComponent(planId)}/tasks`
  );
  return data.value || [];
}

export async function createPlannerTask(args: {
  planId: string;
  title: string;
  bucketId?: string;
  dueDate?: string;
  assignUserId?: string;
}) {
  const payload: Record<string, unknown> = { planId: args.planId, title: args.title };
  if (args.bucketId) payload.bucketId = args.bucketId;
  if (args.dueDate) payload.dueDateTime = `${args.dueDate}T00:00:00Z`;
  if (args.assignUserId) {
    payload.assignments = {
      [args.assignUserId]: { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' },
    };
  }
  return graphPost('/planner/tasks', payload);
}

export async function completePlannerTask(taskId: string) {
  const task = await graphGet<Record<string, unknown>>(`/planner/tasks/${encodeURIComponent(taskId)}`);
  const etag = task['@odata.etag'] as string | undefined;
  if (!etag) throw new Error('Missing @odata.etag on Planner task');
  await graphPatch(
    `/planner/tasks/${encodeURIComponent(taskId)}`,
    { percentComplete: 100 },
    { 'If-Match': etag }
  );
  return { ok: true, id: taskId, title: task.title };
}

export async function listTodoLists() {
  const data = await graphGet<{ value?: Array<{ id: string; displayName: string }> }>('/me/todo/lists', { $top: 50 });
  return data.value || [];
}

export async function listTodoTasks(listId: string) {
  const data = await graphGet<{ value?: Array<Record<string, unknown>> }>(
    `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
    { $top: 50 }
  );
  return data.value || [];
}

export async function createTodoTask(args: { listId: string; title: string; body?: string; dueDate?: string }) {
  const payload: Record<string, unknown> = { title: args.title };
  if (args.body) payload.body = { content: args.body, contentType: 'text' };
  if (args.dueDate) payload.dueDateTime = { dateTime: `${args.dueDate}T00:00:00.000000`, timeZone: 'UTC' };
  return graphPost(`/me/todo/lists/${encodeURIComponent(args.listId)}/tasks`, payload);
}

export async function completeTodoTask(listId: string, taskId: string) {
  await graphPatch(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    status: 'completed',
  });
  return { ok: true, taskId };
}

export async function listSharepointSites(limit = 25) {
  let sites = (await graphGet<{ value?: unknown[] }>('/me/followedSites', { $select: 'id,displayName,webUrl' })).value || [];
  if (sites.length === 0) {
    sites = (await graphGet<{ value?: unknown[] }>('/sites', { search: '*', $top: limit })).value || [];
  }
  return sites;
}

export async function listSiteDrives(siteId: string) {
  return (await graphGet<{ value?: unknown[] }>(`/sites/${encodeURIComponent(siteId)}/drives`)).value || [];
}

export async function listDriveItems(driveId: string, folderPath?: string) {
  const ep = folderPath
    ? `/drives/${encodeURIComponent(driveId)}/root:/${folderPath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}:/children`
    : `/drives/${encodeURIComponent(driveId)}/root/children`;
  return (
    await graphGet<{ value?: unknown[] }>(ep, {
      $top: 100,
      $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder',
    })
  ).value || [];
}

export async function listOneDriveFiles(folderPath?: string) {
  const ep = folderPath
    ? `/me/drive/root:/${folderPath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}:/children`
    : '/me/drive/root/children';
  return (
    await graphGet<{ value?: unknown[] }>(ep, {
      $top: 100,
      $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder',
      $orderby: 'name',
    })
  ).value || [];
}

export async function listOnenoteNotebooks() {
  return (await graphGet<{ value?: unknown[] }>('/me/onenote/notebooks', { $top: 25 })).value || [];
}

export async function listOnenoteSections(notebookId: string) {
  return (
    await graphGet<{ value?: unknown[] }>(`/me/onenote/notebooks/${encodeURIComponent(notebookId)}/sections`, {
      $top: 25,
    })
  ).value || [];
}

export async function listOnenotePages(sectionId: string) {
  return (
    await graphGet<{ value?: unknown[] }>(`/me/onenote/sections/${encodeURIComponent(sectionId)}/pages`, {
      $top: 25,
    })
  ).value || [];
}

export async function readOnenotePage(pageId: string) {
  const html = await graphGetText(`/me/onenote/pages/${encodeURIComponent(pageId)}/content`, 'text/html');
  return { id: pageId, contentText: stripHtml(html), contentHtml: html };
}

export async function createOnenotePage(sectionId: string, title: string, bodyHtmlOrText: string) {
  const res = await runMsGraphSkill([
    'onenote',
    '--create',
    title,
    '--section',
    sectionId,
    '--body',
    bodyHtmlOrText,
  ]);
  return { output: res.stdout.trim() };
}
