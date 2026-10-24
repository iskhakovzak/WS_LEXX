/**
 * «Пинг-понг» on the lock screen: monochrome Pong on a canvas, white on black with a soft glow and the italic-serif
 * score. Physics: lib/lock/eggs/pong (pure); this file owns the loop, input, drawing and records.
 *
 * Controls: the left paddle follows the mouse / touch, or ↑↓ / W S; Space pauses / resumes / starts the next match.
 * Pauses itself when the tab is hidden. Reduced motion: a slower ball (still playable). The loop allocates a few small
 * objects per frame and draws 4 shapes, far under 2 ms.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  BALL, DIFFICULTIES, FIELD_H, FIELD_W, PADDLE_H, PADDLE_INSET, PADDLE_W, newMatch, step,
  type Difficulty, type PongEvent, type PongState,
} from "@/lib/lock/eggs/pong";
import { recordPongMatch, recordRally } from "@/lib/lock/eggs/egg-store";
import { lockEggOwnsKey } from "@/lib/lock/eggs/keys";
import { lockEggsI18n } from "@/i18n/ns/lockEggs";
import { playBlip } from "./blips";
import { SEG_BASE, SEG_OFF, SEG_ON, SERIF, type GameProps } from "./game-props";

type Phase = "play" | "paused" | "over";

function draw(ctx: CanvasRenderingContext2D, s: PongState, scale: number, dpr: number, serving: boolean) {
  const k = scale * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // Net.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 14]);
  ctx.beginPath();
  ctx.moveTo(FIELD_W / 2, 8);
  ctx.lineTo(FIELD_W / 2, FIELD_H - 8);
  ctx.stroke();
  ctx.setLineDash([]);
  // Paddles and ball with a soft glow.
  ctx.shadowColor = "rgba(255,255,255,0.55)";
  ctx.shadowBlur = 14 * dpr;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(PADDLE_INSET - PADDLE_W / 2, s.player - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  ctx.fillRect(FIELD_W - PADDLE_INSET - PADDLE_W / 2, s.bot - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  if (!s.winner) {
    ctx.globalAlpha = serving ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, BALL / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0;
}

export default function PongGame({ stats, update, sound, reduced }: GameProps) {
  const { t } = lockEggsI18n.useT();
  const difficulty = stats.prefs.difficulty;
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const stateRef = React.useRef<PongState>(newMatch());
  const input = React.useRef({ target: null as number | null, up: false, down: false });
  const cfgRef = React.useRef({ difficulty, reduced });
  const soundRef = React.useRef(sound);
  const sizeRef = React.useRef({ scale: 1, dpr: 1 });
  const [phase, setPhase] = React.useState<Phase>("play");
  const phaseRef = React.useRef<Phase>("play");
  const [score, setScore] = React.useState({ player: 0, bot: 0 });
  const [rally, setRally] = React.useState(0);
  cfgRef.current = { difficulty, reduced };
  soundRef.current = sound;

  const setPhaseBoth = React.useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);

  const redraw = React.useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) draw(ctx, stateRef.current, sizeRef.current.scale, sizeRef.current.dpr, stateRef.current.serveIn > 0);
  }, []);

  const restart = React.useCallback(() => {
    stateRef.current = newMatch();
    setScore({ player: 0, bot: 0 });
    setRally(0);
    setPhaseBoth("play");
  }, [setPhaseBoth]);

  // Canvas size follows its box (DPR-aware).
  React.useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const w = wrap.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round((w * FIELD_H / FIELD_W) * dpr);
      sizeRef.current = { scale: w / FIELD_W, dpr };
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  const onEvents = React.useCallback((events: PongEvent[], s: PongState) => {
    for (const e of events) {
      if (e === "paddle") { setRally(s.rally); if (soundRef.current) playBlip("paddle"); }
      else if (e === "wall") { if (soundRef.current) playBlip("wall"); }
      else if (e === "point-player" || e === "point-bot") {
        setScore({ ...s.score });
        setRally(0);
        const best = s.bestRally;
        update((st) => recordRally(st, best));
        if (soundRef.current && !s.winner) playBlip(e === "point-player" ? "point" : "lose");
      } else if (e === "win" || e === "lose") {
        const best = s.bestRally;
        update((st) => recordPongMatch(st, e === "win", best));
        if (soundRef.current) playBlip(e === "win" ? "win" : "lose");
        setPhaseBoth("over");
      }
    }
  }, [setPhaseBoth, update]);

  // The loop runs only while playing and visible.
  React.useEffect(() => {
    if (phase !== "play") { redraw(); return; }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const i = input.current;
      const dir = (i.down ? 1 : 0) - (i.up ? 1 : 0);
      const r = step(stateRef.current, { target: i.target, dir: dir as -1 | 0 | 1 }, cfgRef.current, dt);
      stateRef.current = r.state;
      if (r.events.length) onEvents(r.events, r.state);
      redraw();
      if (phaseRef.current === "play") raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onHidden = () => { if (document.hidden) setPhaseBoth("paused"); };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [phase, onEvents, redraw, setPhaseBoth]);

  const togglePause = React.useCallback(() => {
    if (phaseRef.current === "over") restart();
    else setPhaseBoth(phaseRef.current === "play" ? "paused" : "play");
  }, [restart, setPhaseBoth]);

  // Keys: only while focus is inside the open game (lib/lock/eggs/keys).
  React.useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      if (!lockEggOwnsKey(e.target, e.key)) return;
      // e.code: W / S by position, whatever the keyboard layout.
      if (e.key === "ArrowUp" || e.code === "KeyW") { input.current.up = on; input.current.target = null; e.preventDefault(); }
      else if (e.key === "ArrowDown" || e.code === "KeyS") { input.current.down = on; input.current.target = null; e.preventDefault(); }
      else if (on && e.key === " ") { e.preventDefault(); if (!e.repeat) togglePause(); }
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [togglePause]);

  // A rally longer than the record counts even when the game is closed mid-point.
  React.useEffect(() => () => {
    const best = stateRef.current.bestRally;
    update((st) => recordRally(st, best));
  }, [update]);

  const pointer = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.height > 0) input.current.target = ((e.clientY - rect.top) / rect.height) * FIELD_H;
  };

  const pickDifficulty = (d: Difficulty) => {
    if (d === difficulty) return;
    update((s) => ({ ...s, prefs: { ...s.prefs, difficulty: d } }));
    restart();
  };

  const won = stateRef.current.winner === "player";

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={wrapRef}
        className="relative mx-auto w-full touch-none overflow-hidden rounded-2xl border border-white/10 bg-black/70"
        style={{ maxWidth: "calc(62vh * 1.6)", aspectRatio: `${FIELD_W} / ${FIELD_H}` }}
        onPointerMove={pointer}
        onPointerDown={(e) => { pointer(e); if (phaseRef.current === "paused") setPhaseBoth("play"); }}
      >
        <canvas ref={canvasRef} role="img" aria-label={t("pong.canvas")} className="absolute inset-0 h-full w-full" />
        <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-3 flex justify-center gap-[18%] text-white/85">
          {(["player", "bot"] as const).map((side) => (
            <div key={side} className="flex flex-col items-center">
              <span className="text-5xl italic leading-none tabular-nums sm:text-6xl" style={{ fontFamily: SERIF, textShadow: "0 0 24px rgba(255,255,255,0.35)" }}>{score[side]}</span>
              <span className="mt-1 text-[0.6rem] uppercase tracking-[0.28em] text-white/40">{side === "player" ? t("pong.you") : t("pong.bot")}</span>
            </div>
          ))}
        </div>
        {phase !== "play" && (
          <div className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-3 text-center">
              {phase === "paused" ? (
                <>
                  <p className="text-4xl italic" style={{ fontFamily: SERIF }}>{t("pong.paused")}</p>
                  <p className="text-xs text-white/60">{t("pong.resume")}</p>
                </>
              ) : (
                <>
                  <p className="text-4xl italic" style={{ fontFamily: SERIF }}>
                    {won ? t("pong.won", { you: score.player, bot: score.bot }) : t("pong.lost", { you: score.player, bot: score.bot })}
                  </p>
                  <button
                    type="button"
                    onClick={restart}
                    className="h-9 rounded-full bg-white px-5 text-sm text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    {t("pong.again")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-white/60">
        <div role="group" aria-label={t("pong.difficulty")} className="flex items-center gap-1 rounded-full border border-white/10 p-0.5">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" aria-pressed={d === difficulty} onClick={() => pickDifficulty(d)} className={cn(SEG_BASE, d === difficulty ? SEG_ON : SEG_OFF)}>
              {t(`pong.level.${d}`)}
            </button>
          ))}
        </div>
        <dl className="flex items-center gap-4 tabular-nums">
          <div className="flex gap-1.5"><dt>{t("pong.rally")}</dt><dd className="text-white">{rally}</dd></div>
          <div className="flex gap-1.5"><dt>{t("pong.bestRally")}</dt><dd className="text-white">{Math.max(stats.pong.bestRally, rally)}</dd></div>
          <div className="flex gap-1.5"><dt>{t("pong.streak")}</dt><dd className="text-white">{stats.pong.winStreak}</dd></div>
        </dl>
      </div>
      <p className="text-center text-[0.7rem] text-white/40">{t("pong.controls")}</p>
    </div>
  );
}
