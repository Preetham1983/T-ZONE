import type { LlmTestResult } from '@tzone/shared';
import { getLlmRuntimeConfig, type LlmRuntimeConfig } from './settingsStore.js';

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface CompletionResponse {
  content: string;
  toolCalls: ChatToolCall[];
  modelUsed: string;
}

let cachedCopilotSession: { token: string; expiresAt: number; patHash: string } | null = null;

async function resolveCopilotApiBearer(pat: string): Promise<string | null> {
  if (!pat) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedCopilotSession && cachedCopilotSession.patHash === pat.slice(-8) && now < cachedCopilotSession.expiresAt - 60) {
    return cachedCopilotSession.token;
  }

  const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: {
      Authorization: `token ${pat}`,
      Accept: 'application/json',
      'User-Agent': 'T-ZONE-Agent/1.0',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string; expires_at?: number };
  if (!data.token) return null;
  cachedCopilotSession = {
    token: data.token,
    expiresAt: data.expires_at || now + 1500,
    patHash: pat.slice(-8),
  };
  return data.token;
}

async function resolveTargetEndpoint(
  cfg: LlmRuntimeConfig
): Promise<{ url: string; headers: Record<string, string>; model: string; providerLabel: string }> {
  if (cfg.provider === 'dial') {
    if (!cfg.dial.apiKey) {
      throw new Error('EPAM DIAL API key is not configured. Open LLM Settings to add it.');
    }
    const base = cfg.dial.azureEndpoint.replace(/\/+$/, '');
    const model = cfg.dial.chatModelName;
    const url = `${base}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(cfg.dial.apiVersion)}`;
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'api-key': cfg.dial.apiKey,
        'Api-Key': cfg.dial.apiKey,
      },
      model,
      providerLabel: `DIAL · ${model}`,
    };
  }

  const pat = cfg.copilot.copilotSdkPat || cfg.copilot.githubPat;
  if (!pat) {
    throw new Error('GitHub PAT / Copilot SDK PAT is not configured. Open LLM Settings to add it.');
  }

  const model = cfg.copilot.model;
  if (cfg.copilot.transport !== 'github_models') {
    const copilotToken = await resolveCopilotApiBearer(pat);
    if (copilotToken) {
      return {
        url: 'https://api.githubcopilot.com/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${copilotToken}`,
          'Editor-Version': 'vscode/1.98.0',
          'Copilot-Integration-Id': 'vscode-chat',
        },
        model,
        providerLabel: `Copilot (${cfg.agentMode}) · ${model}`,
      };
    }
    if (cfg.copilot.transport === 'copilot_api') {
      throw new Error('Could not exchange PAT for a GitHub Copilot session token. Try GitHub Models transport or verify Copilot access.');
    }
  }

  return {
    url: 'https://models.github.ai/inference/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pat}`,
    },
    model,
    providerLabel: `GitHub Models · ${model}`,
  };
}

async function consumeOpenAiSseStream(
  res: Response,
  onToken?: (delta: string) => void
): Promise<{ content: string; toolCalls: ChatToolCall[] }> {
  if (!res.body) {
    throw new Error('Empty response body from LLM stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let parsed: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        onToken?.(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const prev = toolAcc.get(idx) || { id: tc.id || `call_${idx}`, name: '', arguments: '' };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.arguments += tc.function.arguments;
          toolAcc.set(idx, prev);
        }
      }
    }
  }

  const toolCalls: ChatToolCall[] = Array.from(toolAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments || '{}' },
    }));

  return { content, toolCalls };
}

export async function runLlmCompletion(options: {
  messages: ChatMessagePayload[];
  tools?: ChatToolDefinition[];
  stream?: boolean;
  onToken?: (delta: string) => void;
  configOverride?: LlmRuntimeConfig;
}): Promise<CompletionResponse & { providerLabel: string }> {
  const cfg = options.configOverride || getLlmRuntimeConfig();
  const target = await resolveTargetEndpoint(cfg);
  const useStream = options.stream ?? Boolean(options.onToken);

  const body: Record<string, unknown> = {
    model: target.model,
    messages: options.messages,
    temperature: cfg.temperature,
    stream: useStream,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(target.url, {
    method: 'POST',
    headers: target.headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM request failed (${res.status}) [${target.providerLabel}]: ${errText.slice(0, 320)}`);
  }

  if (useStream) {
    const streamed = await consumeOpenAiSseStream(res, options.onToken);
    return { ...streamed, modelUsed: target.model, providerLabel: target.providerLabel };
  }

  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ChatToolCall[];
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  return {
    content: msg?.content || '',
    toolCalls: msg?.tool_calls || [],
    modelUsed: target.model,
    providerLabel: target.providerLabel,
  };
}

export async function testLlmConnection(configOverride?: LlmRuntimeConfig): Promise<LlmTestResult> {
  const cfg = configOverride || getLlmRuntimeConfig();
  const started = Date.now();
  const model = cfg.provider === 'dial' ? cfg.dial.chatModelName : cfg.copilot.model;

  try {
    const res = await runLlmCompletion({
      configOverride: cfg,
      stream: false,
      messages: [
        { role: 'system', content: 'Respond concisely with "OK".' },
        { role: 'user', content: 'Health check.' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'ping',
            description: 'Diagnostic ping tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    });
    return {
      ok: true,
      provider: cfg.provider,
      model: res.modelUsed,
      latencyMs: Date.now() - started,
      supportsTools: true,
      message: `Connected (${res.providerLabel}). Response received in ${Date.now() - started}ms.`,
    };
  } catch (err) {
    return {
      ok: false,
      provider: cfg.provider,
      model,
      latencyMs: Date.now() - started,
      supportsTools: false,
      message: (err as Error).message,
    };
  }
}
