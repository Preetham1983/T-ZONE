import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AuthStatusResponse, StartLoginResponse, TokenClaimsSummary } from '@tzone/shared';
import { env } from '../config/env.js';
import {
  GRAPH_V1_BASE,
  MSGRAPH_AUTH_URL,
  MSGRAPH_CLIENT_ID,
  MSGRAPH_SCOPES,
  MSGRAPH_TOKEN_URL,
} from './constants.js';

interface TokenCache {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  username?: string;
}

interface PendingPkceSession {
  verifier: string;
  state: string;
  redirectUri: string;
  expiresAtMs: number;
  server?: http.Server;
}

export class AuthRequiredError extends Error {
  statusCode = 401;
  constructor(message = 'Microsoft Graph authentication required. Please sign in.') {
    super(message);
  }
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
let activePkceSession: PendingPkceSession | null = null;
let cachedProfile: { upn: string; displayName: string; id: string } | null = null;

export function loadTokenCache(): TokenCache | null {
  if (!fs.existsSync(env.TOKEN_CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(env.TOKEN_CACHE_PATH, 'utf8')) as TokenCache;
  } catch {
    return null;
  }
}

export function saveTokenCache(cache: TokenCache): void {
  fs.writeFileSync(env.TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

export function clearTokenCache(): void {
  cachedProfile = null;
  if (fs.existsSync(env.TOKEN_CACHE_PATH)) {
    fs.unlinkSync(env.TOKEN_CACHE_PATH);
  }
}

export function decodeJwtClaims(accessToken: string): TokenClaimsSummary | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;
    const iat = typeof payload.iat === 'number' ? payload.iat : 0;
    const amr = Array.isArray(payload.amr)
      ? payload.amr.map(String)
      : typeof payload.amr === 'string'
        ? payload.amr.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const scopes = typeof payload.scp === 'string'
      ? payload.scp.split(' ').filter(Boolean).sort()
      : [];

    return {
      upn: String(payload.upn || payload.unique_name || ''),
      objectId: String(payload.oid || ''),
      tenantId: String(payload.tid || ''),
      issuedAt: iat ? new Date(iat * 1000).toISOString() : '',
      expiresAt: exp ? new Date(exp * 1000).toISOString() : '',
      expiresInMinutes: exp ? Math.floor((exp - now) / 60) : 0,
      deviceId: (payload.deviceid || payload.device_id || null) as string | null,
      joinType: (payload.join_type || null) as string | null,
      mdmUrl: (payload.mdm_compliance_url || null) as string | null,
      authMethods: amr,
      scopes,
    };
  } catch {
    return null;
  }
}

async function oauthPost(params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(MSGRAPH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export async function refreshAccessToken(force = false): Promise<string | null> {
  const cache = loadTokenCache();
  if (!cache?.access_token) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!force && cache.expires_at && now < cache.expires_at - 60) {
    return cache.access_token;
  }

  if (!cache.refresh_token) {
    return !cache.expires_at || now < cache.expires_at ? cache.access_token : null;
  }

  try {
    const res = await oauthPost({
      client_id: MSGRAPH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: cache.refresh_token,
      scope: MSGRAPH_SCOPES,
    });
    if (typeof res.access_token === 'string') {
      const expiresIn = typeof res.expires_in === 'number' ? res.expires_in : 3600;
      saveTokenCache({
        access_token: res.access_token,
        refresh_token: (res.refresh_token as string) || cache.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        username: cache.username || '',
      });
      return res.access_token;
    }
  } catch {
    return null;
  }
  return null;
}

export async function getValidToken(): Promise<string> {
  const token = await refreshAccessToken(false);
  if (!token) throw new AuthRequiredError();
  return token;
}

async function fetchProfile(token: string): Promise<{ upn: string; displayName: string; id: string }> {
  const res = await fetch(`${GRAPH_V1_BASE}/me?$select=userPrincipalName,displayName,id`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch /me (${res.status})`);
  }
  const me = (await res.json()) as { userPrincipalName?: string; displayName?: string; id?: string };
  const profile = {
    upn: me.userPrincipalName || '',
    displayName: me.displayName || me.userPrincipalName || 'Microsoft User',
    id: me.id || '',
  };
  cachedProfile = profile;
  return profile;
}

async function exchangeAuthCode(code: string, session: PendingPkceSession): Promise<{ username: string; displayName: string }> {
  const tokens = await oauthPost({
    client_id: MSGRAPH_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: session.redirectUri,
    code_verifier: session.verifier,
    scope: MSGRAPH_SCOPES,
  });

  if (typeof tokens.access_token !== 'string') {
    throw new Error('Token exchange succeeded without access_token.');
  }

  const profile = await fetchProfile(tokens.access_token);
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600;

  saveTokenCache({
    access_token: tokens.access_token,
    refresh_token: (tokens.refresh_token as string) || '',
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    username: profile.upn,
  });

  return { username: profile.upn, displayName: profile.displayName };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function closeActivePkceSession(): void {
  if (!activePkceSession) return;
  try {
    activePkceSession.server?.close();
  } catch {
    // Ignore close errors
  }
  activePkceSession = null;
}

export async function startPkceLogin(forcePrompt = false): Promise<StartLoginResponse> {
  closeActivePkceSession();

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const port = env.MSGRAPH_CALLBACK_PORT;
  const redirectUri = `http://localhost:${port}`;

  const session: PendingPkceSession = {
    verifier,
    state,
    redirectUri,
    expiresAtMs: Date.now() + LOGIN_TIMEOUT_MS,
  };

  // Bind 0.0.0.0 inside Docker so host loopback forwarding (127.0.0.1:8484 -> container:8484) reaches it.
  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', redirectUri);
      const code = reqUrl.searchParams.get('code');
      const returnedState = reqUrl.searchParams.get('state');
      const error = reqUrl.searchParams.get('error');
      const desc = reqUrl.searchParams.get('error_description');

      if (!code && !error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:36px">
          <h2 style="color:#b91c1c">Authentication Failed</h2>
          <p><strong>${escapeHtml(error)}</strong>: ${escapeHtml(desc || '')}</p>
        </body></html>`);
        closeActivePkceSession();
        return;
      }

      if (returnedState !== session.state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>State mismatch — login aborted.</h2>');
        closeActivePkceSession();
        return;
      }

      const result = await exchangeAuthCode(code!, session);
      const payloadJson = JSON.stringify({
        type: 'TZONE_MSGRAPH_AUTH_OK',
        username: result.username,
        displayName: result.displayName,
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>T-ZONE Login Successful</title></head>
        <body style="font-family:sans-serif;padding:40px;max-width:520px;margin:auto">
          <h2 style="color:#047857">&#10003; Signed in to T-ZONE</h2>
          <p>Authenticated as <strong>${escapeHtml(result.displayName)}</strong> (${escapeHtml(result.username)}).</p>
          <p style="color:#6b7280">You can close this window and return to T-ZONE.</p>
          <script>
            try { window.opener && window.opener.postMessage(${payloadJson}, '*'); } catch {}
            setTimeout(() => window.close(), 700);
          </script>
        </body></html>`, () => closeActivePkceSession());
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h2 style="color:#b91c1c">Token Exchange Error</h2><p>${escapeHtml((err as Error).message)}</p>`);
      closeActivePkceSession();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });

  const timeout = setTimeout(() => {
    if (activePkceSession === session) {
      closeActivePkceSession();
    }
  }, LOGIN_TIMEOUT_MS);
  timeout.unref();

  session.server = server;
  activePkceSession = session;

  const authParams = new URLSearchParams({
    client_id: MSGRAPH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: MSGRAPH_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: forcePrompt ? 'login' : 'select_account',
  });

  return {
    authUrl: `${MSGRAPH_AUTH_URL}?${authParams.toString()}`,
    redirectUri,
    state,
    expiresInSeconds: Math.floor(LOGIN_TIMEOUT_MS / 1000),
  };
}

export async function completeLoginFromUrl(redirectedUrl: string): Promise<{ username: string; displayName: string }> {
  if (!activePkceSession || Date.now() > activePkceSession.expiresAtMs) {
    throw new Error('No active login session. Click "Sign in with Microsoft" first.');
  }
  const url = new URL(redirectedUrl);
  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description');
    throw new Error(`Microsoft auth error: ${error}${desc ? ` — ${desc}` : ''}`);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) throw new Error('Missing ?code= parameter in redirected URL.');
  if (state !== activePkceSession.state) throw new Error('State mismatch in redirected URL.');

  const result = await exchangeAuthCode(code, activePkceSession);
  closeActivePkceSession();
  return result;
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const cache = loadTokenCache();
  if (!cache?.access_token) {
    return {
      state: 'NOT_LOGGED_IN',
      username: null,
      displayName: null,
      userId: null,
      cacheFile: env.TOKEN_CACHE_PATH,
      callbackPort: env.MSGRAPH_CALLBACK_PORT,
      claims: null,
    };
  }

  const validToken = await refreshAccessToken(false);
  if (!validToken) {
    return {
      state: 'TOKEN_EXPIRED',
      username: cache.username || null,
      displayName: null,
      userId: null,
      cacheFile: env.TOKEN_CACHE_PATH,
      callbackPort: env.MSGRAPH_CALLBACK_PORT,
      claims: decodeJwtClaims(cache.access_token),
    };
  }

  const updated = loadTokenCache() || cache;
  const claims = decodeJwtClaims(validToken);

  if (!cachedProfile || (claims?.upn && cachedProfile.upn !== claims.upn)) {
    try {
      await fetchProfile(validToken);
    } catch {
      // Non-fatal; claims still identify the user
    }
  }

  return {
    state: 'LOGGED_IN',
    username: updated.username || claims?.upn || cachedProfile?.upn || null,
    displayName: cachedProfile?.displayName || updated.username || null,
    userId: cachedProfile?.id || claims?.objectId || null,
    cacheFile: env.TOKEN_CACHE_PATH,
    callbackPort: env.MSGRAPH_CALLBACK_PORT,
    claims,
  };
}
