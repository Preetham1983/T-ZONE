import type { SpeakerStat, TranscriptSegment } from '@tzone/shared';

function timestampToSeconds(ts: string): number {
  const parts = ts.trim().split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number.parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number.parseFloat(parts[1]);
  }
  return 0;
}

function formatShortTimestamp(ts: string): string {
  return ts.trim().split('.')[0];
}

export function parseVtt(rawVtt: string): {
  segments: TranscriptSegment[];
  speakerStats: SpeakerStat[];
  plainText: string;
} {
  const normalized = (rawVtt || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const segments: TranscriptSegment[] = [];
  const timeRe = /^(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)/;
  const voiceRe = /^<v\s+([^>]+)>([\s\S]*)$/i;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const match = line.match(timeRe);
    if (!match) {
      i++;
      continue;
    }

    const startTime = formatShortTimestamp(match[1]);
    const endTime = formatShortTimestamp(match[2]);
    const startSeconds = timestampToSeconds(match[1]);

    i++;
    const cueLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      cueLines.push(lines[i].trim());
      i++;
    }

    const combined = cueLines.join(' ').trim();
    if (!combined) continue;

    let speaker = 'Speaker';
    let text = combined;
    const vMatch = combined.match(voiceRe);
    if (vMatch) {
      speaker = vMatch[1].trim() || 'Speaker';
      text = vMatch[2].replace(/<\/v>/gi, '').trim();
    } else {
      const colonIdx = combined.indexOf(': ');
      if (colonIdx > 1 && colonIdx < 40 && !combined.slice(0, colonIdx).includes('http')) {
        speaker = combined.slice(0, colonIdx).trim();
        text = combined.slice(colonIdx + 2).trim();
      }
    }

    text = text.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    segments.push({
      index: segments.length,
      startTime,
      endTime,
      startSeconds,
      speaker,
      text,
    });
  }

  // Fallback for non-VTT plain text transcripts
  if (segments.length === 0 && normalized.trim()) {
    const textLines = normalized
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && l !== 'WEBVTT');
    textLines.forEach((line, idx) => {
      segments.push({
        index: idx,
        startTime: '00:00:00',
        endTime: '00:00:00',
        startSeconds: 0,
        speaker: 'Transcript',
        text: line,
      });
    });
  }

  const counts = new Map<string, { segmentCount: number; wordCount: number }>();
  let totalWords = 0;
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean).length;
    totalWords += words;
    const prev = counts.get(seg.speaker) || { segmentCount: 0, wordCount: 0 };
    counts.set(seg.speaker, {
      segmentCount: prev.segmentCount + 1,
      wordCount: prev.wordCount + words,
    });
  }

  const speakerStats: SpeakerStat[] = Array.from(counts.entries())
    .map(([speaker, st]) => ({
      speaker,
      segmentCount: st.segmentCount,
      wordCount: st.wordCount,
      sharePercent: totalWords > 0 ? Math.round((st.wordCount / totalWords) * 100) : 0,
    }))
    .sort((a, b) => b.wordCount - a.wordCount);

  const plainText = segments
    .map((s) => `[${s.startTime}] ${s.speaker}: ${s.text}`)
    .join('\n');

  return { segments, speakerStats, plainText };
}
