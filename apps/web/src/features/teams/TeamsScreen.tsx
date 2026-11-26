import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChannelSummary,
  TeamSummary,
  TeamsChatSummary,
  TeamsMessageItem,
} from '@tzone/shared';
import { Hash, MessageSquare, RefreshCw, Send, Sparkles, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAppStore } from '../../stores/appStore.js';

type SelectedTarget =
  | { kind: 'chat'; chat: TeamsChatSummary }
  | { kind: 'channel'; team: TeamSummary; channel: ChannelSummary };

export function TeamsScreen() {
  const qc = useQueryClient();
  const { launchPromptInChat, selectedChatId, clearSelectedChatId } = useAppStore();

  const [filterText, setFilterText] = useState('');
  const [chatTypeFilter, setChatTypeFilter] = useState<'all' | 'oneOnOne' | 'meeting'>('all');
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  const [composer, setComposer] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [dmEmail, setDmEmail] = useState('');
  const [dmText, setDmText] = useState('');
  const [dmFeedback, setDmFeedback] = useState<string | null>(null);
  const [channelInspect, setChannelInspect] = useState<'none' | 'files' | 'members'>('none');

  const { data: channelFiles } = useQuery({
    queryKey: ['channel-files', selected?.kind === 'channel' ? selected.channel.id : ''],
    queryFn: () =>
      selected?.kind === 'channel'
        ? apiFetch<{ items: Array<Record<string, any>> }>(
            `/api/teams/${encodeURIComponent(selected.team.id)}/channels/${encodeURIComponent(selected.channel.id)}/files`
          )
        : Promise.resolve({ items: [] }),
    enabled: selected?.kind === 'channel' && channelInspect === 'files',
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team-members', selected?.kind === 'channel' ? selected.team.id : ''],
    queryFn: () =>
      selected?.kind === 'channel'
        ? apiFetch<Array<{ id: string; displayName?: string; userPrincipalName?: string }>>(
            `/api/teams/${encodeURIComponent(selected.team.id)}/members`
          )
        : Promise.resolve([]),
    enabled: selected?.kind === 'channel' && channelInspect === 'members',
  });

  const { data: chatsRes, refetch: refetchChats, isFetching: loadingChats } = useQuery({
    queryKey: ['teams-chats'],
    queryFn: () => apiFetch<{ source: string; chats: TeamsChatSummary[] }>('/api/teams/chats?refresh=true'),
  });

  useEffect(() => {
    if (!selectedChatId || !chatsRes?.chats) return;
    const target = chatsRes.chats.find((c) => c.id === selectedChatId);
    if (target) {
      setSelected({ kind: 'chat', chat: target });
      setReplyToId(null);
      clearSelectedChatId();
    }
  }, [selectedChatId, chatsRes?.chats, clearSelectedChatId]);

  const { data: teamsRes, refetch: refetchTeams, isFetching: loadingTeams } = useQuery({
    queryKey: ['teams-list'],
    queryFn: () =>
      apiFetch<{ source: string; teams: Array<{ team: TeamSummary; channels: ChannelSummary[] }> }>(
        '/api/teams/list?refresh=true'
      ),
  });

  const { data: messages = [], refetch: refetchMessages, isFetching: loadingMsgs } = useQuery({
    queryKey: [
      'teams-messages',
      selected?.kind,
      selected?.kind === 'chat' ? selected.chat.id : selected?.channel.id,
    ],
    queryFn: () => {
      if (!selected) return Promise.resolve([]);
      if (selected.kind === 'chat') {
        return apiFetch<TeamsMessageItem[]>(
          `/api/teams/chats/${encodeURIComponent(selected.chat.id)}/messages?limit=40`
        );
      }
      return apiFetch<TeamsMessageItem[]>(
        `/api/teams/${encodeURIComponent(selected.team.id)}/channels/${encodeURIComponent(selected.channel.id)}/messages?limit=25`
      );
    },
    enabled: Boolean(selected),
  });

  const sendMsgMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !composer.trim()) return;
      if (selected.kind === 'chat') {
        return apiFetch(`/api/teams/chats/${encodeURIComponent(selected.chat.id)}/send`, {
          method: 'POST',
          body: JSON.stringify({ content: composer }),
        });
      }
      return apiFetch(
        `/api/teams/${encodeURIComponent(selected.team.id)}/channels/${encodeURIComponent(selected.channel.id)}/send`,
        {
          method: 'POST',
          body: JSON.stringify({ content: composer, replyToMessageId: replyToId || undefined }),
        }
      );
    },
    onSuccess: () => {
      setComposer('');
      setReplyToId(null);
      refetchMessages();
    },
  });

  const sendDmMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ recipientName: string }>('/api/teams/dm', {
        method: 'POST',
        body: JSON.stringify({ userEmailOrId: dmEmail, content: dmText }),
      }),
    onSuccess: (res) => {
      setDmText('');
      setDmFeedback(`Sent DM to ${res.recipientName}`);
      qc.invalidateQueries({ queryKey: ['teams-chats'] });
    },
    onError: (err) => setDmFeedback((err as Error).message),
  });

  const chats = (chatsRes?.chats || []).filter((c) => {
    if (chatTypeFilter !== 'all' && c.chatType !== chatTypeFilter) return false;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      return (
        c.displayTitle.toLowerCase().includes(q) ||
        (c.lastMessagePreview?.bodyText || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const teams = (teamsRes?.teams || []).filter((t) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return (
      t.team.displayName.toLowerCase().includes(q) ||
      t.channels.some((ch) => ch.displayName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[270px_minmax(0,1fr)_280px] overflow-hidden bg-white">
      {/* Left Chats + Teams Tree */}
      <aside className="flex min-w-0 flex-col border-r border-slate-200 bg-slate-50 overflow-hidden">
        <div className="border-b border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between">
            <strong className="text-xs text-slate-900">Chats &amp; Channels</strong>
            <button
              onClick={() => {
                refetchChats();
                refetchTeams();
              }}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              title="Refresh live from Microsoft Graph"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingChats || loadingTeams ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter people, chats, teams..."
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
          <div className="flex gap-1">
            {(['all', 'oneOnOne', 'meeting'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setChatTypeFilter(f)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-mono border ${
                  chatTypeFilter === f
                    ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                {f === 'all' ? 'All' : f === 'oneOnOne' ? '1:1 DMs' : 'Meetings'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
          <div>
            <div className="px-1 pb-1 text-[10px] font-mono font-semibold uppercase text-slate-400">
              Chats ({chats.length})
            </div>
            <div className="space-y-1">
              {chats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelected({ kind: 'chat', chat: c });
                    setReplyToId(null);
                  }}
                  className={`w-full text-left rounded-lg border p-2 text-xs transition ${
                    selected?.kind === 'chat' && selected.chat.id === c.id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-slate-900 truncate">{c.displayTitle}</span>
                    <span className="rounded bg-slate-100 px-1.5 text-[10px] font-mono text-slate-500">
                      {c.chatType === 'oneOnOne' ? '1:1' : c.chatType}
                    </span>
                  </div>
                  {c.lastMessagePreview?.bodyText && (
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      {c.lastMessagePreview.bodyText}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="px-1 pb-1 text-[10px] font-mono font-semibold uppercase text-slate-400">
              Teams &amp; Channels ({teams.length})
            </div>
            <div className="space-y-2">
              {teams.map(({ team, channels }) => (
                <div key={team.id} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                    <span className="truncate">{team.displayName}</span>
                  </div>
                  <div className="mt-1.5 space-y-0.5 pl-2">
                    {channels.map((ch) => (
                      <button
                        key={ch.id}
                        onClick={() => {
                          setSelected({ kind: 'channel', team, channel: ch });
                          setReplyToId(null);
                        }}
                        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                          selected?.kind === 'channel' && selected.channel.id === ch.id
                            ? 'bg-blue-50 font-semibold text-blue-700'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Hash className="h-3 w-3 shrink-0" />
                        <span className="truncate">{ch.displayName}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Center Message Stream */}
      <section className="flex min-w-0 flex-col overflow-hidden">
        {!selected ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-slate-500">
            Select a 1:1 chat, meeting chat, or Teams channel on the left to read threads, replies, or post messages.
          </div>
        ) : (
          <>
            <header className="border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 truncate">
                  {selected.kind === 'chat'
                    ? selected.chat.displayTitle
                    : `${selected.team.displayName} > #${selected.channel.displayName}`}
                </h2>
                <div className="text-[11px] font-mono text-slate-500">
                  {selected.kind === 'chat'
                    ? `Chat Type: ${selected.chat.chatType}`
                    : 'Channel messages with expanded replies'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {selected.kind === 'channel' && (
                  <>
                    <button
                      onClick={() => setChannelInspect(channelInspect === 'files' ? 'none' : 'files')}
                      className={`rounded-lg border px-2.5 py-1 text-xs ${
                        channelInspect === 'files'
                          ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Files
                    </button>
                    <button
                      onClick={() => setChannelInspect(channelInspect === 'members' ? 'none' : 'members')}
                      className={`rounded-lg border px-2.5 py-1 text-xs ${
                        channelInspect === 'members'
                          ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Members
                    </button>
                  </>
                )}
                <button
                  onClick={() => refetchMessages()}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Refresh
                </button>
                <button
                  onClick={() => {
                    if (selected.kind === 'chat') {
                      launchPromptInChat(
                        `Read recent messages from my Teams chat with "${selected.chat.displayTitle}" and summarize key updates and open questions.`
                      );
                    } else {
                      launchPromptInChat(
                        `Read recent posts and replies from Teams channel "${selected.team.displayName} > #${selected.channel.displayName}" and summarize unanswered questions and decisions.`
                      );
                    }
                  }}
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Summarize with AI
                </button>
              </div>
            </header>

            {selected.kind === 'channel' && channelInspect !== 'none' && (
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs max-h-40 overflow-y-auto">
                {channelInspect === 'files' ? (
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-800">Channel Files</div>
                    {(channelFiles?.items || []).length === 0 ? (
                      <div className="text-slate-500">No files in channel folder.</div>
                    ) : (
                      (channelFiles?.items || []).map((f: any) => (
                        <div key={f.id} className="flex justify-between gap-2">
                          <span className="truncate">{f.folder ? '📁' : '📄'} {f.name}</span>
                          {f.webUrl && (
                            <a href={f.webUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline shrink-0">
                              Open
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-800">Team Members ({teamMembers.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                      {teamMembers.map((m) => (
                        <span key={m.id} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px]">
                          {m.displayName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-3">
              {loadingMsgs && <div className="text-xs text-blue-600">Loading messages...</div>}
              {messages.map((m) => (
                <div key={m.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-2 [overflow-wrap:anywhere]">
                  <div className="flex items-center justify-between">
                    <strong className="text-slate-900">{m.senderName}</strong>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-slate-400">
                        {m.createdDateTime.slice(0, 16).replace('T', ' ')}
                      </span>
                      {selected.kind === 'channel' && (
                        <button
                          onClick={() => setReplyToId(m.id)}
                          className="text-[11px] font-medium text-blue-600 hover:underline"
                        >
                          Reply
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-slate-700 whitespace-pre-wrap">{m.bodyText || '(empty / adaptive card)'}</p>

                  {m.replies && m.replies.length > 0 && (
                    <div className="border-l-2 border-slate-200 pl-3 space-y-1.5 bg-slate-50 p-2 rounded">
                      {m.replies.map((r) => (
                        <div key={r.id}>
                          <span className="font-semibold text-slate-800">{r.senderName}</span>{' '}
                          <span className="font-mono text-[10px] text-slate-400">
                            {r.createdDateTime.slice(11, 16)}
                          </span>
                          <div className="text-slate-700">{r.bodyText}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-3 space-y-2">
              {replyToId && (
                <div className="flex items-center justify-between rounded bg-blue-50 px-2.5 py-1 text-[11px] text-blue-800">
                  <span>Replying to thread message {replyToId.slice(0, 16)}...</span>
                  <button onClick={() => setReplyToId(null)} className="underline">
                    Cancel reply
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMsgMutation.mutate();
                    }
                  }}
                  placeholder={
                    selected.kind === 'chat'
                      ? `Message ${selected.chat.displayTitle}...`
                      : `Post to #${selected.channel.displayName}...`
                  }
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
                <button
                  onClick={() => sendMsgMutation.mutate()}
                  disabled={!composer.trim() || sendMsgMutation.isPending}
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> Send
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Right Quick Operations */}
      <aside className="hidden lg:flex flex-col border-l border-slate-200 bg-slate-50 p-4 space-y-4 overflow-y-auto">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <UserPlus className="h-3.5 w-3.5 text-blue-600" />
            Direct Message Colleague
          </div>
          <input
            value={dmEmail}
            onChange={(e) => setDmEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
          <textarea
            value={dmText}
            onChange={(e) => setDmText(e.target.value)}
            rows={3}
            placeholder="Write a 1:1 Teams DM..."
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
          <button
            onClick={() => sendDmMutation.mutate()}
            disabled={!dmEmail.trim() || !dmText.trim() || sendDmMutation.isPending}
            className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {sendDmMutation.isPending ? 'Sending DM...' : 'Send 1:1 DM'}
          </button>
          {dmFeedback && <div className="text-[11px] text-slate-700">{dmFeedback}</div>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
            Agent Operations
          </div>
          <button
            onClick={() =>
              launchPromptInChat(
                'Scan my recent Teams chats and channels, find any unanswered questions or direct requests aimed at me, and list them with suggested replies.'
              )
            }
            className="w-full text-left rounded-lg border border-slate-200 px-2.5 py-2 text-xs hover:bg-slate-50"
          >
            Find unanswered questions &amp; mentions
          </button>
          <button
            onClick={() =>
              launchPromptInChat(
                'Check all Teams channel discussions from this week and cross-reference them with extracted meeting transcripts.'
              )
            }
            className="w-full text-left rounded-lg border border-slate-200 px-2.5 py-2 text-xs hover:bg-slate-50"
          >
            Cross-reference channels with transcripts
          </button>
        </div>
      </aside>
    </div>
  );
}
