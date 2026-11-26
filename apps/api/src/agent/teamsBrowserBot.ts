import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import type { GuestBotPhase, GuestBotState, VoiceReplyMode } from '@tzone/shared';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { getMeetingMission } from '../db/repositories.js';
import { getAuthStatus } from '../msgraph/authManager.js';
import {
  appendMeetingUtterance,
  buildMissionContextPrompt,
  joinMeetingMission,
  postToMeetingTeamsChat,
} from './meetingAgentService.js';
import { runAgentTurn } from './orchestrator.js';

const PIPER_BIN = '/opt/piper/piper';
const PIPER_MODEL = '/opt/voices/en_US-lessac-medium.onnx';

interface CaptionEntryState {
  speaker: string;
  lastText: string;
  committedText: string;
  lastChangedAt: number;
}

interface BotSession {
  missionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  state: GuestBotState;
  lastScreenshot: Buffer | null;
  watcherTimer: NodeJS.Timeout | null;
  captionsMap: Map<string, CaptionEntryState>;
  closing: boolean;
  captionAttempts: number;
  lastCaptionAttemptAt: number;
  answeringQuestion: boolean;
  currentlySpeaking: boolean;
  lastBotReplyEndedAt: number;
  recentBotUtterances: Array<{ text: string; at: number }>;
  hostDisplayName: string;
  lastWakeNormalized: string;
  lastWakeAt: number;
}

const activeBots = new Map<string, BotSession>();

export function detectTtsEngine(): 'piper_neural' | 'espeak' | 'none' {
  try {
    execFileSync('which', ['paplay'], { stdio: 'ignore' });
    const sources = execFileSync('pactl', ['list', 'sources', 'short'], {
      encoding: 'utf8',
      timeout: 2000,
    });
    if (!sources.includes('VirtualMic')) return 'none';
    if (fs.existsSync(PIPER_BIN) && fs.existsSync(PIPER_MODEL)) {
      return 'piper_neural';
    }
    execFileSync('which', ['espeak-ng'], { stdio: 'ignore' });
    return 'espeak';
  } catch {
    return 'none';
  }
}

