import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar as CalendarIcon,
  Clock,
  ExternalLink,
  FileAudio,
  Headphones,
  List,
  MapPin,
  Plus,
  RefreshCw,
  Sparkles,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAppStore } from '../../stores/appStore.js';

interface GraphCalendarEvent {
  id: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  isCancelled?: boolean;
  showAs?: string;
  responseStatus?: { response?: string };
  bodyPreview?: string;
  webLink?: string;
  attendees?: Array<{
    emailAddress?: { name?: string; address?: string };
    type?: string;
    status?: { response?: string };
  }>;
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(iso?: string): string {
  return (iso || '').slice(0, 10);
}

function formatTime(iso?: string): string {
  if (!iso) return '--:--';
  const timePart = iso.slice(11, 16);
  const [hStr, mStr] = timePart.split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr} ${suffix}`;
}

function durationLabel(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) return '';
  const diffMin = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  if (!Number.isFinite(diffMin) || diffMin <= 0) return '';
  if (diffMin < 60) return `${diffMin}m`;
  const hrs = Math.floor(diffMin / 60);
  const rem = diffMin % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatDayHeading(dateKey: string): string {
  const todayKey = toLocalDateKey(new Date());
  const tomorrowKey = toLocalDateKey(new Date(Date.now() + 86400 * 1000));
  const dateObj = new Date(`${dateKey}T12:00:00`);
  const formatted = dateObj.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  if (dateKey === todayKey) return `Today · ${formatted}`;
  if (dateKey === tomorrowKey) return `Tomorrow · ${formatted}`;
  return formatted;
}

function getShowAsAccent(ev: GraphCalendarEvent): string {
  if (ev.isCancelled || (ev.subject || '').toLowerCase().startsWith('canceled:')) {
    return 'border-l-slate-300 bg-slate-50/70 opacity-70';
  }
  switch (ev.showAs) {
    case 'tentative':
      return 'border-l-amber-400 bg-white';
    case 'oof':
      return 'border-l-violet-500 bg-white';
    case 'free':
      return 'border-l-emerald-500 bg-white';
    default:
      return 'border-l-blue-600 bg-white';
  }
}

export function CalendarView() {
  const qc = useQueryClient();
  const { launchPromptInChat, openMeetingAgentWithDraft } = useAppStore();
  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const [viewMode, setViewMode] = useState<'agenda' | 'week'>('agenda');
  const [hideCanceled, setHideCanceled] = useState(true);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<GraphCalendarEvent | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  // Schedule form state
  const [newSubject, setNewSubject] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newStart, setNewStart] = useState('10:00');
  const [newEnd, setNewEnd] = useState('10:30');
  const [newAttendees, setNewAttendees] = useState('');
  const [newBody, setNewBody] = useState('');

  const { data: events = [], isFetching, refetch } = useQuery({
    queryKey: ['m365-calendar', localTz],
    queryFn: () =>
      apiFetch<GraphCalendarEvent[]>(
        `/api/m365/calendar?limit=60&days=14&pastDays=0&tz=${encodeURIComponent(localTz)}`
      ),
  });

  const createMeeting = useMutation({
    mutationFn: () =>
      apiFetch('/api/m365/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          subject: newSubject,
          start: `${newDate}T${newStart}`,
          end: `${newDate}T${newEnd}`,
          timezone: localTz,
          attendees: newAttendees
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          body: newBody || undefined,
          location: 'Microsoft Teams',
        }),
      }),
    onSuccess: () => {
      setShowNewModal(false);
      setNewSubject('');
      setNewAttendees('');
      setNewBody('');
      qc.invalidateQueries({ queryKey: ['m365-calendar'] });
    },
  });

  const isEventCanceled = (ev: GraphCalendarEvent) =>
    Boolean(ev.isCancelled) || (ev.subject || '').toLowerCase().startsWith('canceled:');

  const canceledCount = events.filter(isEventCanceled).length;

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (hideCanceled && isEventCanceled(ev)) return false;
      if (onlineOnly && !ev.isOnlineMeeting) return false;
      return true;
    });
  }, [events, hideCanceled, onlineOnly]);

  const groupedByDay = useMemo(() => {
    const map = new Map<string, GraphCalendarEvent[]>();
    for (const ev of filteredEvents) {
      const k = parseDateKey(ev.start?.dateTime);
      if (!k) continue;
      const arr = map.get(k) || [];
      arr.push(ev);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEvents]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400 * 1000);
      return {
        key: toLocalDateKey(d),
        weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
        dayNum: d.getDate(),
        month: d.toLocaleDateString(undefined, { month: 'short' }),
      };
    });
  }, []);

  const eventsByDayMap = useMemo(() => new Map(groupedByDay), [groupedByDay]);

  const nextMeeting = useMemo(() => {
    const nowMs = Date.now();
    return filteredEvents.find((ev) => {
      const endMs = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : 0;
      return !isEventCanceled(ev) && endMs >= nowMs;
    });
  }, [filteredEvents]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setViewMode('agenda')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                viewMode === 'agenda' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="h-3.5 w-3.5" /> Agenda
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                viewMode === 'week' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarIcon className="h-3.5 w-3.5" /> 7-Day Grid
            </button>
          </div>

          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={hideCanceled}
              onChange={(e) => setHideCanceled(e.target.checked)}
              className="rounded border-slate-300"
            />
            Hide canceled ({canceledCount})
          </label>

          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            Teams meetings only
          </label>

          <span className="rounded bg-white border border-slate-200 px-2 py-1 text-[11px] font-mono text-slate-500">
            TZ: {localTz}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" /> Schedule Meeting
          </button>
        </div>
      </div>

      {/* Next Up Highlight Banner */}
      {nextMeeting && (
        <div className="rounded-xl border border-blue-200 bg-linear-to-r from-blue-50 to-indigo-50/70 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-mono font-semibold text-white uppercase">
                Next Up
              </span>
              <span className="text-xs font-mono text-blue-900">
                {formatDayHeading(parseDateKey(nextMeeting.start?.dateTime))} · {formatTime(nextMeeting.start?.dateTime)} –{' '}
                {formatTime(nextMeeting.end?.dateTime)} ({durationLabel(nextMeeting.start?.dateTime, nextMeeting.end?.dateTime)})
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">{nextMeeting.subject || '(no title)'}</h3>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
              <span>Organizer: {nextMeeting.organizer?.emailAddress?.name || 'Unknown'}</span>
              {nextMeeting.attendees && <span>{nextMeeting.attendees.length} attendees</span>}
              {nextMeeting.location?.displayName && <span>@ {nextMeeting.location.displayName}</span>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {nextMeeting.onlineMeeting?.joinUrl && (
              <a
                href={nextMeeting.onlineMeeting.joinUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Video className="h-3.5 w-3.5" /> Join Teams
              </a>
            )}
            <button
              onClick={() =>
                openMeetingAgentWithDraft({
                  subject: nextMeeting.subject || 'Teams Meeting',
                  organizerName: nextMeeting.organizer?.emailAddress?.name || '',
                  startDateTime: nextMeeting.start?.dateTime || '',
                  endDateTime: nextMeeting.end?.dateTime || '',
                  joinUrl: nextMeeting.onlineMeeting?.joinUrl || nextMeeting.onlineMeetingUrl || '',
                  attendees: (nextMeeting.attendees || []).map((a) => ({
                    name: a.emailAddress?.name || a.emailAddress?.address || 'Attendee',
                    email: a.emailAddress?.address,
                  })),
                })
              }
              className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <Headphones className="h-3.5 w-3.5" /> Assign Meeting Agent
            </button>
            <button
              onClick={() =>
                launchPromptInChat(
                  `Prepare me for my upcoming meeting "${nextMeeting.subject}" with ${nextMeeting.organizer?.emailAddress?.name || 'the team'}. Check recent Teams chats, emails, and any past transcripts from similar meetings.`
                )
              }
              className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              <Sparkles className="h-3.5 w-3.5" /> Prep with Agent
            </button>
          </div>
        </div>
      )}

      {/* Main Layout: Agenda/Week + Optional Event Detail Side Panel */}
      <div className={`grid gap-4 ${selectedEvent ? 'grid-cols-1 xl:grid-cols-[1fr_340px]' : 'grid-cols-1'}`}>
        <div>
          {viewMode === 'agenda' ? (
            <div className="space-y-4">
              {groupedByDay.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
                  No meetings match the current filters.
                </div>
              )}
              {groupedByDay.map(([dateKey, dayEvents]) => (
                <div key={dateKey} className="space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                      {formatDayHeading(dateKey)}
                    </h4>
                    <span className="font-mono text-[11px] text-slate-400">{dayEvents.length} events</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {dayEvents.map((ev) => {
                      const canceled = isEventCanceled(ev);
                      const joinUrl = ev.onlineMeeting?.joinUrl || ev.onlineMeetingUrl;
                      const isSelected = selectedEvent?.id === ev.id;
                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className={`cursor-pointer rounded-xl border border-l-4 p-3 transition shadow-2xs ${getShowAsAccent(ev)} ${
                            isSelected ? 'ring-2 ring-blue-500 border-blue-300' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span>
                                  {formatTime(ev.start?.dateTime)} – {formatTime(ev.end?.dateTime)}
                                </span>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                                  {durationLabel(ev.start?.dateTime, ev.end?.dateTime)}
                                </span>
                              </div>
                              <div
                                className={`mt-1 text-sm font-semibold text-slate-900 truncate ${
                                  canceled ? 'line-through text-slate-500' : ''
                                }`}
                              >
                                {ev.subject || '(no title)'}
                              </div>
                            </div>
                            {ev.isOnlineMeeting && (
                              <span className="shrink-0 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-mono text-indigo-700">
                                Teams
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <div className="flex items-center gap-2 truncate">
                              <span className="truncate">{ev.organizer?.emailAddress?.name || 'Organizer'}</span>
                              {ev.location?.displayName && (
                                <span className="flex items-center gap-0.5 truncate">
                                  <MapPin className="h-3 w-3 shrink-0" /> {ev.location.displayName}
                                </span>
                              )}
                            </div>
                            {ev.attendees && ev.attendees.length > 0 && (
                              <span className="flex items-center gap-1 font-mono text-[10px]">
                                <Users className="h-3 w-3" /> {ev.attendees.length}
                              </span>
                            )}
                          </div>

                          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                            {joinUrl && !canceled && (
                              <a
                                href={joinUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                              >
                                <Video className="h-3 w-3" /> Join
                              </a>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                launchPromptInChat(
                                  `Check if there is a transcript or Copilot recap for "${ev.subject}" around ${parseDateKey(ev.start?.dateTime)}, and summarize any decisions or action items.`
                                );
                              }}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                            >
                              <FileAudio className="h-3 w-3" /> Transcript
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                launchPromptInChat(
                                  `Prepare a brief for "${ev.subject}" with ${ev.organizer?.emailAddress?.name || 'attendees'} using recent Teams messages and emails.`
                                );
                              }}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                            >
                              <Sparkles className="h-3 w-3" /> Prep
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* 7-Day Grid View */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
              {weekDays.map((day) => {
                const dayList = eventsByDayMap.get(day.key) || [];
                const isToday = day.key === toLocalDateKey(new Date());
                return (
                  <div
                    key={day.key}
                    className={`rounded-xl border p-2.5 min-h-64 flex flex-col gap-2 ${
                      isToday ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                      <div>
                        <div className="text-[10px] font-mono uppercase text-slate-500">{day.weekday}</div>
                        <div className={`text-sm font-bold ${isToday ? 'text-blue-700' : 'text-slate-900'}`}>
                          {day.month} {day.dayNum}
                        </div>
                      </div>
                      <span className="rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                        {dayList.length}
                      </span>
                    </div>

                    <div className="space-y-1.5 flex-1">
                      {dayList.length === 0 ? (
                        <div className="pt-6 text-center text-[11px] text-slate-400">Clear</div>
                      ) : (
                        dayList.map((ev) => (
                          <button
                            key={ev.id}
                            onClick={() => setSelectedEvent(ev)}
                            className={`w-full text-left rounded-lg border border-l-4 p-2 transition ${getShowAsAccent(ev)} ${
                              selectedEvent?.id === ev.id ? 'ring-2 ring-blue-500' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="font-mono text-[10px] text-slate-500">
                              {formatTime(ev.start?.dateTime)}
                            </div>
                            <div
                              className={`text-xs font-semibold text-slate-900 line-clamp-2 ${
                                isEventCanceled(ev) ? 'line-through' : ''
                              }`}
                            >
                              {ev.subject || '(no title)'}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Event Detail Drawer */}
        {selectedEvent && (
          <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 h-fit">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-mono font-semibold text-blue-800 uppercase">
                  {selectedEvent.showAs || 'busy'}
                </span>
                <h3 className="mt-1.5 text-sm font-bold text-slate-900">
                  {selectedEvent.subject || '(no title)'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1 text-xs text-slate-700 font-mono">
              <div>
                {formatDayHeading(parseDateKey(selectedEvent.start?.dateTime))}
              </div>
              <div>
                {formatTime(selectedEvent.start?.dateTime)} → {formatTime(selectedEvent.end?.dateTime)} (
                {durationLabel(selectedEvent.start?.dateTime, selectedEvent.end?.dateTime)})
              </div>
              <div>Organizer: {selectedEvent.organizer?.emailAddress?.name || 'N/A'}</div>
              {selectedEvent.location?.displayName && <div>Location: {selectedEvent.location.displayName}</div>}
            </div>

            {selectedEvent.bodyPreview && (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700 max-h-36 overflow-y-auto">
                {selectedEvent.bodyPreview}
              </div>
            )}

            {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-800">
                  Attendees ({selectedEvent.attendees.length})
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {selectedEvent.attendees.map((a, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded bg-white border border-slate-200 px-2 py-1 text-[11px]"
                    >
                      <span className="truncate text-slate-800">
                        {a.emailAddress?.name || a.emailAddress?.address}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {a.status?.response || 'none'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  openMeetingAgentWithDraft({
                    subject: selectedEvent.subject || 'Teams Meeting',
                    organizerName: selectedEvent.organizer?.emailAddress?.name || '',
                    startDateTime: selectedEvent.start?.dateTime || '',
                    endDateTime: selectedEvent.end?.dateTime || '',
                    joinUrl: selectedEvent.onlineMeeting?.joinUrl || selectedEvent.onlineMeetingUrl || '',
                    attendees: (selectedEvent.attendees || []).map((a) => ({
                      name: a.emailAddress?.name || a.emailAddress?.address || 'Attendee',
                      email: a.emailAddress?.address,
                    })),
                  })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <Headphones className="h-3.5 w-3.5" /> Assign Agent
              </button>
              {(selectedEvent.onlineMeeting?.joinUrl || selectedEvent.onlineMeetingUrl) && (
                <a
                  href={selectedEvent.onlineMeeting?.joinUrl || selectedEvent.onlineMeetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Video className="h-3.5 w-3.5" /> Join Teams
                </a>
              )}
              {selectedEvent.webLink && (
                <a
                  href={selectedEvent.webLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Outlook
                </a>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Schedule Meeting Modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Schedule Teams Meeting</h3>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div>
                <label className="block font-mono text-slate-600 mb-1">TITLE</label>
                <input
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Ontology Sync / Architecture Review"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-mono text-slate-600 mb-1">DATE</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-mono text-slate-600 mb-1">START</label>
                  <input
                    type="time"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-mono text-slate-600 mb-1">END</label>
                  <input
                    type="time"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                </div>
              </div>
              <div>
                <label className="block font-mono text-slate-600 mb-1">ATTENDEES (comma-separated emails)</label>
                <input
                  value={newAttendees}
                  onChange={(e) => setNewAttendees(e.target.value)}
                  placeholder="alice@company.com, bob@company.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-mono text-slate-600 mb-1">AGENDA (optional)</label>
                <textarea
                  rows={2}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            {createMeeting.isError && (
              <p className="text-xs text-red-600">{(createMeeting.error as Error).message}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewModal(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => createMeeting.mutate()}
                disabled={!newSubject.trim() || createMeeting.isPending}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createMeeting.isPending ? 'Scheduling...' : 'Create Teams Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
