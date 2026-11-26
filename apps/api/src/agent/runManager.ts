interface ActiveRun {
  runId: string;
  controller: AbortController;
  startedAt: string;
}

const activeRuns = new Map<string, ActiveRun>();

export function registerConversationRun(conversationId: string, runId: string): AbortController {
  const existing = activeRuns.get(conversationId);
  if (existing) {
    existing.controller.abort();
  }
  const controller = new AbortController();
  activeRuns.set(conversationId, {
    runId,
    controller,
    startedAt: new Date().toISOString(),
  });
  return controller;
}

export function unregisterConversationRun(conversationId: string, runId: string): void {
  const current = activeRuns.get(conversationId);
  if (current && current.runId === runId) {
    activeRuns.delete(conversationId);
  }
}

export function stopConversationRun(conversationId: string): boolean {
  const current = activeRuns.get(conversationId);
  if (!current) return false;
  current.controller.abort();
  return true;
}

export function isConversationRunning(conversationId: string): boolean {
  return activeRuns.has(conversationId);
}