export function detectVirtualAudioReady(): boolean {
  return detectTtsEngine() !== 'none';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractWakeQuery(rawText: string, botName = 'T-ZONE Agent'): string | null {
  const clean = rawText.trim();
  if (!clean || clean.length < 3) return null;

  const normalizedBot = botName.trim().toLowerCase();
  const brandTrigger =
    /(?:\b(?:hey|hi|hello|ok|okay|yo)?\s*,?\s*(?:t[-\s]?zone|tzone|tea\s+zone|tee\s+zone|tee[-\s]?zone)(?:\s+agent)?\b)/i;
  const leadingAgentTrigger =
    /^(?:hey|hi|hello|ok|okay|yo|excuse\s+me)?[\s,.:-]*(?:ai\s+)?(?:agent|assistant|bot)\b/i;

  let matched = brandTrigger.test(clean) || leadingAgentTrigger.test(clean);

  if (!matched && normalizedBot && !normalizedBot.includes('t-zone')) {
    const customRe = new RegExp(`\\b${escapeRegex(normalizedBot)}\\b`, 'i');
    if (customRe.test(clean)) matched = true;
  }

  if (!matched) return null;

  const stripped = clean
    .replace(brandTrigger, ' ')
    .replace(leadingAgentTrigger, ' ')
    .replace(/^[\s,.:;-]+/, '')
    .trim();

  if (!stripped || stripped.length < 3) {
    return 'Give a brief 1-sentence friendly greeting and confirm you are listening and ready to answer questions from the meeting notes.';
  }
  return stripped;
}

const FILLER_PHRASES = new Set([
  'ok',
  'okay',
  'yes',
  'yeah',
  'yep',
  'no',
  'nope',
  'thanks',
  'thank you',
  'got it',
  'sure',
  'right',
  'cool',
  'bye',
  'goodbye',
  'hello',
  'hi',
  'hey',
  'hm',
  'hmm',
  'uh',
  'um',
]);

export function detectConversationalQuestion(
  rawText: string,
  botName = 'T-ZONE Agent',
  mode: VoiceReplyMode = 'conversational',
  followUpActive = false
): string | null {
  const wake = extractWakeQuery(rawText, botName);
  if (wake) return wake;

  if (mode === 'wake_word' && !followUpActive) return null;

  const clean = rawText.trim();
  const strippedLower = clean.toLowerCase().replace(/[.!?,]+$/g, '').trim();
  const multiWordFiller =
    /^(?:ok|okay|yes|yeah|yep|sure|alright|cool|great|right|hm|hmm|uh|um|thanks|thank you|got it|all good|makes sense|no problem)(?:[\s,]+(?:thanks|thank you|got it|ok|okay|sure|alright|mate|bro))*$/i;
  if (!strippedLower || FILLER_PHRASES.has(strippedLower) || multiWordFiller.test(strippedLower)) {
    return null;
  }

  const wordCount = strippedLower.split(/\s+/).filter(Boolean).length;

  if (followUpActive && wordCount >= 3) {
    return clean;
  }

  // In conversational mode, respond naturally to direct questions or explicit requests
  const endsWithQuestion = clean.includes('?');
  const startsAsQuestionOrRequest =
    /^(?:what|why|how|who|whom|whose|when|where|which|can|could|would|will|did|do|does|is|are|was|were|have|has|tell|explain|check|summarize|summarise|list|give|find|show|read|any|recap|what's|how's|who's|when's|where's)\b/i.test(
      strippedLower
    );
  const referencesNotesOrContext =
    /\b(?:in the notes|from the notes|meeting notes|our notes|what did we|did we decide|any blockers|action items|what do you think)\b/i.test(
      strippedLower
    );

  if (endsWithQuestion || (wordCount >= 3 && (startsAsQuestionOrRequest || referencesNotesOrContext))) {
    return clean;
  }

  return null;
}

export function getSpeakerFirstName(speaker?: string, fallbackHostName?: string): string | null {
  const raw = (speaker || '').trim();
  const isGeneric =
    !raw ||
    /^(you|speaker|participant|meeting audio|unknown|guest)$/i.test(raw);
  const chosen = isGeneric ? (fallbackHostName || '').trim() : raw;
  if (!chosen) return null;
  const first = chosen.split(/\s+/)[0]?.replace(/[^a-zA-Z0-9'-]/g, '');
  return first && first.length >= 2 ? first : null;
}

export function isEchoOfBotSpeech(
  recentPhrases: Array<{ text: string; at: number }>,
  candidate: string,
  now = Date.now()
): boolean {
  const normCand = candidate.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!normCand || normCand.length < 6) return false;
  const candWords = normCand.split(/\s+/).filter((w) => w.length >= 3);
  if (candWords.length === 0) return false;

  for (const item of recentPhrases) {
    if (now - item.at > 25_000) continue;
    const normSpoken = item.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (!normSpoken) continue;
    if (normSpoken.includes(normCand) || normCand.includes(normSpoken)) return true;
    const spokenSet = new Set(normSpoken.split(/\s+/).filter((w) => w.length >= 3));
    const overlap = candWords.filter((w) => spokenSet.has(w)).length;
    if (candWords.length >= 3 && overlap / candWords.length >= 0.65) return true;
  }
  return false;
}

export function toSpokenPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[▶\s*([^\]]+)\]\([^)]*\)/g, 'at $1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/^\s*[-+•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyTeamsPageState(
  bodyText: string,
  signals: {
    url: string;
    hasNameInput: boolean;
    hasJoinButton: boolean;
    hasInMeetingControls: boolean;
  }
): GuestBotPhase {
  const lower = bodyText.toLowerCase();

  if (signals.hasInMeetingControls) {
    return 'in_meeting';
  }

  if (
    lower.includes('waiting in the lobby') ||
    lower.includes('let people in the meeting know') ||
    lower.includes('someone in the meeting should let you in') ||
    lower.includes('someone will let you in') ||
    lower.includes('waiting to be admitted') ||
    lower.includes("when the meeting starts, we'll let people know")
  ) {
    return 'waiting_in_lobby';
  }

  if (signals.hasNameInput) {
    return 'entering_name';
  }

  const looksLikeLoginUrl =
    signals.url.includes('login.microsoftonline.com') || signals.url.includes('login.live.com');
  const blockedPhrase =
    lower.includes('only people in this organization can join') ||
    lower.includes("you don't have permission to join") ||
    lower.includes('sign in to join this meeting') ||
    lower.includes('wait for someone from this org to start');

  if ((looksLikeLoginUrl || blockedPhrase) && !signals.hasJoinButton && !signals.hasNameInput) {
    return 'blocked_auth';
  }

  if (
    lower.includes('you left the meeting') ||
    lower.includes("you've been removed from the meeting") ||
    lower.includes('this meeting has ended')
  ) {
    return 'ended';
  }

  return 'opening_url';
}

function updateState(session: BotSession, patch: Partial<GuestBotState>): void {
  session.state = {
    ...session.state,
    ...patch,
    lastUpdatedAt: new Date().toISOString(),
  };
}

async function captureSnapshot(session: BotSession): Promise<void> {
  if (session.closing) return;
  try {
    const png = await session.page.screenshot({ type: 'png', animations: 'disabled' });
    session.lastScreenshot = png;
    session.state.hasScreenshot = true;
    session.state.lastUpdatedAt = new Date().toISOString();
  } catch {
    // Ignore transient navigation screenshot race
  }
}

async function clickFirstVisible(page: Page, selectors: string[], timeoutMs = 2500): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: timeoutMs })) {
        await loc.click({ timeout: timeoutMs });
        return true;
      }
    } catch {
      // Try next fallback selector
    }
  }
  return false;
}

async function dismissTeamsPreJoinDialogs(page: Page): Promise<boolean> {
  const modalDismissSelectors = [
    // Exact text from screenshot — highest priority
    'button:has-text("Continue without audio or video")',
    'button:has-text("Continue without audio or video ")',
    // Partial / aria-label variants
    'button:has-text("Continue without audio")',
    '[data-tid="continue-without-audio-video"]',
    'button[aria-label*="Continue without audio" i]',
    // Generic dialog close buttons
    'div[role="dialog"] button:has-text("Dismiss")',
    'div[role="dialog"] button:has-text("Got it")',
    'div[role="dialog"] button:has-text("OK")',
    // Catch-all: any visible modal "Continue" button
    'div[class*="modal" i] button:has-text("Continue")',
    '[role="dialog"] button:has-text("Continue")',
  ];
  let dismissedAny = false;
  for (const sel of modalDismissSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 250 })) {
        await btn.click({ timeout: 2000 });
        dismissedAny = true;
        await page.waitForTimeout(400);
      }
    } catch {
      // ignore if gone
    }
  }
  return dismissedAny;
}

