import { Check, CornerDownLeft, Mic, Square, X } from 'lucide-react';

interface VoiceControlsProps {
  supported: boolean;
  isListening: boolean;
  elapsedSeconds: number;
  levels: number[];
  error: string | null;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onStopAndSend?: () => void;
  onCancel: () => void;
  onClearError: () => void;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function VoiceStatusStrip({
  isListening,
  elapsedSeconds,
  levels,
  error,
  onStop,
  onStopAndSend,
  onCancel,
  onClearError,
}: Pick<
  VoiceControlsProps,
  'isListening' | 'elapsedSeconds' | 'levels' | 'error' | 'onStop' | 'onStopAndSend' | 'onCancel' | 'onClearError'
>) {
  if (!isListening && !error) return null;

  if (error) {
    return (
      <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
        <span>{error}</span>
        <button type="button" onClick={onClearError} className="text-red-500 hover:text-red-800">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-1.5 font-medium text-rose-700">
          <span className="h-2 w-2 rounded-full bg-rose-600 animate-ping" />
          Listening
        </span>
        <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
          {levels.map((lv, idx) => (
            <span
              key={idx}
              className="w-1 rounded-full bg-rose-500 transition-all duration-75"
              style={{ height: `${Math.round(lv * 16)}px` }}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-rose-700">{formatSeconds(elapsedSeconds)}</span>
        <span className="hidden sm:inline text-[11px] text-rose-600/80">
          Press Enter to send · Esc to cancel
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onStop}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          title="Stop listening and keep text to edit"
        >
          <Check className="h-3 w-3 text-emerald-600" />
          Stop
        </button>
        {onStopAndSend && (
          <button
            type="button"
            onClick={onStopAndSend}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
            title="Stop listening and send prompt"
          >
            <CornerDownLeft className="h-3 w-3" />
            Stop &amp; Send
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center rounded-md p-1 text-slate-500 hover:bg-rose-100 hover:text-rose-800"
          title="Cancel dictation (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function VoiceMicButton({
  supported,
  isListening,
  disabled,
  onStart,
  onStop,
}: Pick<VoiceControlsProps, 'supported' | 'isListening' | 'disabled' | 'onStart' | 'onStop'>) {
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={isListening ? onStop : onStart}
      disabled={disabled}
      title={isListening ? 'Stop voice input (Ctrl+M)' : 'Voice to text (Ctrl+M)'}
      className={`inline-flex items-center justify-center rounded-lg border p-2 text-xs transition disabled:opacity-50 ${
        isListening
          ? 'border-rose-300 bg-rose-600 text-white hover:bg-rose-700 shadow-xs'
          : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50/40'
      }`}
    >
      {isListening ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-3.5 w-3.5" />}
    </button>
  );
}
