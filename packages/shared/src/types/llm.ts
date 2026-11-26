import { z } from 'zod';

export const llmProviderEnum = z.enum(['dial', 'copilot']);
export type LlmProviderType = z.infer<typeof llmProviderEnum>;

export const agentLlmModeEnum = z.enum(['agent_sdk', 'claude_sdk', 'normal']);
export type AgentLlmMode = z.infer<typeof agentLlmModeEnum>;

export const copilotTransportEnum = z.enum(['auto', 'github_models', 'copilot_api']);
export type CopilotTransport = z.infer<typeof copilotTransportEnum>;

export const approvalPolicyEnum = z.enum([
  'ask_external',
  'draft_only',
  'autonomous',
]);
export type ApprovalPolicy = z.infer<typeof approvalPolicyEnum>;

export interface LlmSettingsPublic {
  provider: LlmProviderType;
  agentMode: AgentLlmMode;
  approvalPolicy: ApprovalPolicy;
  maxSteps: number;
  temperature: number;
  dial: {
    azureEndpoint: string;
    apiVersion: string;
    chatModelName: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
  };
  copilot: {
    model: string;
    transport: CopilotTransport;
    hasGithubPat: boolean;
    githubPatMasked: string;
    hasCopilotSdkPat: boolean;
    copilotSdkPatMasked: string;
  };
}

export const updateLlmSettingsSchema = z.object({
  provider: llmProviderEnum,
  agentMode: agentLlmModeEnum.optional(),
  approvalPolicy: approvalPolicyEnum.optional(),
  maxSteps: z.number().int().min(1).max(25).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  dial: z
    .object({
      azureEndpoint: z.string().url().optional(),
      apiVersion: z.string().min(1).optional(),
      chatModelName: z.string().min(1).optional(),
      apiKey: z.string().optional(),
    })
    .optional(),
  copilot: z
    .object({
      model: z.string().min(1).optional(),
      transport: copilotTransportEnum.optional(),
      githubPat: z.string().optional(),
      copilotSdkPat: z.string().optional(),
    })
    .optional(),
});

export type UpdateLlmSettingsRequest = z.infer<typeof updateLlmSettingsSchema>;

export interface LlmTestResult {
  ok: boolean;
  provider: LlmProviderType;
  model: string;
  latencyMs: number;
  supportsTools: boolean;
  message: string;
}