async function setTeamsPreJoinMediaMuted(page: Page): Promise<boolean> {
  const isSwitchOn = async (loc: ReturnType<Page['locator']>) => {
    const label = ((await loc.getAttribute('aria-label')) || '').toLowerCase();
    const pressed = await loc.getAttribute('aria-pressed');
    const checked = await loc.getAttribute('aria-checked');
    const title = ((await loc.getAttribute('title')) || '').toLowerCase();
    if (pressed === 'true' && !label.includes('unmute') && !label.includes('turn camera on')) return true;
    if (checked === 'true') return true;
    if (label.includes('turn camera off') || label.includes('turn off camera')) return true;
    if (label.includes('mute mic') || title.includes('mute mic')) return true;
    return false;
  };

  // Turn camera off if active
  for (const sel of [
    '[data-tid="toggle-video"]',
    '[role="switch"][aria-label*="camera" i]',
    'button[aria-label*="camera" i]',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) {
        if (await isSwitchOn(btn)) {
          await btn.click({ timeout: 1500 });
        }
        break;
      }
    } catch {
      // ignore
    }
  }

  // Start microphone muted cleanly
  for (const sel of [
    '[data-tid="toggle-mute"]',
    '[role="switch"][aria-label*="mic" i]',
    'button[aria-label*="microphone" i]',
    'button[aria-label*="mic" i]',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) {
        if (await isSwitchOn(btn)) {
          await btn.click({ timeout: 1500 });
        }
        return true;
      }
    } catch {
      // ignore
    }
  }
  return true;
}

async function isMeetingMicMuted(page: Page): Promise<boolean> {
  const selectors = [
    '[data-tid="toggle-mute"]',
    'button#microphone-button',
    '[data-tid="microphone-button"]',
    'button[aria-label*="Unmute" i]:not([aria-label*="menu" i]):not([aria-label*="settings" i]):not([aria-label*="device" i])',
    'button[aria-label*="Mute" i]:not([aria-label*="menu" i]):not([aria-label*="settings" i]):not([aria-label*="device" i])',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (!(await btn.isVisible({ timeout: 500 }))) continue;
      const label = ((await btn.getAttribute('aria-label')) || '').toLowerCase();
      const title = ((await btn.getAttribute('title')) || '').toLowerCase();
      const combined = `${label} ${title}`;
      if (combined.includes('unmute')) return true;
      if (combined.includes('mute')) return false;
      const pressed = await btn.getAttribute('aria-pressed');
      if (pressed === 'true') return true;
      if (pressed === 'false') return false;
    } catch {
      // continue
    }
  }
  return true;
}

async function setInMeetingMicMuted(page: Page, desiredMuted: boolean): Promise<boolean> {
  const before = await isMeetingMicMuted(page);
  if (before === desiredMuted) return desiredMuted;

  const selectors = [
    'button[aria-label*="Unmute" i]:not([aria-label*="menu" i]):not([aria-label*="settings" i]):not([aria-label*="device" i])',
    'button[aria-label*="Mute" i]:not([aria-label*="menu" i]):not([aria-label*="settings" i]):not([aria-label*="device" i])',
    '[data-tid="toggle-mute"]',
    'button#microphone-button',
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (!(await btn.isVisible({ timeout: 1000 }))) continue;
      await btn.click({ timeout: 2000 });
      await page.waitForTimeout(300);
      const after = await isMeetingMicMuted(page);
      if (after === desiredMuted) return desiredMuted;
    } catch {
      // try next or shortcut
    }
  }

  // Reliable Teams Web keyboard shortcut Ctrl+Shift+M
  try {
    await page.keyboard.press('Control+Shift+m');
    await page.waitForTimeout(350);
  } catch {
    // ignore
  }
  return isMeetingMicMuted(page);
}

async function tryEnableLiveCaptions(session: BotSession): Promise<boolean> {
  if (session.state.captionsEnabled) return true;
  if (session.captionAttempts >= 5) return false;
  const now = Date.now();
  if (now - session.lastCaptionAttemptAt < 5000) return false;

  session.lastCaptionAttemptAt = now;
  session.captionAttempts += 1;

  const { page } = session;
  try {
    // Reveal toolbar if auto-hidden
    await page.mouse.move(480, 260).catch(() => {});
    await page.waitForTimeout(200);

    // Check if captions container is already active
    const alreadyActive = await page
      .locator('[data-tid="closed-caption-renderer-wrapper"], [data-tid="closed-captions-renderer"]')
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false);
    if (alreadyActive) {
      updateState(session, {
        phase: 'captions_active',
        captionsEnabled: true,
        statusMessage: 'In meeting · Teams Live Captions active',
      });
      return true;
    }

    const openedMore = await clickFirstVisible(
      page,
      [
        'button#callingButtons-showMoreBtn',
        'button[data-tid="callingButtons-showMoreBtn"]',
        '[data-tid="more-actions-button"]',
        'button[aria-label="More"]',
        'button[aria-label*="More actions" i]',
        'button:has-text("More")',
      ],
      2500
    );
    if (!openedMore) return false;
    await page.waitForTimeout(450);

    // Submenu path in Teams v2: Language and speech -> Turn on live captions
    await clickFirstVisible(
      page,
      [
        '[role="menuitem"]:has-text("Language and speech")',
        '[data-tid="Language and speech"]',
        'text="Language and speech"',
      ],
      1800
    );
    await page.waitForTimeout(450);

    const clickedCaptions = await clickFirstVisible(
      page,
      [
        '[data-tid="closed-caption"]',
        '[role="menuitem"]:has-text("Turn on live captions")',
        '[role="menuitem"]:has-text("Show live captions")',
        'li[aria-label*="live captions" i]',
        'div[aria-label*="Turn on live captions" i]',
        '[role="menuitem"]:has-text("Live captions")',
        'button:has-text("Turn on live captions")',
      ],
      2500
    );

    if (!clickedCaptions) {
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }

    await page.waitForTimeout(600);
    // Dismiss Teams spoken-language confirmation modal if prompted
    await clickFirstVisible(
      page,
      [
        'div[role="dialog"] button:has-text("Confirm")',
        'button:has-text("Confirm")',
        'div[role="dialog"] button:has-text("Turn on")',
      ],
      2000
    );

    updateState(session, {
      phase: 'captions_active',
      captionsEnabled: true,
      statusMessage: 'In meeting · Teams Live Captions active',
    });
    return true;
  } catch {
    return false;
  }
}

