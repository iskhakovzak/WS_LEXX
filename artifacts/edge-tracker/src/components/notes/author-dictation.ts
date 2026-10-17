import { useCallback, useEffect, useRef, useState } from "react";

/* Web Speech API dictation (Chrome / Edge / Safari). Final phrases are handed to `onFinal`,
   interim text is exposed for a live caption. */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getSR(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return ((w["SpeechRecognition"] || w["webkitSpeechRecognition"]) as (new () => SpeechRecognitionLike) | undefined) ?? null;
}

export function useDictation({
  onFinal,
  onError,
  onEnd,
}: {
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
}) {
  const [supported] = useState(() => !!getSR());
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const cb = useRef({ onFinal, onError, onEnd });
  cb.current = { onFinal, onError, onEnd };

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR || recRef.current) return;
    const rec = new SR();
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const t = r[0].transcript.trim();
        if (!t) continue;
        if (r.isFinal) cb.current.onFinal(t);
        else live += (live ? " " : "") + t;
      }
      setInterim(live);
    };
    rec.onend = () => {
      recRef.current = null;
      setRecording(false);
      setInterim("");
      cb.current.onEnd?.();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        cb.current.onError("Нет доступа к микрофону — разреши его в настройках браузера");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        cb.current.onError(`Ошибка микрофона: ${e.error}`);
      }
    };
    try {
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      cb.current.onError("Не удалось запустить диктовку");
    }
  }, []);

  useEffect(() => () => {
    try { recRef.current?.abort(); } catch { /* ignore */ }
  }, []);

  return { supported, recording, interim, start, stop, toggle: recording ? stop : start };
}
