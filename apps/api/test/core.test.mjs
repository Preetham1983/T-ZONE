import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedDb } from '../dist/db/client.js';
import {
  addMessage,
  createConversation,
  getConversationMessages,
  replaceFtsForParent,
  searchFtsIndex,
} from '../dist/db/repositories.js';
import { parseVtt } from '../dist/sync/vttParser.js';
import { decodeJwtClaims } from '../dist/msgraph/authManager.js';
import { maskSecret } from '../dist/llm/settingsStore.js';
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