async function playTextToVirtualMic(session: BotSession, text: string): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) return;

  session.recentBotUtterances = [
    ...session.recentBotUtterances.filter((u) => Date.now() - u.at < 25_000),
    { text: cleanText, at: Date.now() },
  ];

  const runPiper = () =>
    new Promise<void>((resolve, reject) => {
      const tts = spawn(PIPER_BIN, [
        '--espeak_data', '/opt/piper/espeak-ng-data',
        '--model', PIPER_MODEL,
        '--output-raw',
      ]);
      const play = spawn('paplay', [
        '--raw',
        '--rate=22050',
        '--channels=1',
        '--format=s16le',
        '--device=VirtualSink',
      ]);
      tts.stdout.pipe(play.stdin);
      tts.stdin.write(`${cleanText}\n`);
      tts.stdin.end();

      let stderr = '';
      tts.stderr.on('data', (d) => {
        stderr += String(d);
      });
      play.stderr.on('data', (d) => {
        stderr += String(d);
      });
      tts.on('error', reject);
      play.on('error', reject);
      play.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Piper playback exited (${code}): ${stderr.slice(0, 180)}`));
      });
    });

  const runEspeak = () =>
    new Promise<void>((resolve, reject) => {
      const tts = spawn('espeak-ng', ['-s', '150', '-p', '46', '--stdout', cleanText]);
      const play = spawn('paplay', ['--device=VirtualSink']);
      tts.stdout.pipe(play.stdin);

      let stderr = '';
      tts.stderr.on('data', (d) => {
        stderr += String(d);
      });
      play.stderr.on('data', (d) => {
        stderr += String(d);
      });
      tts.on('error', reject);
      play.on('error', reject);
      play.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Audio playback exited (${code}): ${stderr.slice(0, 180)}`));
      });
    });

  if (session.state.ttsEngine === 'piper_neural') {
    try {
      await runPiper();
      return;
    } catch {
      // Fall back smoothly to espeak-ng
    }
  }
  await runEspeak();
}

export async function maybeTriggerSpokenReply(
  missionId: string,
  speaker: string,
  rawText: string,
  source: 'mic' | 'teams_bot' | 'manual'
): Promise<boolean> {
  const session = activeBots.get(missionId);
  if (!session || session.closing || !session.state.autoVoiceReply) return false;
  if (session.state.phase !== 'in_meeting' && session.state.phase !== 'captions_active') {
    return false;
  }
  if (!session.state.audioReady) return false;
  if (session.currentlySpeaking || session.answeringQuestion) return false;

  const cleanSpeaker = speaker.trim().toLowerCase();
  if (
    cleanSpeaker.includes(session.state.botName.toLowerCase()) ||
    cleanSpeaker.includes('(spoke)')
  ) {
    return false;
  }

  if (isEchoOfBotSpeech(session.recentBotUtterances, rawText)) {
    return false;
  }

  const followUpActive = Date.now() - session.lastBotReplyEndedAt < 25_000;
  const query = detectConversationalQuestion(
    rawText,
    session.state.botName,
    session.state.voiceMode,
    followUpActive
  );
  if (!query) return false;

  const normalized = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const now = Date.now();
  if (session.lastWakeNormalized === normalized && now - session.lastWakeAt < 14_000) {
    return false;
  }

  session.answeringQuestion = true;
  session.currentlySpeaking = true;
  session.lastWakeNormalized = normalized;
  session.lastWakeAt = now;

  const firstName = getSpeakerFirstName(speaker, session.hostDisplayName);
  const ackLine = firstName
    ? `Hey ${firstName}, give me a second while I check my notes and context on that.`
    : 'Sure, give me a second while I check my notes and context on that.';

  updateState(session, {
    statusMessage: `Acknowledging ${firstName || 'speaker'} & checking notes for "${query.slice(0, 40)}..."`,
  });

  try {
    const mission = getMeetingMission(missionId);
    if (!mission) return false;

    const micMutedState = await setInMeetingMicMuted(session.page, false);
    updateState(session, { micMuted: micMutedState });

    // Run immediate natural human acknowledgment IN PARALLEL with LLM research & note lookup
    const ackPromise = playTextToVirtualMic(session, ackLine).catch(() => {});

    let answerMarkdown = '';
    const llmPromise = runAgentTurn(
      {
        conversationId: mission.conversationId || undefined,
        prompt: `[Live Spoken Question from ${firstName || speaker} in the meeting (${source})]: ${query}

Strict Instructions for Spoken Reply:
1. First check our Current Rolling Meeting Notes, Live Captured Call Utterances, Pre-Call Research Brief, and Focus Topics. Also use search_tzone_index or M365 tools if the question relates to Teams, SharePoint, emails, calendar, or tasks.
2. CONTEXT BOUNDARY RULE: You MUST answer strictly from the meeting notes, live call context, or verified M365 workspace records. If the question is NOT related to our meeting context/notes (for example: general world trivia, weather, random unrelated topics, or things never mentioned or stored in M365), clearly state: "That isn't related to our meeting notes or context so far, so I don't have an answer for it in the notes."
3. Style: Speak naturally like a helpful teammate in 2 to 4 plain spoken sentences. Do not use markdown formatting, bullet points, asterisks, code ticks, or raw URLs.`,
        systemContextExtra: buildMissionContextPrompt(mission),
      },
      (ev) => {
        if (ev.type === 'done' || ev.type === 'stopped') {
          answerMarkdown = ev.message.content;
        }
      }
    );

    await Promise.all([ackPromise, llmPromise]);

    const spokenText = toSpokenPlainText(answerMarkdown).slice(0, 850);
    if (!spokenText) return false;

    updateState(session, { statusMessage: 'Speaking answer in Teams call...' });
    await playTextToVirtualMic(session, spokenText);

    await appendMeetingUtterance(missionId, {
      speaker: `${session.state.botName} (Spoke)`,
      text: spokenText,
      source: 'bot_voice',
      refreshNotes: false,
    });

    if (mission.autoRespondChat && mission.meetingChatId) {
      await postToMeetingTeamsChat(
        missionId,
        `**[T-ZONE · ${mission.roleTitle}]**\n\n${answerMarkdown.slice(0, 1800)}`
      ).catch(() => {});
    }

    session.lastBotReplyEndedAt = Date.now();
    updateState(session, {
      spokenCount: session.state.spokenCount + 1,
    });
    return true;
  } catch (err) {
    updateState(session, {
      error: (err as Error).message,
      statusMessage: `Voice answer error: ${(err as Error).message}`,
    });
    return false;
  } finally {
    session.currentlySpeaking = false;
    session.answeringQuestion = false;
    const finalMuted = await setInMeetingMicMuted(session.page, true);
    updateState(session, {
      micMuted: finalMuted,
      statusMessage: session.state.captionsEnabled
        ? 'In meeting · Teams Live Captions active'
        : 'In meeting',
    });
  }
}

