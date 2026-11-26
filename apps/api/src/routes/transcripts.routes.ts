import { extractTranscriptsSchema } from '@tzone/shared';
import type { FastifyInstance } from 'fastify';
import { getTranscriptById, listTranscripts } from '../db/repositories.js';
import { runLlmCompletion } from '../llm/provider.js';
import {
  discoverMeetingCandidates,
  extractAllTranscripts,
} from '../msgraph/services/transcriptsService.js';

export async function registerTranscriptsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/transcripts', async () => listTranscripts());

  app.get<{ Querystring: { startDate?: string; endDate?: string; subject?: string } }>(
    '/api/transcripts/candidates',
    async (req) => {
      const end = req.query.endDate || new Date().toISOString().slice(0, 10);
      const start =
        req.query.startDate || new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
      return discoverMeetingCandidates(start, end, req.query.subject);
    }
  );

  app.post('/api/transcripts/extract', async (req, reply) => {
    const parsed = extractTranscriptsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid extraction request' });
    }
    return extractAllTranscripts(parsed.data);
  });

  app.post('/api/transcripts/extract-stream', async (req, reply) => {
    const parsed = extractTranscriptsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message || 'Invalid extraction request' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    const emit = (payload: unknown) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    try {
      const result = await extractAllTranscripts(parsed.data, (progress) => {
        emit({ type: 'progress', ...progress });
      });
      emit({
        type: 'done',
        meetingsScanned: result.meetingsScanned,
        extractedCount: result.transcriptsExtracted.length,
        errors: result.errors,
      });
    } catch (err) {
      emit({ type: 'error', message: (err as Error).message });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  app.get<{ Params: { id: string } }>('/api/transcripts/:id', async (req, reply) => {
    const rec = getTranscriptById(decodeURIComponent(req.params.id));
    if (!rec) return reply.status(404).send({ error: 'Transcript not found' });
    return rec;
  });

  app.post<{ Params: { id: string } }>('/api/transcripts/:id/summarize', async (req, reply) => {
    const rec = getTranscriptById(decodeURIComponent(req.params.id));
    if (!rec) return reply.status(404).send({ error: 'Transcript not found' });

    const completion = await runLlmCompletion({
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            'Summarize the Microsoft Teams meeting transcript cleanly into: 1) Executive Summary, 2) Key Decisions (with timestamps), 3) Action Items (Owner + Task), 4) Open Questions.',
        },
        {
          role: 'user',
          content: `Meeting: ${rec.subject} (${rec.startDateTime})\n\n${rec.plainText.slice(0, 28_000)}`,
        },
      ],
    });
    return { summary: completion.content, providerLabel: completion.providerLabel };
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/transcripts/:id/export',
    async (req, reply) => {
      const rec = getTranscriptById(decodeURIComponent(req.params.id));
      if (!rec) return reply.status(404).send({ error: 'Transcript not found' });
      const fmt = req.query.format || 'md';
      const safeName = rec.subject.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 50) || 'transcript';

      if (fmt === 'vtt') {
        return reply
          .header('Content-Type', 'text/vtt; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${safeName}.vtt"`)
          .send(rec.rawVtt);
      }
      if (fmt === 'json') {
        return reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${safeName}.json"`)
          .send(JSON.stringify(rec, null, 2));
      }
      const md = `# ${rec.subject}\n- Date: ${rec.startDateTime}\n- Organizer: ${rec.organizerName}\n\n## Transcript\n\n${rec.plainText}\n`;
      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${safeName}.md"`)
        .send(md);
    }
  );
}
