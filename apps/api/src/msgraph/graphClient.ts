import { GRAPH_BETA_BASE, GRAPH_V1_BASE } from './constants.js';
import { getValidToken, refreshAccessToken } from './authManager.js';

export class GraphApiError extends Error {
  statusCode: number;
  responseBody: string;
  url: string;

  constructor(statusCode: number, responseBody: string, url: string) {
    super(`Microsoft Graph HTTP ${statusCode}: ${responseBody.slice(0, 240)}`);
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.url = url;
  }
}

export function stripHtml(input: string | undefined | null): string {
  return (input || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildGraphUrl(endpoint: string, params?: Record<string, string | number | undefined>, beta = false): string {
  if (endpoint.startsWith('https://')) return endpoint;
  const base = beta ? GRAPH_BETA_BASE : GRAPH_V1_BASE;
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${base}${normalized}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

async function rawGraphRequest(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: string | Uint8Array;
  } = {},
  attempt = 0,
  refreshedAfter401 = false
): Promise<Response> {
  const token = refreshedAfter401
    ? (await refreshAccessToken(true)) || (await getValidToken())
    : await getValidToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody as BodyInit;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body,
  });

  if (res.status === 401 && !refreshedAfter401) {
    return rawGraphRequest(url, options, attempt, true);
  }

  if ((res.status === 429 || res.status === 503) && attempt < 3) {
    const retryAfterHeader = res.headers.get('retry-after');
    const retrySec = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
    const waitMs = Number.isFinite(retrySec) && retrySec > 0
      ? Math.min(30_000, retrySec * 1000)
      : Math.min(15_000, 2 ** attempt * 1500);
    await new Promise((r) => setTimeout(r, waitMs));
    return rawGraphRequest(url, options, attempt + 1, refreshedAfter401);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new GraphApiError(res.status, errText, url);
  }

  return res;
}

export async function graphGet<T = Record<string, unknown>>(
  endpoint: string,
  params?: Record<string, string | number | undefined>,
  beta = false,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const url = buildGraphUrl(endpoint, params, beta);
  const res = await rawGraphRequest(url, extraHeaders ? { headers: extraHeaders } : {});
  return (await res.json()) as T;
}

export async function graphGetText(
  endpoint: string,
  accept = 'text/plain',
  beta = false
): Promise<string> {
  const url = buildGraphUrl(endpoint, undefined, beta);
  const res = await rawGraphRequest(url, { headers: { Accept: accept } });
  return res.text();
}

export async function graphGetAll<T = Record<string, unknown>>(
  endpoint: string,
  params?: Record<string, string | number | undefined>,
  maxItems = 250,
  beta = false
): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | undefined = buildGraphUrl(endpoint, params, beta);

  while (nextUrl && items.length < maxItems) {
    const page: { value?: T[]; '@odata.nextLink'?: string } = await graphGet<{
      value?: T[];
      '@odata.nextLink'?: string;
    }>(nextUrl);
    items.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  return items.slice(0, maxItems);
}

export async function graphPost<T = Record<string, unknown>>(
  endpoint: string,
  body: unknown,
  headers?: Record<string, string>,
  beta = false
): Promise<T> {
  const url = buildGraphUrl(endpoint, undefined, beta);
  const res = await rawGraphRequest(url, { method: 'POST', body, headers });
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function graphPatch<T = Record<string, unknown>>(
  endpoint: string,
  body: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const url = buildGraphUrl(endpoint);
  const res = await rawGraphRequest(url, { method: 'PATCH', body, headers });
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function graphPut<T = Record<string, unknown>>(
  endpoint: string,
  rawBody: string | Uint8Array,
  contentType = 'application/octet-stream',
  headers?: Record<string, string>
): Promise<T> {
  const url = buildGraphUrl(endpoint);
  const res = await rawGraphRequest(url, {
    method: 'PUT',
    rawBody,
    headers: { 'Content-Type': contentType, ...headers },
  });
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function graphDelete(
  endpoint: string,
  headers?: Record<string, string>
): Promise<void> {
  const url = buildGraphUrl(endpoint);
  await rawGraphRequest(url, { method: 'DELETE', headers });
}