async function pollVisibleCaptions(session: BotSession): Promise<void> {
  if (session.closing) return;
  try {
    const items = await session.page.evaluate(() => {
      const selectors = [
        '[data-tid="closed-caption-renderer-wrapper"]',
        '[data-tid="closed-captions-renderer"]',
        '[role="region"][aria-label*="caption" i]',
        '[data-tid="caption-item"]',
      ];
      const extracted: Array<{ key: string; speaker: string; text: string }> = [];

      const lineNodes = document.querySelectorAll(
        '[data-tid="caption-item"], [data-tid="closed-caption-item"], [data-tid="closed-caption-renderer-wrapper"] [data-tid], [data-tid="closed-captions-renderer"] > div > div'
      );
      if (lineNodes.length > 0) {
        lineNodes.forEach((node, idx) => {
          const speakerEl = node.querySelector(
            '[data-tid="caption-speaker"], [data-tid="author"], .caption-speaker-name, span[class*="author"]'
          );
          const textEl = node.querySelector(
            '[data-tid="caption-text"], [data-tid="message-body"], .caption-text-span, span[class*="captionText"]'
          );
          const speaker = (speakerEl?.textContent || '').trim() || 'Participant';
          const text = (textEl?.textContent || node.textContent || '').trim();
          if (text && text !== speaker) {
            extracted.push({ key: `${speaker}:${idx}`, speaker, text });
          }
        });
        if (extracted.length > 0) return extracted;
      }

      for (const sel of selectors) {
        const root = document.querySelector(sel);
        if (root && root.textContent?.trim()) {
          const rawLines = root.textContent
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          rawLines.slice(-6).forEach((line, idx) => {
            extracted.push({ key: `line:${idx}`, speaker: 'Meeting Audio', text: line });
          });
          break;
        }
      }
      return extracted;
    });

    if (items.length > 0 && !session.state.captionsEnabled) {
      updateState(session, {
        phase: 'captions_active',
        captionsEnabled: true,
        statusMessage: 'In meeting · Teams Live Captions active',
      });
    }

    const now = Date.now();
    for (const item of items) {
      const prev = session.captionsMap.get(item.key);
      if (!prev) {
        session.captionsMap.set(item.key, {
          speaker: item.speaker,
          lastText: item.text,
          committedText: '',
          lastChangedAt: now,
        });
      } else if (prev.lastText !== item.text) {
        prev.lastText = item.text;
        prev.lastChangedAt = now;
      }
    }

    // Commit lines that have stabilized for >= 1500ms
    for (const [key, entry] of session.captionsMap.entries()) {
      const stable = now - entry.lastChangedAt >= 1500;
      const newPortion = entry.lastText.startsWith(entry.committedText)
        ? entry.lastText.slice(entry.committedText.length).trim()
        : entry.lastText;
      if (stable && newPortion.length >= 4 && newPortion !== entry.committedText) {
        entry.committedText = entry.lastText;
        session.state.captionsCapturedCount += 1;
        await appendMeetingUtterance(session.missionId, {
          speaker: entry.speaker,
          text: newPortion,
          source: 'teams_bot',
          refreshNotes: false,
        });
        void maybeTriggerSpokenReply(session.missionId, entry.speaker, newPortion, 'teams_bot');
      }
      if (session.captionsMap.size > 40 && stable) {
        session.captionsMap.delete(key);
      }
    }
  } catch {
    // Ignore caption DOM transient errors
  }
}

