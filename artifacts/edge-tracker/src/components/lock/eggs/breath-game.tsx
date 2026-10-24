/**
 * «Дыхание» on the lock screen: a calm breathing circle for a minute's reset after a loss — box 4-4-4-4 or 4-7-8
 * (lib/lock/eggs/breath) — then «Готов вернуться». The clock stops while the tab is hidden. Reduced motion: the circle
 * keeps its size and only brightens and dims. The circle is driven through a ref (no re-render per frame); React only
 * re-renders when the phase or the countdown changes.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { BREATH_PATTERNS, MIN_SCALE, breathAt, sessionSeconds, type BreathFrame, type BreathPattern } from "@/lib/lock/eggs/breath";
import { lockEggsI18n } from "@/i18n/ns/lockEggs";
import { playBlip } from "./blips";
import { SEG_BASE, SEG_OFF, SEG_ON, SERIF, type GameProps } from "./game-props";

type Stage = "intro" | "run" | "done";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function BreathGame({ stats, update, sound, reduced, onExit }: GameProps) {
  const { t } = lockEggsI18n.useT();
  const pattern = stats.prefs.breath;
  const [stage, setStage] = React.useState<Stage>("intro");
  const [frame, setFrame] = React.useState<BreathFrame>(() => breathAt(0, pattern));
  const [left, setLeft] = React.useState(() => sessionSeconds(pattern));
  const circleRef = React.useRef<HTMLDivElement>(null);
  const readyRef = React.useRef<HTMLButtonElement>(null);
  const soundRef = React.useRef(sound);
  soundRef.current = sound;

  React.useEffect(() => { if (stage === "done") readyRef.current?.focus(); }, [stage]);

  const paint = React.useCallback((scale: number) => {
    const el = circleRef.current;
    if (!el) return;
    if (reduced) el.style.opacity = String(0.35 + (0.65 * (scale - MIN_SCALE)) / (1 - MIN_SCALE));
    else el.style.transform = `scale(${scale.toFixed(4)})`;
  }, [reduced]);

  React.useEffect(() => {
    if (stage !== "run") return;
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    let shown = "";
    const tick = (now: number) => {
      if (!document.hidden) elapsed += Math.min(0.25, (now - last) / 1000);
      last = now;
      const f = breathAt(elapsed, pattern);
      paint(f.scale);
      const sig = `${f.phase}:${f.count}:${f.cycle}`;
      if (sig !== shown) {
        if (shown && soundRef.current && !f.done && shown.split(":")[0] !== f.phase) playBlip("tick");
        shown = sig;
        setFrame(f);
        setLeft(Math.max(0, Math.ceil(sessionSeconds(pattern) - elapsed)));
      }
      if (f.done) {
        setStage("done");
        update((s) => ({ ...s, breath: { sessions: s.breath.sessions + 1 } }));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, pattern, paint, update]);

  const pick = (p: BreathPattern) => {
    update((s) => ({ ...s, prefs: { ...s.prefs, breath: p } }));
    setLeft(sessionSeconds(p));
  };

  const start = () => { setFrame(breathAt(0, pattern)); setLeft(sessionSeconds(pattern)); setStage("run"); };

  return (
    <div className="flex min-h-[min(26rem,62vh)] flex-col items-center justify-center gap-6 py-4 text-center">
      {stage === "intro" && (
        <>
          <p className="max-w-sm text-sm text-white/70">{t("breath.intro")}</p>
          <div className="flex items-center gap-1 rounded-full border border-white/10 p-0.5">
            {BREATH_PATTERNS.map((p) => (
              <button key={p} type="button" aria-pressed={p === pattern} onClick={() => pick(p)} className={cn(SEG_BASE, p === pattern ? SEG_ON : SEG_OFF)}>
                {t(`breath.pattern.${p}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={start}
            className="h-11 rounded-full bg-white px-7 text-sm text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {t("breath.start")} · {mmss(left)}
          </button>
        </>
      )}

      {stage === "run" && (
        <>
          <div className="relative grid h-[min(16rem,44vh)] w-[min(16rem,44vh)] place-items-center">
            <div aria-hidden="true" className="absolute inset-0 rounded-full border border-white/10" />
            <div
              ref={circleRef}
              aria-hidden="true"
              className="absolute inset-0 rounded-full border border-white/40 bg-white/[0.07] will-change-transform"
              style={{ boxShadow: "0 0 60px rgba(255,255,255,0.18), inset 0 0 40px rgba(255,255,255,0.08)", transform: reduced ? undefined : `scale(${MIN_SCALE})` }}
            />
            <div className="relative flex flex-col items-center" role="status" aria-live="polite">
              <span className="text-6xl italic leading-none tabular-nums" style={{ fontFamily: SERIF }}>{frame.count}</span>
              <span className="mt-2 text-xs uppercase tracking-[0.28em] text-white/70">{t(`breath.phase.${frame.phase}`)}</span>
            </div>
          </div>
          <p className="text-xs text-white/45 tabular-nums">{t("breath.progress", { time: mmss(left) })}</p>
        </>
      )}

      {stage === "done" && (
        <>
          <button
            type="button"
            ref={readyRef}
            onClick={onExit}
            className="rounded-full px-6 py-2 text-5xl italic text-white transition-[text-shadow] hover:[text-shadow:0_0_28px_rgba(255,255,255,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            style={{ fontFamily: SERIF }}
          >
            {t("breath.ready")}
          </button>
          <p className="text-xs text-white/55">{t("breath.readyHint")}</p>
          <button
            type="button"
            onClick={start}
            className="h-9 rounded-full border border-white/15 px-5 text-xs text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {t("breath.again")}
          </button>
        </>
      )}
    </div>
  );
}
