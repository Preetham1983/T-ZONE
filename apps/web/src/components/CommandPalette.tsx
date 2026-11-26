import { useQuery } from '@tanstack/react-query';
import type { FtsSearchResult } from '@tzone/shared';
import { FileText, MessageSquare, Search, Sparkles, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useAppStore } from '../stores/appStore.js';

interface SearchResponse {
  ftsHits: FtsSearchResult[];
  liveHits: Array<{
    id: string;
    createdDateTime: string;
    senderName: string;
    summary: string;
    chatId?: string;
  }>;
}

export function CommandPalette() {
  const { cmdkOpen, setCmdkOpen, setScreen, setSelectedTranscriptId, launchPromptInChat } = useAppStore();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [includeLive, setIncludeLive] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(!cmdkOpen);
      } else if (e.key === 'Escape' && cmdkOpen) {
        setCmdkOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdkOpen, setCmdkOpen]);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced, includeLive],
    queryFn: () =>
      apiFetch<SearchResponse>(
        `/api/teams/search?q=${encodeURIComponent(debounced)}&live=${includeLive ? 'true' : 'false'}`
      ),
    enabled: cmdkOpen && debounced.length >= 2,
  });

  if (!cmdkOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 pt-20 p-4 backdrop-blur-xs"
      onClick={() => setCmdkOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across Teams chats, channels, transcripts & Copilot notes..."
            className="flex-1 text-sm outline-none"
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={includeLive}
              onChange={(e) => setIncludeLive(e.target.checked)}
              className="rounded border-slate-300"
            />
            Live Graph
          </label>
          <button
            onClick={() => setCmdkOpen(false)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-3 space-y-2">
          {debounced.length < 2 && (
            <div className="py-8 text-center text-xs text-slate-500">
              Type at least 2 characters to search your FTS5 index &amp; Microsoft Teams.
            </div>
          )}
          {isFetching && <div className="py-4 text-center text-xs text-blue-600">Searching...</div>}

          {data?.ftsHits.map((hit) => (
            <button
              key={hit.id}
              onClick={() => {
                setCmdkOpen(false);
                if (hit.sourceType === 'transcript_segment' || hit.sourceType === 'copilot_insight') {
                  setSelectedTranscriptId(hit.parentId);
                  setScreen('transcripts');
                } else {
                  setScreen('teams');
                }
              }}
              className="w-full text-left rounded-lg border border-slate-200 p-2.5 hover:border-blue-400 hover:bg-blue-50/40 transition"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-xs text-slate-900">
                  {hit.sourceType === 'transcript_segment' ? (
                    <FileText className="h-3.5 w-3.5 text-emerald-600" />
                  ) : hit.sourceType === 'copilot_insight' ? (
                    <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5 text-blue-600" />
                  )}
                  <span>{hit.title}</span>
                </div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                  {hit.speakerOrSender}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-600 line-clamp-2">{hit.snippet}</div>
            </button>
          ))}

          {data?.liveHits.map((hit) => (
            <div
              key={hit.id}
              className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-blue-900 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> {hit.senderName}
                </span>
                <span className="text-[10px] font-mono text-blue-700">Live Graph</span>
              </div>
              <p className="mt-1 text-slate-700">{hit.summary}</p>
            </div>
          ))}

          {debounced.length >= 2 && (
            <button
              onClick={() => {
                setCmdkOpen(false);
                launchPromptInChat(`Search Teams, transcripts, and Microsoft 365 for "${debounced}" and summarize everything relevant.`);
              }}
              className="w-full rounded-lg border border-dashed border-blue-400 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              Ask T-ZONE Agent to investigate "{debounced}" across Teams &amp; M365 →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