async function detectPageSignals(page: Page) {
  const url = page.url();
  const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 4000)).catch(() => '');

  const nameSelectors = [
    '[data-tid="prejoin-display-name-input"]',
    'input[placeholder*="Type your name" i]',
    'input[placeholder*="Enter name" i]',
    'input[placeholder*="Your name" i]',
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]',
    'input[id="username"]',
  ];
  const joinSelectors = [
    '[data-tid="prejoin-join-button"]',
    'button:has-text("Join now")',
    'button:has-text("Join meeting")',
  ];
  const inMeetingSelectors = [
    '[data-tid="hangup-button"]',
    '[data-tid="calling-screen"]',
    '[data-tid="roster-button"]',
    '[data-tid="call-duration"]',
    'button[aria-label*="Leave" i]',
    'button:has-text("Leave")',
  ];

  const anyVisible = async (sels: string[]) => {
    for (const s of sels) {
      if (await page.locator(s).first().isVisible({ timeout: 200 }).catch(() => false)) return true;
    }
    return false;
  };

  const [hasNameInput, hasJoinButton, hasInMeetingControls] = await Promise.all([
    anyVisible(nameSelectors),
    anyVisible(joinSelectors),
    anyVisible(inMeetingSelectors),
  ]);

  return { url, bodyText, hasNameInput, hasJoinButton, hasInMeetingControls };
}

async function runWatcherStep(session: BotSession): Promise<void> {
  if (session.closing) return;
  await dismissTeamsPreJoinDialogs(session.page);
  const sig = await detectPageSignals(session.page);
  const nextPhase = classifyTeamsPageState(sig.bodyText, sig);
  await captureSnapshot(session);

  if (nextPhase === 'blocked_auth') {
    updateState(session, {
      phase: 'blocked_auth',
      statusMessage:
        'Meeting requires authenticated company sign-in (anonymous guest join is disabled by this meeting policy). Ask host to allow guests, or use Live Copilot + Teams Chat Bridge.',
    });
    return;
  }

  if (nextPhase === 'ended') {
    await leaveMeetingAsBot(session.missionId);
    return;
  }

  if (nextPhase === 'waiting_in_lobby') {
    updateState(session, {
      phase: 'waiting_in_lobby',
      statusMessage: `Waiting in Teams Lobby as "${session.state.botName}" — ask the host to click Admit.`,
    });
    return;
  }

  // If still stuck on pre-join screen with Join Now visible, try filling name & clicking Join Now again
  if (nextPhase === 'entering_name' && sig.hasJoinButton) {
    await fillNameAndClickJoin(session.page, session.state.botName);
    await captureSnapshot(session);
    return;
  }

  if (nextPhase === 'in_meeting') {
    if (!session.answeringQuestion) {
      session.state.micMuted = await isMeetingMicMuted(session.page);
    }

    if (!session.state.captionsEnabled) {
      if (session.captionAttempts === 0) {
        updateState(session, {
          phase: 'in_meeting',
          statusMessage: `Joined Teams meeting as "${session.state.botName}". Enabling Live Captions...`,
        });
      }
      await tryEnableLiveCaptions(session);
    } else if (!session.answeringQuestion && session.state.phase !== 'captions_active') {
      updateState(session, {
        phase: 'captions_active',
        statusMessage: 'In meeting · Teams Live Captions active',
      });
    }

    await pollVisibleCaptions(session);
  }
}

async function fillNameAndClickJoin(page: Page, botName: string): Promise<boolean> {
  await dismissTeamsPreJoinDialogs(page);

  const nameSelectors = [
    '[data-tid="prejoin-display-name-input"]',
    'input[placeholder*="Type your name" i]',
    'input[placeholder*="Enter name" i]',
    'input[placeholder*="Your name" i]',
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]',
    'input[id="username"]',
  ];

  for (const sel of nameSelectors) {
    const input = page.locator(sel).first();
    if (await input.isVisible({ timeout: 800 }).catch(() => false)) {
      await input.fill(botName, { timeout: 4000 }).catch(async () => {
        await dismissTeamsPreJoinDialogs(page);
        await input.fill(botName, { timeout: 4000 });
      });
      break;
    }
  }

  await setTeamsPreJoinMediaMuted(page);
  await dismissTeamsPreJoinDialogs(page);

  return clickFirstVisible(
    page,
    [
      '[data-tid="prejoin-join-button"]',
      'button:has-text("Join now")',
      'button:has-text("Join meeting")',
    ],
    4000
  );
}

