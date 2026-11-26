import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatusResponse, LlmSettingsPublic, StartLoginResponse } from '@tzone/shared';
import { CheckCircle2, ExternalLink, KeyRound, LogOut, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAppStore } from '../../stores/appStore.js';

export function AuthScreen() {
  const qc = useQueryClient();
  const { setScreen } = useAppStore();
  const [pastedUrl, setPastedUrl] = useState('');
  const [authBanner, setAuthBanner] = useState<string | null>(null);
  const [waitingPopup, setWaitingPopup] = useState(false);

  const { data: auth, refetch } = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch<AuthStatusResponse>('/api/auth/status'),
    refetchInterval: waitingPopup ? 2000 : false,
  });

  const { data: llm } = useQuery({
    queryKey: ['llm-settings'],
    queryFn: () => apiFetch<LlmSettingsPublic>('/api/settings/llm'),
  });

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'TZONE_MSGRAPH_AUTH_OK') {
        setWaitingPopup(false);
        setAuthBanner(`Signed in cleanly as ${e.data.displayName || e.data.username}`);
        qc.invalidateQueries({ queryKey: ['auth-status'] });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [qc]);

  useEffect(() => {
    if (waitingPopup && auth?.state === 'LOGGED_IN') {
      setWaitingPopup(false);
    }
  }, [waitingPopup, auth?.state]);

  const startLogin = useMutation({
    mutationFn: (force: boolean) =>
      apiFetch<StartLoginResponse>('/api/auth/login/start', {
        method: 'POST',
        body: JSON.stringify({ force }),
      }),
    onSuccess: (res) => {
      setWaitingPopup(true);
      setAuthBanner(`Opened Microsoft sign-in popup (callback: ${res.redirectUri}). Complete sign-in in the popup window.`);
      window.open(res.authUrl, 'tzone_msgraph_auth', 'width=560,height=720');
    },
    onError: (err) => setAuthBanner((err as Error).message),
  });

  const completeUrl = useMutation({
    mutationFn: (redirectedUrl: string) =>
      apiFetch('/api/auth/login/complete-url', {
        method: 'POST',
        body: JSON.stringify({ redirectedUrl }),
      }),
    onSuccess: () => {
      setPastedUrl('');
      setWaitingPopup(false);
      setAuthBanner('Completed PKCE token exchange from pasted callback URL!');
      refetch();
    },
    onError: (err) => setAuthBanner((err as Error).message),
  });

  const logout = useMutation({
    mutationFn: () => apiFetch('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      setWaitingPopup(false);
      setAuthBanner('Cleared cached Microsoft Graph credentials.');
      qc.invalidateQueries({ queryKey: ['auth-status'] });
    },
  });

  const isAuthed = auth?.state === 'LOGGED_IN';

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Microsoft 365 PKCE Onboarding</h1>
            <p className="text-sm text-slate-600">
              Authenticates directly via the <code className="rounded bg-slate-200 px-1 text-xs">msgraph</code> PKCE flow so Intune / Enterprise SSO device claims pass cleanly into Docker.
            </p>
          </div>
          {isAuthed && (
            <button
              onClick={() => setScreen('chat')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Launch Agent →
            </button>
          )}
        </div>

        {authBanner && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {authBanner}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Card: Login Flow */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
            <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
              <div>
                <div className="flex items-center gap-2">
                  {isAuthed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <TriangleAlert className="h-5 w-5 text-amber-600" />
                  )}
                  <span className="font-semibold text-slate-900">
                    {isAuthed
                      ? `Authenticated as ${auth?.displayName || auth?.username}`
                      : auth?.state === 'TOKEN_EXPIRED'
                        ? 'Session Expired — Re-authenticate'
                        : 'Not Signed In'}
                  </span>
                </div>
                <p className="mt-1 text-xs font-mono text-slate-500">
                  {auth?.username || 'No cached account'} · Callback Port {auth?.callbackPort ?? 8484} · Cache: {auth?.cacheFile}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-mono font-semibold ${
                  isAuthed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {auth?.state || 'CHECKING'}
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => startLogin.mutate(false)}
                disabled={startLogin.isPending}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                Sign in with Microsoft
                <ExternalLink className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => startLogin.mutate(true)}
                disabled={startLogin.isPending}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-4 w-4" />
                Force Re-auth (--force)
              </button>

              {isAuthed && (
                <button
                  onClick={() => logout.mutate()}
                  className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              )}
            </div>

            {startLogin.data?.authUrl && waitingPopup && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
                <div className="font-semibold text-slate-800">Popup blocked? Open this URL manually:</div>
                <a
                  href={startLogin.data.authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all font-mono text-blue-600 underline"
                >
                  {startLogin.data.authUrl}
                </a>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Remote Docker Fallback (Paste Redirect URL)
              </div>
              <p className="text-xs text-slate-600">
                If your browser redirects to <code className="font-mono">http://localhost:8484/?code=...</code> on a host that cannot reach the container port, paste the full browser URL below:
              </p>
              <div className="flex gap-2">
                <input
                  value={pastedUrl}
                  onChange={(e) => setPastedUrl(e.target.value)}
                  placeholder="http://localhost:8484/?code=0.AXEA...&state=..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono"
                />
                <button
                  onClick={() => completeUrl.mutate(pastedUrl)}
                  disabled={!pastedUrl.trim() || completeUrl.isPending}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Complete Login
                </button>
              </div>
            </div>
          </div>

          {/* Right Card: Claims & LLM Readiness */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <ShieldCheck className="h-4 w-4 text-blue-600" />
                Token Claims &amp; Scopes (<code className="font-mono text-xs">claims</code>)
              </div>
              {auth?.claims ? (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-1.5 font-mono">
                    <span className="text-slate-500">UPN:</span>
                    <span className="col-span-2 truncate text-slate-900">{auth.claims.upn || 'N/A'}</span>
                    <span className="text-slate-500">Device ID:</span>
                    <span className={`col-span-2 ${auth.claims.deviceId ? 'text-emerald-700 font-semibold' : 'text-amber-700'}`}>
                      {auth.claims.deviceId ? `✓ ${auth.claims.deviceId}` : 'Not present'}
                    </span>
                    <span className="text-slate-500">Join Type:</span>
                    <span className="col-span-2 text-slate-800">{auth.claims.joinType || 'N/A'}</span>
                    <span className="text-slate-500">Expires In:</span>
                    <span className="col-span-2 text-slate-800">{auth.claims.expiresInMinutes} min</span>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700 mb-1.5">
                      Granted Scopes ({auth.claims.scopes.length})
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto">
                      {auth.claims.scopes.map((s) => (
                        <span
                          key={s}
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-700"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Sign in first to inspect JWT identity, device claims, and scopes.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">Configured LLM Provider</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-mono font-semibold text-blue-700 uppercase">
                  {llm?.provider || 'dial'}
                </span>
              </div>
              <p className="text-xs font-mono text-slate-600">
                {llm?.provider === 'copilot'
                  ? `Model: ${llm.copilot.model} (${llm.copilot.hasCopilotSdkPat || llm.copilot.hasGithubPat ? 'PAT configured' : 'Missing PAT'})`
                  : `${llm?.dial.azureEndpoint} · ${llm?.dial.chatModelName}`}
              </p>
              <button
                onClick={() => setScreen('settings')}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Configure DIAL / GitHub Copilot
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
