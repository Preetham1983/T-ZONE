import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedDb } from '../dist/db/client.js';
import {
  addMessage,
  createConversation,
  createMeetingMission,
  deleteMeetingMission,
  getConversationMessages,
  getMeetingMission,
  listMeetingMissions,
  replaceFtsForParent,
  searchFtsIndex,
  updateMeetingMission,
} from '../dist/db/repositories.js';
import { parseVtt } from '../dist/sync/vttParser.js';
import { decodeJwtClaims } from '../dist/msgraph/authManager.js';
import { maskSecret } from '../dist/llm/settingsStore.js';
import { resolveTargetEndpoint } from '../dist/llm/provider.js';
import {
  classifyTeamsPageState,
  detectConversationalQuestion,
  extractWakeQuery,
  getSpeakerFirstName,
  isEchoOfBotSpeech,
  toSpokenPlainText,
} from '../dist/agent/teamsBrowserBot.js';
import {
  isConversationRunning,
  registerConversationRun,
  stopConversationRun,
  unregisterConversationRun,
} from '../dist/agent/runManager.js';
import { buildApp } from '../dist/index.js';

test('parseVtt extracts speaker-attributed segments and speaker share stats', () => {
  const sampleVtt = `WEBVTT

00:00:05.000 --> 00:00:10.500
<v Sarah Chen>Let us keep PKCE loopback on port 8484 inside Docker.</v>

00:00:11.000 --> 00:00:16.000
<v Preetham Reddy>Agreed, Intune device claims will attach cleanly on macOS.</v>
`;

  const parsed = parseVtt(sampleVtt);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].speaker, 'Sarah Chen');
  assert.equal(parsed.segments[0].startTime, '00:00:05');
  assert.match(parsed.segments[0].text, /8484/);
  assert.equal(parsed.speakerStats.length, 2);
  assert.ok(parsed.plainText.includes('[00:00:05] Sarah Chen:'));
});

test('SQLite FTS5 search handles punctuation safely and isolates conversations', () => {
  const db = createIsolatedDb(':memory:');
  const conv = createConversation('Test session', null, db);
  addMessage(
    {
      id: 'm1',
      conversationId: conv.id,
      role: 'user',
      content: 'Find SSO gateway notes',
      toolTraces: [],
      citations: [],
      createdAt: new Date().toISOString(),
    },
    db
  );
  const msgs = getConversationMessages(conv.id, db);
  assert.equal(msgs.length, 1);

  replaceFtsForParent(
    'transcript_segment',
    'meeting:1',
    [
      {
        id: 'seg1',
        sourceId: 'meeting:1#00:00:05',
        title: 'Arch Sync (00:00:05)',
        speakerOrSender: 'Sarah Chen',
        occurredAt: '2026-11-25T10:00:00Z',
        body: 'Configure EPAM DIAL proxy-endpoint & PKCE callback.',
      },
    ],
    db
  );

  const hits = searchFtsIndex('EPAM proxy-endpoint', undefined, 10, db);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].speakerOrSender, 'Sarah Chen');
});

test('decodeJwtClaims parses identity, deviceid, and scopes', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      upn: 'user@epam.com',
      oid: 'oid-123',
      tid: 'tid-456',
      deviceid: 'dev-999',
      join_type: 'WorkplaceJoined',
      amr: ['pwd', 'mfa'],
      scp: 'Chat.Read User.Read OnlineMeetingTranscript.Read.All',
      iat: 1700000000,
      exp: 1900000000,
    })
  ).toString('base64url');
  const claims = decodeJwtClaims(`${header}.${payload}.sig`);
  assert.ok(claims);
  assert.equal(claims.upn, 'user@epam.com');
  assert.equal(claims.deviceId, 'dev-999');
  assert.deepEqual(claims.scopes, ['Chat.Read', 'OnlineMeetingTranscript.Read.All', 'User.Read']);
});

test('maskSecret masks sensitive keys', () => {
  assert.equal(maskSecret('dial-0xt7bzi9o9stxfpr9z8o6dkd782'), 'dial-0••••d782');
  assert.equal(maskSecret('short'), '••••••••');
});

test('Fastify app exposes health, playbooks, settings, and skill inspector routes', async () => {
  const app = await buildApp();
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);

  const playbooks = await app.inject({ method: 'GET', url: '/api/playbooks' });
  assert.equal(playbooks.statusCode, 200);
  assert.equal(playbooks.json().length, 4);

  const llm = await app.inject({ method: 'GET', url: '/api/settings/llm' });
  assert.equal(llm.statusCode, 200);
  assert.ok(['dial', 'copilot'].includes(llm.json().provider));

  const skill = await app.inject({ method: 'GET', url: '/api/skills/msgraph' });
  assert.equal(skill.statusCode, 200);
  assert.equal(skill.json().skillExists, true);

  await app.close();
});