export async function joinMeetingAsGuest(
  missionId: string,
  overrideBotName?: string
): Promise<GuestBotState> {
  const mission = await joinMeetingMission(missionId);
  if (!mission.joinUrl?.trim()) {
    throw new Error(
      'This meeting has no Teams Join URL configured. Edit the mission and add the Microsoft Teams meeting link first.'
    );
  }

  // Clean up prior bot session if any
  if (activeBots.has(missionId)) {
    await leaveMeetingAsBot(missionId);
  }

  const botName = (overrideBotName || mission.botDisplayName || 'T-ZONE Agent').trim();
  const ttsEngine = detectTtsEngine();
  const audioReady = ttsEngine !== 'none';
  const authInfo = await getAuthStatus().catch(() => null);
  const hostDisplayName = authInfo?.displayName || mission.organizerName || '';

  const launchArgs = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-notifications',
  ];
  if (!audioReady) {
    launchArgs.push('--use-fake-device-for-media-stream');
  }

  const browser = await chromium.launch({
    headless: true,
    args: launchArgs,
  });

  const context = await browser.newContext({
    permissions: ['microphone', 'camera', 'notifications'],
    viewport: { width: 1280, height: 780 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  });

  // Grant explicit media permissions to Teams origins so Teams pre-join skips site-permission modal
  for (const origin of ['https://teams.microsoft.com', 'https://teams.live.com']) {
    await context.grantPermissions(['microphone', 'camera', 'notifications'], { origin }).catch(() => {});
  }

  // Provide a silent synthetic video track if video hardware is absent while keeping real PulseAudio VirtualMic for audio
  await context.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (!md) return;
    const origGUM = md.getUserMedia.bind(md);
    const origEnum = md.enumerateDevices.bind(md);
    const makeBlackVideoTrack = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        const stream = canvas.captureStream(2);
        return stream.getVideoTracks()[0] || null;
      } catch {
        return null;
      }
    };

    md.enumerateDevices = async () => {
      const list = await origEnum();
      if (list.some((d) => d.kind === 'videoinput')) return list;
      return [
        ...list,
        {
          deviceId: 'tzone-virtual-cam',
          groupId: 'tzone-virtual-group',
          kind: 'videoinput',
          label: 'T-ZONE Virtual Camera',
          toJSON() {
            return this;
          },
        } as MediaDeviceInfo,
      ];
    };

    md.getUserMedia = async (constraints) => {
      const wantsVid = Boolean(constraints && constraints.video);
      const wantsAud = Boolean(constraints && constraints.audio);
      if (!wantsVid) return origGUM(constraints);

      const tracks: MediaStreamTrack[] = [];
      if (wantsAud) {
        try {
          const audStream = await origGUM({ audio: constraints!.audio });
          tracks.push(...audStream.getAudioTracks());
        } catch {
          // Audio may still be acquired separately later
        }
      }
      const vt = makeBlackVideoTrack();
      if (vt) tracks.push(vt);
      return new MediaStream(tracks);
    };
  });

  const page = await context.newPage();

  const session: BotSession = {
    missionId,
    browser,
    context,
    page,
    state: {
      missionId,
      botName,
      phase: 'launching',
      statusMessage: 'Launching headless Chromium Teams guest browser...',
      captionsEnabled: false,
      micMuted: true,
      autoVoiceReply: true,
      voiceMode: 'conversational',
      spokenCount: 0,
      captionsCapturedCount: 0,
      hasScreenshot: false,
      audioReady,
      ttsEngine,
      lastUpdatedAt: new Date().toISOString(),
    },
    lastScreenshot: null,
    watcherTimer: null,
    captionsMap: new Map(),
    closing: false,
    captionAttempts: 0,
    lastCaptionAttemptAt: 0,
    answeringQuestion: false,
    currentlySpeaking: false,
    lastBotReplyEndedAt: 0,
    recentBotUtterances: [],
    hostDisplayName,
    lastWakeNormalized: '',
    lastWakeAt: 0,
  };

  activeBots.set(missionId, session);

  // Run pre-join navigation asynchronously so UI immediately receives "launching" + can poll state/screenshot
  void (async () => {
    try {
      updateState(session, {
        phase: 'opening_url',
        statusMessage: 'Opening Teams meeting link in browser...',
      });

      await page.goto(mission.joinUrl!, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      // Auto-accept browser permission dialogs (camera/mic prompt from browser itself)
      page.on('dialog', (dialog) => { dialog.accept().catch(() => {}); });

      // Initial settle + dismiss any "no audio/video" modal that appears immediately on load
      await page.waitForTimeout(1500);
      await dismissTeamsPreJoinDialogs(page);
      await captureSnapshot(session);

      // Step 1: Click "Continue on this browser" if launcher prompt appears.
      // Keep dismissing "Continue without audio or video" in background while waiting.
      const dismissLoop = setInterval(() => { dismissTeamsPreJoinDialogs(page).catch(() => {}); }, 800);
      await clickFirstVisible(
        page,
        [
          'button:has-text("Continue on this browser")',
          'a:has-text("Continue on this browser")',
          '[data-tid="joinOnWeb"]',
          'button:has-text("Join on the web instead")',
        ],
        9000
      );
      clearInterval(dismissLoop);

      // Step 2: Wait up to ~22s for either guest name box or sign-in gate, dismissing permission popups
      let sig = await detectPageSignals(page);
      for (let i = 0; i < 12 && !session.closing; i++) {
        await dismissTeamsPreJoinDialogs(page);
        sig = await detectPageSignals(page);
        if (sig.hasNameInput || sig.hasInMeetingControls) break;
        const earlyPhase = classifyTeamsPageState(sig.bodyText, sig);
        if (earlyPhase === 'blocked_auth') break;
        await page.waitForTimeout(1800);
        await captureSnapshot(session);
      }

      const prePhase = classifyTeamsPageState(sig.bodyText, sig);
      if (prePhase === 'blocked_auth') {
        updateState(session, {
          phase: 'blocked_auth',
          statusMessage:
            'Meeting requires authenticated sign-in (anonymous guest join is blocked by this meeting/org policy).',
        });
        await captureSnapshot(session);
        return;
      }

      // Step 3: Dismiss any remaining dialog, fill guest name, mute media, and click "Join now" (up to 3 attempts)
      updateState(session, {
        phase: 'entering_name',
        statusMessage: `Joining as guest "${botName}"...`,
      });

      let joinedClick = false;
      for (let attempt = 0; attempt < 3 && !session.closing; attempt++) {
        joinedClick = await fillNameAndClickJoin(page, botName);
        await captureSnapshot(session);
        await page.waitForTimeout(2000);
        const postSig = await detectPageSignals(page);
        const postPhase = classifyTeamsPageState(postSig.bodyText, postSig);
        if (postPhase === 'waiting_in_lobby' || postPhase === 'in_meeting') {
          break;
        }
        if (!postSig.hasJoinButton && joinedClick) {
          break;
        }
      }

      if (joinedClick) {
        updateState(session, {
          phase: 'waiting_in_lobby',
          statusMessage: `Submitted Join Now as "${botName}" — checking lobby / meeting entry...`,
        });
      }

      await captureSnapshot(session);

      // Step 4: Continuous watcher for lobby admission, live captions & screenshots
      session.watcherTimer = setInterval(() => {
        void runWatcherStep(session);
      }, 2500);
    } catch (err) {
      if (!session.closing) {
        await captureSnapshot(session);
        updateState(session, {
          phase: 'error',
          error: (err as Error).message,
          statusMessage: `Guest bot failed: ${(err as Error).message}`,
        });
      }
    }
  })();

  return session.state;
}

