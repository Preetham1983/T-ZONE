import crypto from 'node:crypto';
import type { AgentMessage, CitationItem, PendingAction, ToolTraceItem } from '@tzone/shared';
import {
  addMessage,
  createConversation,
  getConversationMessages,
  touchConversation,
} from '../db/repositories.js';
import { runLlmCompletion, type ChatMessagePayload } from '../llm/provider.js';
import { getLlmRuntimeConfig } from '../llm/settingsStore.js';
import { getAuthStatus } from '../msgraph/authManager.js';
import { buildAgentSystemPrompt } from './systemPrompt.js';
import { getAllToolDefinitions, getToolMeta, runRegisteredTool } from './toolRegistry.js';

export type AgentSseEvent =
  | { type: 'meta'; conversationId: string; userMessageId: string; assistantMessageId: string }
  | { type: 'status'; text: string }
  | { type: 'tool_start'; trace: ToolTraceItem }
  | { type: 'tool_end'; trace: ToolTraceItem }
  | { type: 'pending_action'; action: PendingAction }
  | { type: 'token'; delta: string }
  | { type: 'done'; message: AgentMessage }
  | { type: 'error'; message: string };

export async function runAgentTurn(
  input: { conversationId?: string; prompt: string; playbookId?: string },
  emit: (event: AgentSseEvent) => void
): Promise<void> {
  const cfg = getLlmRuntimeConfig();
  const auth = await getAuthStatus();

  const conversation = input.conversationId
    ? { id: input.conversationId }
    : createConversation(input.prompt.slice(0, 72), input.playbookId || null);

  if (input.conversationId) {
    touchConversation(input.conversationId);
  }

  const userMsgId = crypto.randomUUID();
  const assistantMsgId = crypto.randomUUID();
  const now = new Date().toISOString();

  addMessage({
    id: userMsgId,
    conversationId: conversation.id,
    role: 'user',
    content: input.prompt,
    toolTraces: [],
    citations: [],
    createdAt: now,
  });

  emit({
    type: 'meta',
    conversationId: conversation.id,
    userMessageId: userMsgId,
    assistantMessageId: assistantMsgId,
  });

  const history = getConversationMessages(conversation.id);
  const llmMessages: ChatMessagePayload[] = [
    {
      role: 'system',
      content: buildAgentSystemPrompt({ displayName: auth.displayName, username: auth.username }),
    },
    ...history.slice(-14).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const tools = getAllToolDefinitions();
  const toolTraces: ToolTraceItem[] = [];
  const citations: CitationItem[] = [];
  const pendingActions: PendingAction[] = [];

  let finalContent = '';
  let providerLabel: string = cfg.provider;

  try {
    for (let step = 0; step < cfg.maxSteps; step++) {
      emit({ type: 'status', text: step === 0 ? 'Thinking & checking Microsoft 365...' : `Synthesizing step ${step + 1}...` });

      let streamedText = '';
      const completion = await runLlmCompletion({
        configOverride: cfg,
        messages: llmMessages,
        tools,
        stream: true,
        onToken: (delta) => {
          streamedText += delta;
          emit({ type: 'token', delta });
        },
      });

      providerLabel = completion.providerLabel;

      if (completion.toolCalls.length === 0) {
        finalContent = completion.content || streamedText;
        break;
      }

      llmMessages.push({
        role: 'assistant',
        content: completion.content || null,
        tool_calls: completion.toolCalls,
      });

      for (const tc of completion.toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }

        const meta = getToolMeta(tc.function.name);
        const trace: ToolTraceItem = {
          id: tc.id,
          toolName: tc.function.name,
          skillCommand: meta?.skillCommand,
          args: parsedArgs,
          status: 'running',
        };
        toolTraces.push(trace);
        emit({ type: 'tool_start', trace });

        const t0 = Date.now();
        let toolOutput: unknown;
        try {
          const outcome = await runRegisteredTool(tc.function.name, parsedArgs, {
            conversationId: conversation.id,
            messageId: assistantMsgId,
            approvalPolicy: cfg.approvalPolicy,
            citations,
            pendingActions,
          });
          trace.durationMs = Date.now() - t0;
          if (outcome.status === 'awaiting_approval') {
            trace.status = 'awaiting_approval';
            trace.summary = 'Paused for user approval';
            const latestAction = pendingActions[pendingActions.length - 1];
            if (latestAction) emit({ type: 'pending_action', action: latestAction });
          } else {
            trace.status = 'success';
            trace.summary = outcome.status === 'blocked' ? 'Blocked by policy' : 'Completed';
          }
          toolOutput = outcome.data;
        } catch (err) {
          trace.durationMs = Date.now() - t0;
          trace.status = 'error';
          trace.summary = (err as Error).message.slice(0, 120);
          toolOutput = { error: (err as Error).message };
        }

        emit({ type: 'tool_end', trace: { ...trace } });

        const serialized = JSON.stringify(toolOutput);
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: serialized.length > 18_000 ? `${serialized.slice(0, 18_000)}... [truncated]` : serialized,
        });
      }
    }

    if (!finalContent) {
      finalContent = pendingActions.length
        ? 'I prepared the requested action below. Please review and approve or edit it before execution.'
        : 'Completed tool execution.';
      emit({ type: 'token', delta: finalContent });
    }

    // Deduplicate citations by kind+id
    const seenCitations = new Set<string>();
    const uniqueCitations = citations.filter((c) => {
      const k = `${c.kind}:${c.id}`;
      if (seenCitations.has(k)) return false;
      seenCitations.add(k);
      return true;
    });

    const assistantMsg: AgentMessage = {
      id: assistantMsgId,
      conversationId: conversation.id,
      role: 'assistant',
      content: finalContent,
      toolTraces,
      citations: uniqueCitations,
      pendingActions,
      providerLabel,
      createdAt: new Date().toISOString(),
    };

    addMessage(assistantMsg);
    emit({ type: 'done', message: assistantMsg });
  } catch (err) {
    const errMsg = (err as Error).message || 'Agent execution error';
    emit({ type: 'error', message: errMsg });
  }
}