test('resolveTargetEndpoint sends single non-duplicated Api-Key header for EPAM DIAL', async () => {
  const target = await resolveTargetEndpoint({
    provider: 'dial',
    agentMode: 'agent_sdk',
    approvalPolicy: 'ask_external',
    maxSteps: 12,
    temperature: 0.2,
    dial: {
      azureEndpoint: 'https://ai-proxy.lab.epam.com',
      apiVersion: '2024-02-01',
      chatModelName: 'gpt-4.1-mini-2025-04-14',
      apiKey: 'dial-sample-key',
    },
    copilot: {
      model: 'gpt-4.1',
      transport: 'auto',
      githubPat: '',
      copilotSdkPat: '',
    },
  });
  const headers = new Headers(target.headers);
  assert.equal(headers.get('api-key'), 'dial-sample-key');
});

test('runManager tracks per-conversation runs independently and aborts only stopped run', async () => {
  const c1 = registerConversationRun('conv-1', 'run-1');
  const c2 = registerConversationRun('conv-2', 'run-2');

  assert.equal(isConversationRunning('conv-1'), true);
  assert.equal(isConversationRunning('conv-2'), true);

  const stopped = stopConversationRun('conv-1');
  assert.equal(stopped, true);
  assert.equal(c1.signal.aborted, true);
  assert.equal(c2.signal.aborted, false);

  unregisterConversationRun('conv-1', 'run-1');
  unregisterConversationRun('conv-2', 'run-2');
  assert.equal(isConversationRunning('conv-1'), false);
  assert.equal(isConversationRunning('conv-2'), false);

  const app = await buildApp();
  const stopRes = await app.inject({ method: 'POST', url: '/api/conversations/missing-id/stop' });
  assert.equal(stopRes.statusCode, 200);
  assert.equal(stopRes.json().stopped, false);

  const dashRes = await app.inject({ method: 'GET', url: '/api/dashboard?tz=Asia/Kolkata' });
  assert.equal(dashRes.statusCode, 200);
  assert.ok('sync' in dashRes.json());
  assert.ok(Array.isArray(dashRes.json().recentTranscripts));

  await app.close();
});

test('meeting_missions repository CRUD and /api/meeting-agent routes work end-to-end', async () => {
  const db = createIsolatedDb(':memory:');
  const created = createMeetingMission(
    {
      subject: 'Ontology Architecture Call',
      organizerName: 'Sanchit',
      startDateTime: '2026-11-26T15:00:00Z',
      endDateTime: '2026-11-26T16:00:00Z',
      attendees: [{ name: 'Preetham', email: 'p@example.com' }],
      rolePreset: 'researcher',
      roleTitle: 'Researcher & Note-Taker',
      roleInstructions: 'Research blockers and record decisions.',
      focusTopics: ['Ontology', 'FTS5'],
      autoNotes: true,
      autoRespondChat: false,
      autoExtractTranscript: true,
    },
    db
  );
  assert.equal(created.status, 'scheduled');
  assert.deepEqual(created.focusTopics, ['Ontology', 'FTS5']);

  const updated = updateMeetingMission(
    created.id,
    {
      status: 'active',
      liveNotes: '## Key Points\n- Checked ontology slice.',
      utterances: [
        {
          id: 'u1',
          timestamp: '15:05:00',
          speaker: 'Preetham',
          text: 'Need to check ontology blockers.',
          source: 'mic',
        },
      ],
    },
    db
  );
  assert.equal(updated.status, 'active');
  assert.equal(updated.utterances.length, 1);
  assert.equal(listMeetingMissions(db).length, 1);

  deleteMeetingMission(created.id, db);
  assert.equal(getMeetingMission(created.id, db), null);

  const app = await buildApp();
  const presets = await app.inject({ method: 'GET', url: '/api/meeting-agent/presets' });
  assert.equal(presets.statusCode, 200);
  assert.ok(Array.isArray(presets.json()) && presets.json().length === 4);

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/meeting-agent/missions',
    payload: { subject: '' },
  });
  assert.equal(invalid.statusCode, 400);

  const createdViaHttp = await app.inject({
    method: 'POST',
    url: '/api/meeting-agent/missions',
    payload: {
      subject: 'Test Nov 26 Sync',
      rolePreset: 'researcher',
      roleTitle: 'Researcher & Note-Taker',
      roleInstructions: 'Track notes cleanly.',
      focusTopics: ['Testing'],
    },
  });
  assert.equal(createdViaHttp.statusCode, 200);
  const createdId = createdViaHttp.json().id;

  const listHttp = await app.inject({ method: 'GET', url: '/api/meeting-agent/missions' });
  assert.equal(listHttp.statusCode, 200);
  assert.ok(listHttp.json().some((m) => m.id === createdId));

  const delHttp = await app.inject({ method: 'DELETE', url: `/api/meeting-agent/missions/${createdId}` });
  assert.equal(delHttp.statusCode, 200);

  const botStateRes = await app.inject({
    method: 'GET',
    url: `/api/meeting-agent/missions/${createdId}/bot/state`,
  });
  assert.equal(botStateRes.statusCode, 200);
  assert.equal(botStateRes.json().phase, 'idle');

  await app.close();
});