export function getGuestBotState(missionId: string): GuestBotState {
  const active = activeBots.get(missionId);
  if (active) return active.state;
  const mission = getMeetingMission(missionId);
  const ttsEngine = detectTtsEngine();
  return {
    missionId,
    botName: mission?.botDisplayName || 'T-ZONE Agent',
    phase: 'idle',
    statusMessage: 'Guest browser bot is not running.',
    captionsEnabled: false,
    micMuted: true,
    autoVoiceReply: true,
    voiceMode: 'conversational',
    spokenCount: 0,
    captionsCapturedCount: 0,
    hasScreenshot: false,
    audioReady: ttsEngine !== 'none',
    ttsEngine,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function setGuestBotAutoVoiceReply(
  missionId: string,
  enabled?: boolean,
  voiceMode?: VoiceReplyMode
): GuestBotState {
  const session = activeBots.get(missionId);
  if (!session) return getGuestBotState(missionId);
  updateState(session, {
    autoVoiceReply: enabled !== undefined ? enabled : session.state.autoVoiceReply,
    voiceMode: voiceMode !== undefined ? voiceMode : session.state.voiceMode,
  });
  return session.state;
}

export function getGuestBotScreenshot(missionId: string): Buffer | null {
  return activeBots.get(missionId)?.lastScreenshot || null;
}

export async function toggleGuestBotMute(missionId: string, muted: boolean): Promise<GuestBotState> {
  const session = activeBots.get(missionId);
  if (!session) throw new Error('Guest bot is not active for this meeting.');
  const actual = await setInMeetingMicMuted(session.page, muted);
  updateState(session, { micMuted: actual });
  await captureSnapshot(session);
  return session.state;
}

export async function speakInMeetingAsBot(missionId: string, rawText: string): Promise<GuestBotState> {
  const session = activeBots.get(missionId);
  if (!session) throw new Error('Guest bot is not active for this meeting.');
  if (session.state.phase !== 'in_meeting' && session.state.phase !== 'captions_active') {
    throw new Error(
      `Bot cannot speak yet (current state: ${session.state.phase}). Wait until host admits "${session.state.botName}" into the meeting.`
    );
  }
  if (!session.state.audioReady) {
    throw new Error(
      'PulseAudio virtual mic is unavailable in this environment. Voice injection runs inside the Docker container.'
    );
  }

  const text = rawText.trim().slice(0, 850);
  if (!text) return session.state;

  session.currentlySpeaking = true;
  const micNowMuted = await setInMeetingMicMuted(session.page, false);
  updateState(session, { micMuted: micNowMuted, statusMessage: 'Speaking aloud in Teams call...' });

  try {
    await playTextToVirtualMic(session, text);
  } finally {
    session.currentlySpeaking = false;
    session.lastBotReplyEndedAt = Date.now();
    const finalMuted = await setInMeetingMicMuted(session.page, true);
    updateState(session, {
      micMuted: finalMuted,
      spokenCount: session.state.spokenCount + 1,
      statusMessage: session.state.captionsEnabled
        ? 'In meeting · Teams Live Captions active'
        : 'In meeting',
    });
  }

  await appendMeetingUtterance(missionId, {
    speaker: `${session.state.botName} (Spoke)`,
    text,
    source: 'bot_voice',
    refreshNotes: false,
  });

  return session.state;
}

export async function leaveMeetingAsBot(missionId: string): Promise<GuestBotState> {
  const session = activeBots.get(missionId);
  if (!session) return getGuestBotState(missionId);

  session.closing = true;
  if (session.watcherTimer) {
    clearInterval(session.watcherTimer);
    session.watcherTimer = null;
  }

  try {
    await clickFirstVisible(
      session.page,
      ['[data-tid="hangup-button"]', 'button[aria-label*="Leave" i]'],
      2000
    );
  } catch {
    // ignore hangup click errors
  }

  const finalState: GuestBotState = {
    ...session.state,
    phase: 'ended',
    statusMessage: 'Guest bot left the meeting.',
    lastUpdatedAt: new Date().toISOString(),
  };

  activeBots.delete(missionId);
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});

  return finalState;
}
