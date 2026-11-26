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
import { registerConversationRun, unregisterConversationRun } from './runManager.js';
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
  | { type: 'stopped'; message: AgentMessage }
  | { type: 'error'; message: string };

function isAbortError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
}

function dedupeCitations(citations: CitationItem[]): CitationItem[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const k = `${c.kind}:${c.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function runAgentTurn(
  input: {
    conversationId?: string;
    prompt: string;
    playbookId?: string;
    systemContextExtra?: string;
  },
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

  const controller = registerConversationRun(conversation.id, assistantMsgId);
  const { signal } = controller;

  emit({
    type: 'meta',
    conversationId: conversation.id,
    userMessageId: userMsgId,
    assistantMessageId: assistantMsgId,
  });

  const basePrompt = buildAgentSystemPrompt({ displayName: auth.displayName, username: auth.username });
  const systemPrompt = input.systemContextExtra
    ? `${basePrompt}\n\n---\n${input.systemContextExtra}`
    : basePrompt;

  const history = getConversationMessages(conversation.id);
  const llmMessages: ChatMessagePayload[] = [
    {
      role: 'system',
      content: systemPrompt,
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
  let partialStreamed = '';
  let providerLabel: string = cfg.provider;

  const persistAssistant = (contentText: string): AgentMessage => {
    const assistantMsg: AgentMessage = {
      id: assistantMsgId,
      conversationId: conversation.id,
      role: 'assistant',
      content: contentText,
      toolTraces,
      citations: dedupeCitations(citations),
      pendingActions,
      providerLabel,
      createdAt: new Date().toISOString(),
    };
    addMessage(assistantMsg);
    return assistantMsg;
  };

  try {
    for (let step = 0; step < cfg.maxSteps; step++) {
      if (signal.aborted) break;

      emit({
        type: 'status',
        text: step === 0 ? 'Thinking & checking Microsoft 365...' : `Synthesizing step ${step + 1}...`,
      });

      let stepStreamed = '';
      const completion = await runLlmCompletion({
        configOverride: cfg,
        messages: llmMessages,
        tools,
        stream: true,
        signal,
        onToken: (delta) => {
          if (signal.aborted) return;
          stepStreamed += delta;
          partialStreamed += delta;
          emit({ type: 'token', delta });
        },
      });

      providerLabel = completion.providerLabel;

      if (signal.aborted) break;

      if (completion.toolCalls.length === 0) {
        finalContent = completion.content || stepStreamed;
        break;
      }

      llmMessages.push({
        role: 'assistant',
        content: completion.content || null,
        tool_calls: completion.toolCalls,
      });

      for (const tc of completion.toolCalls) {
        if (signal.aborted) break;

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
        if (signal.aborted) break;

        const serialized = JSON.stringify(toolOutput);
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: serialized.length > 18_000 ? `${serialized.slice(0, 18_000)}... [truncated]` : serialized,
        });
      }
    }

    if (signal.aborted) {
      for (const t of toolTraces) {
        if (t.status === 'running') {
          t.status = 'error';
          t.summary = 'Stopped by user';
        }
      }
      const stoppedText = partialStreamed.trim()
        ? `${partialStreamed.trim()}\n\n*— Stopped by user.*`
        : '*Generation stopped by user.*';
      const stoppedMsg = persistAssistant(stoppedText);
      emit({ type: 'stopped', message: stoppedMsg });
      return;
    }

    if (!finalContent) {
      finalContent = pendingActions.length
        ? 'I prepared the requested action below. Please review and approve or edit it before execution.'
        : 'Completed tool execution.';
      emit({ type: 'token', delta: finalContent });
    }

    const assistantMsg = persistAssistant(finalContent);
    emit({ type: 'done', message: assistantMsg });
  } catch (err) {
    if (isAbortError(err, signal)) {
      for (const t of toolTraces) {
        if (t.status === 'running') {
          t.status = 'error';
          t.summary = 'Stopped by user';
        }
      }
      const stoppedText = partialStreamed.trim()
        ? `${partialStreamed.trim()}\n\n*— Stopped by user.*`
        : '*Generation stopped by user.*';
      const stoppedMsg = persistAssistant(stoppedText);
      emit({ type: 'stopped', message: stoppedMsg });
      return;
    }
    const errMsg = (err as Error).message || 'Agent execution error';
    emit({ type: 'error', message: errMsg });
  } finally {
    unregisterConversationRun(conversation.id, assistantMsgId);
  }
}