test('classifyTeamsPageState identifies pre-join, lobby, in-meeting, and blocked auth states', () => {
  assert.equal(
    classifyTeamsPageState('Someone in the meeting should let you in soon.', {
      url: 'https://teams.microsoft.com/v2/',
      hasNameInput: false,
      hasJoinButton: false,
      hasInMeetingControls: false,
    }),
    'waiting_in_lobby'
  );
  assert.equal(
    classifyTeamsPageState('Leave chat audio', {
      url: 'https://teams.microsoft.com/v2/',
      hasNameInput: false,
      hasJoinButton: false,
      hasInMeetingControls: true,
    }),
    'in_meeting'
  );
  assert.equal(
    classifyTeamsPageState('Choose your video and audio options', {
      url: 'https://teams.microsoft.com/v2/',
      hasNameInput: true,
      hasJoinButton: true,
      hasInMeetingControls: false,
    }),
    'entering_name'
  );
  assert.equal(
    classifyTeamsPageState('Only people in this organization can join this meeting', {
      url: 'https://login.microsoftonline.com/common/oauth2',
      hasNameInput: false,
      hasJoinButton: false,
      hasInMeetingControls: false,
    }),
    'blocked_auth'
  );
});

test('extractWakeQuery and toSpokenPlainText detect T-ZONE wake phrases and clean markdown', () => {
  assert.equal(
    extractWakeQuery('Hey T-ZONE, what are today ontology blockers?', 'T-ZONE Agent'),
    'what are today ontology blockers?'
  );
  assert.equal(
    extractWakeQuery('Hey tea zone check the OntoBricks status please', 'T-ZONE Agent'),
    'check the OntoBricks status please'
  );
  assert.equal(
    extractWakeQuery('Hey agent summarize the last meeting', 'T-ZONE Agent'),
    'summarize the last meeting'
  );
  assert.equal(
    extractWakeQuery('Our multi-agent architecture handles ontology slicing', 'T-ZONE Agent'),
    null
  );
  assert.equal(
    toSpokenPlainText('**Blockers:** Check `OntoBricks` [▶ 00:12:15](#tzone-cite:1:00:12:15).'),
    'Blockers: Check OntoBricks at 00:12:15.'
  );

  assert.equal(
    detectConversationalQuestion('What did we write in the ontology notes?', 'T-ZONE Agent', 'conversational', false),
    'What did we write in the ontology notes?'
  );
  assert.equal(
    detectConversationalQuestion('Ontologies are booming in the market today.', 'T-ZONE Agent', 'conversational', false),
    null
  );
  assert.equal(
    detectConversationalQuestion('Okay thank you', 'T-ZONE Agent', 'conversational', true),
    null
  );
  assert.equal(
    detectConversationalQuestion('Tell me more about that', 'T-ZONE Agent', 'wake_word', true),
    'Tell me more about that'
  );
  assert.equal(getSpeakerFirstName('Bandi Preetham Reddy', 'Other Host'), 'Bandi');
  assert.equal(getSpeakerFirstName('You', 'Bandi Preetham Reddy'), 'Bandi');
  assert.equal(
    isEchoOfBotSpeech(
      [{ text: 'Hey Bandi, give me a second while I check the notes on that.', at: Date.now() }],
      'give me a second while I check the notes'
    ),
    true
  );
});

test('T-ZONE Planner REST API and MCP endpoint support full CRUD', async () => {
  const app = await buildApp();

  const boardsRes = await app.inject({ method: 'GET', url: '/api/planner/boards' });
  assert.equal(boardsRes.statusCode, 200);
  const boards = boardsRes.json();
  assert.ok(Array.isArray(boards) && boards.length >= 1);

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/planner/tasks',
    payload: { title: 'Test Planner Task', priority: 'high', tags: ['test'] },
  });
  assert.equal(createRes.statusCode, 200);
  const created = createRes.json();
  assert.equal(created.title, 'Test Planner Task');
  assert.equal(created.status, 'todo');

  const mcpListRes = await app.inject({
    method: 'POST',
    url: '/api/mcp',
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  assert.equal(mcpListRes.statusCode, 200);
  const mcpList = mcpListRes.json();
  assert.ok(mcpList.result.tools.some((t) => t.name === 'tzone_planner_create_task'));

  const mcpUpdateRes = await app.inject({
    method: 'POST',
    url: '/api/mcp',
    payload: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'tzone_planner_update_task', arguments: { taskId: created.id, status: 'done' } },
    },
  });
  assert.equal(mcpUpdateRes.statusCode, 200);
  const updatedPayload = JSON.parse(mcpUpdateRes.json().result.content[0].text);
  assert.equal(updatedPayload.status, 'done');

  const delRes = await app.inject({ method: 'DELETE', url: `/api/planner/tasks/${created.id}` });
  assert.equal(delRes.statusCode, 200);
  await app.close();
});
