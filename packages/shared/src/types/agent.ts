import { z } from 'zod';

export type PendingActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface ToolTraceItem {
  id: string;
  toolName: string;
  skillCommand?: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error' | 'awaiting_approval';
  durationMs?: number;
  summary?: string;
}

export interface PendingAction {
  id: string;
  conversationId: string;
  toolName: string;
  title: string;
  targetDescription: string;
  args: Record<string, unknown>;
  previewText: string;
  status: PendingActionStatus;
  resultText?: string;
  createdAt: string;
}

export interface CitationItem {
  kind: 'transcript' | 'chat' | 'channel' | 'email' | 'file' | 'task' | 'copilot_insight';
  id: string;
  title: string;
  subtitle: string;
  snippet: string;
  timestamp?: string;
}

export interface AgentMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  toolTraces: ToolTraceItem[];
  citations: CitationItem[];
  pendingActions: PendingAction[];
  providerLabel?: string;
  createdAt: string;
}

export interface AgentConversation {
  id: string;
  title: string;
  playbookId?: string | null;
  isRunning?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const chatRequestSchema = z.object({
  conversationId: z.string().optional(),
  prompt: z.string().min(1),
  playbookId: z.string().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const confirmActionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  editedArgs: z.record(z.unknown()).optional(),
});

export type ConfirmActionRequest = z.infer<typeof confirmActionSchema>;

export type PlaybookId =
  | 'communication_email'
  | 'customer_research'
  | 'release_notes'
  | 'requirements_analysis';

export interface PlaybookDefinition {
  id: PlaybookId;
  title: string;
  description: string;
  badge: string;
  defaultPrompt: string;
}
