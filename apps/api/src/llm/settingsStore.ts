import type {
  AgentLlmMode,
  ApprovalPolicy,
  CopilotTransport,
  LlmProviderType,
  LlmSettingsPublic,
  UpdateLlmSettingsRequest,
} from '@tzone/shared';
import { env } from '../config/env.js';
import { getSetting, setSetting } from '../db/repositories.js';

export interface LlmRuntimeConfig {
  provider: LlmProviderType;
  agentMode: AgentLlmMode;
  approvalPolicy: ApprovalPolicy;
  maxSteps: number;
  temperature: number;
  dial: {
    azureEndpoint: string;
    apiVersion: string;
    chatModelName: string;
    apiKey: string;
  };
  copilot: {
    model: string;
    transport: CopilotTransport;
    githubPat: string;
    copilotSdkPat: string;
  };
}

const SETTINGS_KEY = 'llm_settings';

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 10) return '••••••••';
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

function buildEnvDefaultConfig(): LlmRuntimeConfig {
  return {
    provider: env.LLM_PROVIDER,
    agentMode: env.SS_AGENT_LLM_MODE,
    approvalPolicy: 'ask_external',
    maxSteps: 12,
    temperature: 0.2,
    dial: {
      azureEndpoint: env.AZURE_ENDPOINT,
      apiVersion: env.API_VERSION,
      chatModelName: env.CHAT_MODEL_NAME,
      apiKey: env.EPAM_DIAL_API_KEY || env.KADB_EPAM_DIAL_API_KEY,
    },
    copilot: {
      model: env.COPILOT_MODEL,
      transport: env.COPILOT_TRANSPORT,
      githubPat: env.GITHUB_PAT,
      copilotSdkPat: env.COPILOT_SDK_PAT,
    },
  };
}

export function getLlmRuntimeConfig(): LlmRuntimeConfig {
  const defaults = buildEnvDefaultConfig();
  const stored = getSetting<Partial<LlmRuntimeConfig>>(SETTINGS_KEY);
  if (!stored) {
    setSetting(SETTINGS_KEY, defaults);
    return defaults;
  }

  return {
    provider: stored.provider || defaults.provider,
    agentMode: stored.agentMode || defaults.agentMode,
    approvalPolicy: stored.approvalPolicy || defaults.approvalPolicy,
    maxSteps: stored.maxSteps ?? defaults.maxSteps,
    temperature: stored.temperature ?? defaults.temperature,
    dial: {
      azureEndpoint: stored.dial?.azureEndpoint || defaults.dial.azureEndpoint,
      apiVersion: stored.dial?.apiVersion || defaults.dial.apiVersion,
      chatModelName: stored.dial?.chatModelName || defaults.dial.chatModelName,
      apiKey: stored.dial?.apiKey ?? defaults.dial.apiKey,
    },
    copilot: {
      model: stored.copilot?.model || defaults.copilot.model,
      transport: stored.copilot?.transport || defaults.copilot.transport,
      githubPat: stored.copilot?.githubPat ?? defaults.copilot.githubPat,
      copilotSdkPat: stored.copilot?.copilotSdkPat ?? defaults.copilot.copilotSdkPat,
    },
  };
}

export function toPublicLlmSettings(cfg: LlmRuntimeConfig): LlmSettingsPublic {
  return {
    provider: cfg.provider,
    agentMode: cfg.agentMode,
    approvalPolicy: cfg.approvalPolicy,
    maxSteps: cfg.maxSteps,
    temperature: cfg.temperature,
    dial: {
      azureEndpoint: cfg.dial.azureEndpoint,
      apiVersion: cfg.dial.apiVersion,
      chatModelName: cfg.dial.chatModelName,
      hasApiKey: Boolean(cfg.dial.apiKey),
      apiKeyMasked: maskSecret(cfg.dial.apiKey),
    },
    copilot: {
      model: cfg.copilot.model,
      transport: cfg.copilot.transport,
      hasGithubPat: Boolean(cfg.copilot.githubPat),
      githubPatMasked: maskSecret(cfg.copilot.githubPat),
      hasCopilotSdkPat: Boolean(cfg.copilot.copilotSdkPat),
      copilotSdkPatMasked: maskSecret(cfg.copilot.copilotSdkPat),
    },
  };
}

export function updateLlmRuntimeConfig(patch: UpdateLlmSettingsRequest): LlmSettingsPublic {
  const current = getLlmRuntimeConfig();
  const next: LlmRuntimeConfig = {
    provider: patch.provider,
    agentMode: patch.agentMode ?? current.agentMode,
    approvalPolicy: patch.approvalPolicy ?? current.approvalPolicy,
    maxSteps: patch.maxSteps ?? current.maxSteps,
    temperature: patch.temperature ?? current.temperature,
    dial: {
      azureEndpoint: patch.dial?.azureEndpoint ?? current.dial.azureEndpoint,
      apiVersion: patch.dial?.apiVersion ?? current.dial.apiVersion,
      chatModelName: patch.dial?.chatModelName ?? current.dial.chatModelName,
      apiKey:
        patch.dial?.apiKey && patch.dial.apiKey.trim() !== '' && !patch.dial.apiKey.includes('••••')
          ? patch.dial.apiKey.trim()
          : current.dial.apiKey,
    },
    copilot: {
      model: patch.copilot?.model ?? current.copilot.model,
      transport: patch.copilot?.transport ?? current.copilot.transport,
      githubPat:
        patch.copilot?.githubPat && patch.copilot.githubPat.trim() !== '' && !patch.copilot.githubPat.includes('••••')
          ? patch.copilot.githubPat.trim()
          : current.copilot.githubPat,
      copilotSdkPat:
        patch.copilot?.copilotSdkPat &&
        patch.copilot.copilotSdkPat.trim() !== '' &&
        !patch.copilot.copilotSdkPat.includes('••••')
          ? patch.copilot.copilotSdkPat.trim()
          : current.copilot.copilotSdkPat,
    },
  };

  setSetting(SETTINGS_KEY, next);
  return toPublicLlmSettings(next);
}
