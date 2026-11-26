import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentLlmMode,
  ApprovalPolicy,
  CopilotTransport,
  LlmProviderType,
  LlmSettingsPublic,
  LlmTestResult,
} from '@tzone/shared';
import { CheckCircle2, Cpu, Eye, EyeOff, Shield, Terminal, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client.js';

interface SkillInfoResponse {
  skillName: string;
  skillExists: boolean;
  skillMdPath: string;
  scriptPath: string;
  tokenCachePath: string;
  callbackPort: number;
  recentLogs: Array<{
    id: number;
    command: string;
    duration_ms: number;
    ok: number;
    error_message: string | null;
    created_at: string;
  }>;
}

export function SettingsScreen() {
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['llm-settings'],
    queryFn: () => apiFetch<LlmSettingsPublic>('/api/settings/llm'),
  });

  const { data: skillInfo } = useQuery({
    queryKey: ['skill-inspector'],
    queryFn: () => apiFetch<SkillInfoResponse>('/api/skills/msgraph'),
  });

  const [provider, setProvider] = useState<LlmProviderType>('dial');
  const [agentMode, setAgentMode] = useState<AgentLlmMode>('agent_sdk');
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('ask_external');
  const [maxSteps, setMaxSteps] = useState(12);
  const [temperature, setTemperature] = useState(0.2);

  const [azureEndpoint, setAzureEndpoint] = useState('https://ai-proxy.lab.epam.com');
  const [apiVersion, setApiVersion] = useState('2024-02-01');
  const [chatModelName, setChatModelName] = useState('gpt-4.1-mini-2025-04-14');
  const [dialApiKey, setDialApiKey] = useState('');

  const [copilotModel, setCopilotModel] = useState('gpt-4.1');
  const [copilotTransport, setCopilotTransport] = useState<CopilotTransport>('auto');
  const [githubPat, setGithubPat] = useState('');
  const [copilotSdkPat, setCopilotSdkPat] = useState('');

  const [showSecrets, setShowSecrets] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setAgentMode(settings.agentMode);
    setApprovalPolicy(settings.approvalPolicy);
    setMaxSteps(settings.maxSteps);
    setTemperature(settings.temperature);
    setAzureEndpoint(settings.dial.azureEndpoint);
    setApiVersion(settings.dial.apiVersion);
    setChatModelName(settings.dial.chatModelName);
    setDialApiKey(settings.dial.apiKeyMasked || '');
    setCopilotModel(settings.copilot.model);
    setCopilotTransport(settings.copilot.transport);
    setGithubPat(settings.copilot.githubPatMasked || '');
    setCopilotSdkPat(settings.copilot.copilotSdkPatMasked || '');
  }, [settings]);

  const buildPayload = () => ({
    provider,
    agentMode,
    approvalPolicy,
    maxSteps: Number(maxSteps),
    temperature: Number(temperature),
    dial: {
      azureEndpoint,
      apiVersion,
      chatModelName,
      apiKey: dialApiKey,
    },
    copilot: {
      model: copilotModel,
      transport: copilotTransport,
      githubPat,
      copilotSdkPat,
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<LlmSettingsPublic>('/api/settings/llm', {
        method: 'PUT',
        body: JSON.stringify(buildPayload()),
      }),
    onSuccess: () => {
      setSavedNotice('Settings saved and applied live!');
      qc.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: (err) => setSavedNotice(`Error: ${(err as Error).message}`),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiFetch<LlmTestResult>('/api/settings/llm/test', {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      }),
    onSuccess: (res) => setTestResult(res),
  });

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LLM Provider Configurator */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-blue-600" />
              <h1 className="text-base font-bold text-slate-900">LLM Provider &amp; Model Configurator</h1>
            </div>
            <button
              onClick={() => setShowSecrets(!showSecrets)}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {showSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showSecrets ? 'Hide Keys' : 'Reveal Input'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setProvider('dial')}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                provider === 'dial'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Profile B: EPAM DIAL / Azure OpenAI
            </button>
            <button
              onClick={() => setProvider('copilot')}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                provider === 'copilot'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Profile A: GitHub Copilot
            </button>
          </div>

          {provider === 'dial' ? (
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-mono font-semibold text-slate-600 mb-1">AZURE_ENDPOINT</label>
                <input
                  value={azureEndpoint}
                  onChange={(e) => setAzureEndpoint(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono font-semibold text-slate-600 mb-1">CHAT_MODEL_NAME</label>
                  <input
                    value={chatModelName}
                    onChange={(e) => setChatModelName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-mono font-semibold text-slate-600 mb-1">API_VERSION</label>
                  <input
                    value={apiVersion}
                    onChange={(e) => setApiVersion(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-mono font-semibold text-slate-600 mb-1">
                  EPAM_DIAL_API_KEY (masked when loaded from server)
                </label>
                <input
                  type={showSecrets ? 'text' : 'password'}
                  value={dialApiKey}
                  onChange={(e) => setDialApiKey(e.target.value)}
                  placeholder="dial-..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono font-semibold text-slate-600 mb-1">SS_AGENT_LLM_MODE</label>
                  <select
                    value={agentMode}
                    onChange={(e) => setAgentMode(e.target.value as AgentLlmMode)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  >
                    <option value="agent_sdk">agent_sdk (Copilot)</option>
                    <option value="claude_sdk">claude_sdk</option>
                    <option value="normal">normal</option>
                  </select>
                </div>
                <div>
                  <label className="block font-mono font-semibold text-slate-600 mb-1">COPILOT_TRANSPORT</label>
                  <select
                    value={copilotTransport}
                    onChange={(e) => setCopilotTransport(e.target.value as CopilotTransport)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  >
                    <option value="auto">auto (Copilot API → GitHub Models)</option>
                    <option value="copilot_api">copilot_api</option>
                    <option value="github_models">github_models</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-mono font-semibold text-slate-600 mb-1">COPILOT_MODEL</label>
                <input
                  value={copilotModel}
                  onChange={(e) => setCopilotModel(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono font-semibold text-slate-600 mb-1">GITHUB_PAT</label>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={githubPat}
                    onChange={(e) => setGithubPat(e.target.value)}
                    placeholder="ghp_..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-mono font-semibold text-slate-600 mb-1">COPILOT_SDK_PAT</label>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={copilotSdkPat}
                    onChange={(e) => setCopilotSdkPat(e.target.value)}
                    placeholder="ghp_..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save & Apply Live'}
            </button>
            <button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {testMutation.isPending ? 'Testing...' : 'Test Connection'}
            </button>
            {savedNotice && <span className="text-xs text-emerald-700 font-medium">{savedNotice}</span>}
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                testResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              {testResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
              <div>
                <strong>{testResult.ok ? 'Success' : 'Failed'}:</strong> {testResult.message}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Safety Policy & Skill Inspector */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3 text-xs">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Shield className="h-4 w-4 text-amber-600" />
              Agent Safety &amp; Reasoning Policy
            </div>
            <div>
              <label className="block font-mono font-semibold text-slate-600 mb-1">WRITE APPROVAL MODE</label>
              <select
                value={approvalPolicy}
                onChange={(e) => setApprovalPolicy(e.target.value as ApprovalPolicy)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="ask_external">Ask confirmation before Teams sends / emails / invites (Recommended)</option>
                <option value="draft_only">Draft-only safe mode (emails → Drafts, block Teams sends)</option>
                <option value="autonomous">Autonomous (execute all tool calls immediately)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono font-semibold text-slate-600 mb-1">MAX TOOL STEPS</label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block font-mono font-semibold text-slate-600 mb-1">TEMPERATURE</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={1.5}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Terminal className="h-4 w-4 text-emerald-600" />
                msgraph Skill Inspector
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold ${
                  skillInfo?.skillExists ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                }`}
              >
                {skillInfo?.skillExists ? 'ACTIVE' : 'MISSING'}
              </span>
            </div>

            {skillInfo && (
              <div className="space-y-1 font-mono text-[11px] text-slate-600">
                <div className="truncate">SKILL.md: {skillInfo.skillMdPath}</div>
                <div className="truncate">CLI: {skillInfo.scriptPath}</div>
                <div className="truncate">Cache: {skillInfo.tokenCachePath}</div>
                <div>PKCE Callback Port: {skillInfo.callbackPort}</div>
              </div>
            )}

            <div className="border-t border-slate-100 pt-2">
              <div className="font-semibold text-slate-700 mb-1.5">Recent Skill Invocations</div>
              <div className="max-h-40 overflow-y-auto space-y-1 font-mono text-[10.5px]">
                {skillInfo?.recentLogs.length === 0 && <div className="text-slate-400">No CLI invocations yet.</div>}
                {skillInfo?.recentLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
                    <span className="truncate text-slate-700">
                      {log.ok ? '✓' : '✕'} {log.command}
                    </span>
                    <span className="shrink-0 text-slate-400">{log.duration_ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
