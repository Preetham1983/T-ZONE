import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function joinSegments(base: string, spoken: string): string {
  const cleanSpoken = spoken.trim();
  if (!cleanSpoken) return base;
  if (!base.trim()) return cleanSpoken;
  const separator = /\s$/.test(base) ? '' : ' ';
  return `${base}${separator}${cleanSpoken}`;
}

export interface UseVoiceInputOptions {
  currentText: string;
  onTextChange: (nextText: string) => void;
  onSubmitText?: (finalText: string) => void;
}

const DEFAULT_BARS = [0.2, 0.25, 0.2, 0.28, 0.22, 0.26, 0.2, 0.24];

export function useVoiceInput({ currentText, onTextChange, onSubmitText }: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(DEFAULT_BARS);
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState('');

  const supported = typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const activeRef = useRef(false);
  const ignoreEventsRef = useRef(false);
  const basePrefixRef = useRef('');
  const committedFinalRef = useRef('');
  const interimRef = useRef('');

  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const onSubmitTextRef = useRef(onSubmitText);
  onSubmitTextRef.current = onSubmitText;
  const currentTextRef = useRef(currentText);
  currentTextRef.current = currentText;

  const cleanupAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setLevels(DEFAULT_BARS);
  }, []);

  const teardownRecognition = useCallback(
    (abort = false) => {
      activeRef.current = false;
      setIsListening(false);
      setInterimText('');
      cleanupAudio();
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          if (abort) rec.abort();
          else rec.stop();
        } catch {
          // ignore stop race
        }
      }
    },
    [cleanupAudio]
  );

  useEffect(() => {
    return () => {
      ignoreEventsRef.current = true;
      teardownRecognition(true);
    };
  }, [teardownRecognition]);

  const startVisualizer = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      mediaStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!activeRef.current) return;
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: 8 }, (_, idx) => {
          const val = data[idx + 1] ?? 0;
          return Math.max(0.18, Math.min(1, val / 160));
        });
        setLevels(bars);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Visualizer is optional; Web Speech API can still work if mic access was granted to recognition
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError('Voice input requires Chrome or Microsoft Edge.');
      return;
    }
    if (activeRef.current) return;

    setError(null);
    ignoreEventsRef.current = false;
    activeRef.current = true;
    basePrefixRef.current = currentTextRef.current;
    committedFinalRef.current = '';
    interimRef.current = '';
    setElapsedSeconds(0);
    setIsListening(true);

    timerRef.current = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    void startVisualizer();

    const attachAndStart = () => {
      if (!activeRef.current) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';

      let sessionFinal = '';

      rec.onresult = (ev) => {
        if (ignoreEventsRef.current) return;
        let nextInterim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          const txt = res[0]?.transcript || '';
          if (res.isFinal) {
            sessionFinal = joinSegments(sessionFinal, txt);
          } else {
            nextInterim = joinSegments(nextInterim, txt);
          }
        }
        const totalFinal = joinSegments(committedFinalRef.current, sessionFinal);
        interimRef.current = nextInterim;
        setInterimText(nextInterim);
        const combinedSpoken = joinSegments(totalFinal, nextInterim);
        onTextChangeRef.current(joinSegments(basePrefixRef.current, combinedSpoken));
      };

      rec.onerror = (ev) => {
        if (ignoreEventsRef.current) return;
        if (ev.error === 'no-speech') return;
        const msg =
          ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
            ? 'Microphone permission denied — allow mic access for localhost:3100 in browser settings.'
            : ev.error === 'audio-capture'
              ? 'No microphone detected.'
              : ev.error === 'network'
                ? 'Browser speech service unreachable (network).'
                : `Voice error: ${ev.error}`;
        setError(msg);
        teardownRecognition(true);
      };

      rec.onend = () => {
        if (!activeRef.current || ignoreEventsRef.current) return;
        // Commit any final speech before transparently restarting continuous listening
        committedFinalRef.current = joinSegments(committedFinalRef.current, sessionFinal);
        sessionFinal = '';
        attachAndStart();
      };

      recognitionRef.current = rec;
      try {
        rec.start();
      } catch (err) {
        setError((err as Error).message || 'Could not start voice recognition');
        teardownRecognition(true);
      }
    };

    attachAndStart();
  }, [startVisualizer, teardownRecognition]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    ignoreEventsRef.current = true;
    const finalized = currentTextRef.current.trim();
    teardownRecognition(false);
    onTextChangeRef.current(finalized);
  }, [teardownRecognition]);

  const stopAndSend = useCallback(() => {
    if (!activeRef.current) return;
    ignoreEventsRef.current = true;
    const finalized = currentTextRef.current.trim();
    teardownRecognition(false);
    if (finalized) {
      onSubmitTextRef.current?.(finalized);
    }
  }, [teardownRecognition]);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    ignoreEventsRef.current = true;
    const original = basePrefixRef.current;
    teardownRecognition(true);
    onTextChangeRef.current(original);
  }, [teardownRecognition]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [start, stop]);

  return {
    supported,
    isListening,
    elapsedSeconds,
    levels,
    interimText,
    error,
    clearError: () => setError(null),
    start,
    stop,
    stopAndSend,
    cancel,
    toggle,
  };
}
