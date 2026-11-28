import type { FastifyInstance } from 'fastify';
import type { PlannerTaskPriority, PlannerTaskStatus } from '@tzone/shared';
import {
  createPlannerBoard,
  createPlannerTaskRecord,
  deletePlannerTaskRecord,
  getPlannerStats,
  listPlannerBoards,
  listPlannerTasks,
  updatePlannerTaskRecord,
} from '../db/plannerRepository.js';

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'tzone_planner_list_boards',
    description: 'List all T-ZONE Planner boards and task counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tzone_planner_create_board',
    description: 'Create a new T-ZONE Planner board.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        color: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'tzone_planner_list_tasks',
    description: 'List tasks from T-ZONE Planner with optional board, status, priority, or search filters.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        search: { type: 'string' },
      },
    },
  },
  {
    name: 'tzone_planner_create_task',
    description: 'Create a new task in T-ZONE Planner.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        boardId: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        tags: { type: 'array', items: { type: 'string' } },
        assignee: { type: 'string' },
        checklist: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
  {
    name: 'tzone_planner_update_task',
    description: 'Update an existing T-ZONE Planner task (status, title, description, priority, dueDate, tags).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        dueDate: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        assignee: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'tzone_planner_delete_task',
    description: 'Delete a task from T-ZONE Planner by taskId.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
];

function executeMcpTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'tzone_planner_list_boards':
      return { boards: listPlannerBoards(), stats: getPlannerStats() };
    case 'tzone_planner_create_board':
      return createPlannerBoard({
        name: String(args.name || ''),
        description: args.description ? String(args.description) : undefined,
        color: args.color ? String(args.color) : undefined,
      });
    case 'tzone_planner_list_tasks':
      return listPlannerTasks({
        boardId: args.boardId ? String(args.boardId) : undefined,
        status: args.status as PlannerTaskStatus | undefined,
        priority: args.priority as PlannerTaskPriority | undefined,
        search: args.search ? String(args.search) : undefined,
      });
    case 'tzone_planner_create_task':
      return createPlannerTaskRecord({
        title: String(args.title || ''),
        description: args.description ? String(args.description) : undefined,
        boardId: args.boardId ? String(args.boardId) : undefined,
        status: args.status as PlannerTaskStatus | undefined,
        priority: args.priority as PlannerTaskPriority | undefined,
        dueDate: args.dueDate ? String(args.dueDate) : undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        assignee: args.assignee ? String(args.assignee) : undefined,
        checklist: Array.isArray(args.checklist) ? args.checklist.map(String) : undefined,
        sourceType: 'agent',
      });
    case 'tzone_planner_update_task':
      return updatePlannerTaskRecord(String(args.taskId), {
        title: args.title !== undefined ? String(args.title) : undefined,
        description: args.description !== undefined ? String(args.description) : undefined,
        status: args.status as PlannerTaskStatus | undefined,
        priority: args.priority as PlannerTaskPriority | undefined,
        dueDate: args.dueDate !== undefined ? (args.dueDate ? String(args.dueDate) : null) : undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        assignee: args.assignee !== undefined ? String(args.assignee) : undefined,
      });
    case 'tzone_planner_delete_task':
      return deletePlannerTaskRecord(String(args.taskId));
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mcp', async () => ({
    name: 'tzone-planner-mcp',
    version: '1.0.0',
    protocol: 'MCP JSON-RPC 2.0 over HTTP POST /api/mcp',
    tools: MCP_TOOLS.map((t) => t.name),
  }));

  app.post<{
    Body: {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };
  }>('/api/mcp', async (req) => {
    const id = req.body?.id ?? null;
    const method = req.body?.method || '';
    const params = req.body?.params || {};

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'tzone-planner-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          },
        };
      }

      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: MCP_TOOLS },
        };
      }

      if (method === 'tools/call') {
        const toolName = String(params.name || '');
        const toolArgs = (params.arguments as Record<string, unknown>) || {};
        const data = executeMcpTool(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unsupported MCP method: ${method}` },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: (err as Error).message },
      };
    }
  });
}
