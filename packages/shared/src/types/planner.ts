export type PlannerTaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type PlannerTaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type PlannerSourceType = 'manual' | 'agent' | 'meeting' | 'm365_import';

export interface PlannerChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface PlannerBoard {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerTask {
  id: string;
  boardId: string;
  title: string;
  description: string;
  status: PlannerTaskStatus;
  priority: PlannerTaskPriority;
  dueDate: string | null;
  tags: string[];
  assignee: string;
  checklist: PlannerChecklistItem[];
  sourceType: PlannerSourceType;
  sourceId: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerStats {
  total: number;
  todo: number;
  inProgress: number;
  review: number;
  done: number;
  overdue: number;
}
