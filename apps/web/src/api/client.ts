export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(parsed.error || `Request failed (${res.status})`),
      parsed.code ? String(parsed.code) : undefined
    );
  }
  return parsed as T;
}

export async function streamSsePost<TEvent>(
  path: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try {
      msg = (JSON.parse(errText) as { error?: string }).error || errText;
    } catch {
      // keep raw text
    }
    throw new ApiError(res.status, msg);
  }

  if (!res.body) throw new Error('Empty stream response');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        try {
          onEvent(JSON.parse(jsonStr) as TEvent);
        } catch {
          // skip malformed chunk
        }
      }
    }
  }
}
