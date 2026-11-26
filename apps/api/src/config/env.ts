import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const rootEnvPath = path.join(REPO_ROOT, '.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(8000),
  MSGRAPH_CALLBACK_PORT: z.coerce.number().int().positive().default(8484),
  DATA_DIR: z.string().default(path.join(REPO_ROOT, 'data')),
  MSGRAPH_HOME: z.string().optional(),
  SKILLS_DIR: z.string().default(path.join(REPO_ROOT, 'skills')),
  LLM_PROVIDER: z.enum(['dial', 'copilot']).default('dial'),
  SS_AGENT_LLM_MODE: z.enum(['agent_sdk', 'claude_sdk', 'normal']).default('agent_sdk'),
  GITHUB_PAT: z.string().default(''),
  COPILOT_SDK_PAT: z.string().default(''),
  COPILOT_MODEL: z.string().default('gpt-4.1'),
  COPILOT_TRANSPORT: z.enum(['auto', 'github_models', 'copilot_api']).default('auto'),
  EPAM_DIAL_API_KEY: z.string().default(''),
  KADB_EPAM_DIAL_API_KEY: z.string().default(''),
  AZURE_ENDPOINT: z.string().default('https://ai-proxy.lab.epam.com'),
  API_VERSION: z.string().default('2024-02-01'),
  CHAT_MODEL_NAME: z.string().default('gpt-4.1-mini-2025-04-14'),
});

const parsed = envSchema.parse(process.env);

const resolvedDataDir = path.resolve(parsed.DATA_DIR);
fs.mkdirSync(resolvedDataDir, { recursive: true });

const resolvedMsGraphHome = parsed.MSGRAPH_HOME
  ? path.resolve(parsed.MSGRAPH_HOME)
  : os.homedir();
fs.mkdirSync(resolvedMsGraphHome, { recursive: true });

export const env = {
  ...parsed,
  REPO_ROOT,
  DATA_DIR: resolvedDataDir,
  MSGRAPH_HOME: resolvedMsGraphHome,
  SKILLS_DIR: path.resolve(parsed.SKILLS_DIR),
  DB_PATH: path.join(resolvedDataDir, 'tzone.db'),
  TOKEN_CACHE_PATH: path.join(resolvedMsGraphHome, '.ms_graph_token_cache.json'),
};
