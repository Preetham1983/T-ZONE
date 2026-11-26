import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeetingTranscriptRecord } from '@tzone/shared';
import { Download, FileAudio, Play, Search, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, streamSsePost } from '../../api/client.js';
import { useAppStore } from '../../stores/appStore.js';

type ExtractStreamEvent =
  | { type: 'progress'; current: number; total: number; subject: string; extractedCount: number }
  | { type: 'done'; meetingsScanned: number; extractedCount: number; errors: Array<{ subject: string; error: string }> }
  | { type: 'error'; message: string };

export function TranscriptsScreen() {
  const qc = useQueryClient();
  const { selectedTranscriptId, setSelectedTranscriptId, launchPromptInChat } = useAppStore();

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; subject: string } | null>(null);
  const [extractResultMsg, setExtractResultMsg] = useState<string | null>(null);
  const [segmentQuery, setSegmentQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState('ALL');
  const [llmSummary, setLlmSummary] = useState<string | null>(null);

  const { data: transcripts = [] } = useQuery({
    queryKey: ['transcripts'],
    queryFn: () => apiFetch<MeetingTranscriptRecord[]>('/api/transcripts'),
  });

  const active =
    transcripts.find((t) => t.id === selectedTranscriptId) || transcripts[0] || null;

  useEffect(() => {
    setLlmSummary(null);
    setSpeakerFilter('ALL');
    setSegmentQuery('');
  }, [active?.id]);

  const summarizeMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ summary: string; providerLabel: string }>(`/api/transcripts/${encodeURIComponent(id)}/summarize`, {
        method: 'POST',
      }),
    onSuccess: (res) => setLlmSummary(res.summary),
  });

  const runBatchExtract = async () => {
    setExtracting(true);
    setProgress(null);
    setExtractResultMsg(null);
    try {
      await streamSsePost<ExtractStreamEvent>(
        '/api/transcripts/extract-stream',
        { startDate, endDate, subjectFilter: subjectFilter || undefined, includeInsights: true },
        (ev) => {
          if (ev.type === 'progress') {
            setProgress({ current: ev.current, total: ev.total, subject: ev.subject });
          } else if (ev.type === 'done') {
            setExtractResultMsg(
              `Scanned ${ev.meetingsScanned} meetings · Extracted ${ev.extractedCount} transcript(s)${
                ev.errors.length ? ` · ${ev.errors.length} errors` : ''
              }`
            );
          } else if (ev.type === 'error') {
            setExtractResultMsg(`Error: ${ev.message}`);
          }
        }
      );
      qc.invalidateQueries({ queryKey: ['transcripts'] });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    } catch (err) {
      setExtractResultMsg((err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const filteredSegments = (active?.segments || []).filter((seg) => {
    if (speakerFilter !== 'ALL' && seg.speaker !== speakerFilter) return false;
    if (segmentQuery.trim()) {
      const q = segmentQuery.toLowerCase();
      return seg.text.toLowerCase().includes(q) || seg.speaker.toLowerCase().includes(q);
    }
    return true;
  });

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[360px_1fr] overflow-hidden bg-white">
      {/* Left Extractor & List */}
      <aside className="flex flex-col border-r border-slate-200 bg-slate-50 overflow-hidden">
        <div className="border-b border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <FileAudio className="h-4 w-4 text-blue-600" />
            Batch Transcript Extractor
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-mono text-slate-500 mb-0.5">START DATE</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-500 mb-0.5">END DATE</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
          </div>

          <input
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            placeholder="Optional subject keyword (e.g. standup)..."
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />

          <button
            onClick={() => void runBatchExtract()}
            disabled={extracting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {extracting ? 'Extracting Transcripts...' : 'Extract All Transcripts + Insights'}
          </button>

          {extracting && progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-slate-600">
                <span className="truncate max-w-52">{progress.subject}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {extractResultMsg && (
            <div className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
              {extractResultMsg}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {transcripts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
              No transcripts extracted yet. Pick a date range above and click <strong>Extract All Transcripts</strong>.
            </div>
          ) : (
            transcripts.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTranscriptId(t.id)}
                className={`w-full text-left rounded-xl border p-3 transition ${
                  active?.id === t.id
                    ? 'border-blue-400 bg-blue-50/70'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-xs text-slate-900 line-clamp-1">{t.subject}</strong>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-mono ${
                      t.insightsStatus === 'available'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {t.insightsStatus === 'available' ? 'VTT + AI' : 'VTT'}
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-500">
                  {t.startDateTime.slice(0, 16).replace('T', ' ')} · {t.speakerStats.length} speakers · {t.segments.length} lines
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Right Detail Pane */}
      <section className="flex flex-col overflow-hidden">
        {!active ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-slate-500">
            Select or extract a meeting transcript to inspect speaker timeline, Copilot AI insights, and run operations.
          </div>
        ) : (
          <>
            <header className="border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">{active.subject}</h2>
                <div className="text-xs font-mono text-slate-500">
                  Organizer: {active.organizerName} · {active.segments.length} segments · Indexed in FTS5
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    launchPromptInChat(
                      `Analyze the transcript "${active.subject}" (record ID: ${active.id}). Summarize key decisions with timestamps and list all action items.`
                    )
                  }
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Ask Agent About This
                </button>
                <button
                  onClick={() =>
                    launchPromptInChat(
                      `Read transcript "${active.subject}" (${active.id}), extract every action item and owner, and propose Planner tasks or Microsoft To Do items for me.`
                    )
                  }
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Create Tasks
                </button>
                <button
                  onClick={() =>
                    launchPromptInChat(
                      `Based on transcript "${active.subject}" (${active.id}), create an Outlook email draft summarizing the meeting recap and next steps.`
                    )
                  }
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Draft Follow-up Email
                </button>
                <a
                  href={`/api/transcripts/${encodeURIComponent(active.id)}/export?format=vtt`}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> .vtt
                </a>
                <a
                  href={`/api/transcripts/${encodeURIComponent(active.id)}/export?format=md`}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> .md
                </a>
              </div>
            </header>

            <div className="grid flex-1 grid-cols-1 xl:grid-cols-[1fr_330px] overflow-hidden">
              {/* VTT Reader */}
              <div className="flex flex-col overflow-hidden p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <div className="relative flex-1 min-w-48">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={segmentQuery}
                      onChange={(e) => setSegmentQuery(e.target.value)}
                      placeholder="Filter utterances in this transcript..."
                      className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
                    />
                  </div>
                  <select
                    value={speakerFilter}
                    onChange={(e) => setSpeakerFilter(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    <option value="ALL">All Speakers ({active.speakerStats.length})</option>
                    {active.speakerStats.map((s) => (
                      <option key={s.speaker} value={s.speaker}>
                        {s.speaker} ({s.sharePercent}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {filteredSegments.map((seg) => (
                    <div
                      key={seg.index}
                      className="grid grid-cols-[76px_135px_1fr] gap-3 px-3.5 py-2.5 text-xs hover:bg-slate-50"
                    >
                      <span className="font-mono text-slate-400">{seg.startTime}</span>
                      <strong className="truncate text-slate-800">{seg.speaker}</strong>
                      <span className="text-slate-700 leading-relaxed">{seg.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Insights & Speaker Stats */}
              <aside className="border-l border-slate-200 bg-slate-50 p-4 overflow-y-auto space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                    Speaker Participation
                  </div>
                  <div className="space-y-1.5">
                    {active.speakerStats.slice(0, 6).map((st) => (
                      <div key={st.speaker} className="text-[11px]">
                        <div className="flex justify-between">
                          <span className="font-medium text-slate-800 truncate">{st.speaker}</span>
                          <span className="font-mono text-slate-500">{st.sharePercent}%</span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${st.sharePercent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                      Copilot AI Insights
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                      {active.insightsStatus}
                    </span>
                  </div>

                  {active.insights.length > 0 ? (
                    <div className="space-y-3 text-xs">
                      {active.insights.map((ins) => (
                        <div key={ins.id} className="space-y-2">
                          {ins.meetingNotes.length > 0 && (
                            <div>
                              <strong className="text-slate-800">Notes</strong>
                              <ul className="mt-1 list-disc pl-4 space-y-1 text-slate-700">
                                {ins.meetingNotes.map((n, i) => (
                                  <li key={i}>
                                    <strong>{n.title}</strong> {n.text}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {ins.actionItems.length > 0 && (
                            <div>
                              <strong className="text-slate-800">Action Items</strong>
                              <ul className="mt-1 space-y-1 text-slate-700">
                                {ins.actionItems.map((a, i) => (
                                  <li key={i}>
                                    ☐ {a.title}{' '}
                                    {a.ownerDisplayName && (
                                      <span className="text-slate-500">({a.ownerDisplayName})</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      {active.insightsStatus === 'no_copilot_license'
                        ? 'M365 Copilot license not detected (403). Generate a local LLM summary below instead.'
                        : 'Copilot insights not available yet for this meeting.'}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                  <div className="text-xs font-bold text-slate-900">T-ZONE LLM Recap</div>
                  <button
                    onClick={() => summarizeMutation.mutate(active.id)}
                    disabled={summarizeMutation.isPending}
                    className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {summarizeMutation.isPending ? 'Generating Recap...' : 'Generate LLM Summary'}
                  </button>
                  {summarizeMutation.isError && (
                    <p className="text-[11px] text-red-600">{(summarizeMutation.error as Error).message}</p>
                  )}
                  {llmSummary && (
                    <div className="markdown-body text-xs border-t border-slate-100 pt-2">
                      <Markdown remarkPlugins={[remarkGfm]}>{llmSummary}</Markdown>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
