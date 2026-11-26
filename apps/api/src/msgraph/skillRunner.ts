import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from '../config/env.js';
import { getDb } from '../db/client.js';

const execFileAsync = promisify(execFile);

export function getSkillPaths() {
  const skillRoot = path.join(env.SKILLS_DIR, 'msgraph');
  return {
    skillRoot,
    skillMdPath: path.join(skillRoot, 'SKILL.md'),
    readmePath: path.join(skillRoot, 'README.md'),
    scriptPath: path.join(skillRoot, 'scripts', 'msgraph.js'),
  };
}

export function loadSkillMarkdown(): string {
  const { skillMdPath } = getSkillPaths();
  if (!fs.existsSync(skillMdPath)) return '';
  return fs.readFileSync(skillMdPath, 'utf8');
}

function recordSkillLog(command: string, durationMs: number, ok: boolean, errorMessage?: string): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO skill_logs (command, duration_ms, ok, error_message, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(command, durationMs, ok ? 1 : 0, errorMessage || null, new Date().toISOString());
  } catch {
    // Non-fatal logging
  }
}

export async function runMsGraphSkill(
  args: string[],
  timeoutMs = 30_000
): Promise<{ stdout: string; stderr: string; parsedJson?: unknown }> {
  const { scriptPath } = getSkillPaths();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`msgraph skill script not found at ${scriptPath}`);
  }

  const commandLabel = `msgraph ${args.join(' ')}`.slice(0, 200);
  const started = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: env.MSGRAPH_HOME,
      },
    });
    const durationMs = Date.now() - started;
    recordSkillLog(commandLabel, durationMs, true);

    let parsedJson: unknown;
    if (args.includes('--json')) {
      try {
        parsedJson = JSON.parse(stdout);
      } catch {
        // Text fallback if CLI printed non-JSON message
      }
    }
    return { stdout, stderr, parsedJson };
  } catch (err) {
    const durationMs = Date.now() - started;
    const error = err as Error & { stdout?: string; stderr?: string };
    const message = (error.stderr || error.message || 'Unknown skill error').trim();
    recordSkillLog(commandLabel, durationMs, false, message.slice(0, 400));
    throw new Error(message);
  }
}

export function getSkillInspectorInfo() {
  const paths = getSkillPaths();
  const db = getDb();
  const recentLogs = db
    .prepare('SELECT id, command, duration_ms, ok, error_message, created_at FROM skill_logs ORDER BY id DESC LIMIT 20')
    .all();

  return {
    skillName: 'msgraph',
    skillExists: fs.existsSync(paths.skillMdPath) && fs.existsSync(paths.scriptPath),
    skillMdPath: paths.skillMdPath,
    scriptPath: paths.scriptPath,
    tokenCachePath: env.TOKEN_CACHE_PATH,
    callbackPort: env.MSGRAPH_CALLBACK_PORT,
    recentLogs,
  };
}
