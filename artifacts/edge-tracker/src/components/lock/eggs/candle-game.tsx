/**
 * «Свеча: выше/ниже» on the lock screen: a random-walk candle chart (lib/lock/eggs/candles — generated here, NOT market
 * data) and a guess: will the next candle close higher or lower? Right guesses build a streak; a broken streak gets a
 * joke line. ↑ / W — higher, ↓ / S — lower. The best streak is kept per person on this browser.
 */
import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPrice } from "@/lib/format";
import {
  NO_STREAK, applyGuess, generateCandles, jokeIndex, newWalk, nextCandle, outcomeOf, type Candle, type Guess, type Streak,
} from "@/lib/lock/eggs/candles";
import { recordCandleStreak } from "@/lib/lock/eggs/egg-store";
import { lockEggOwnsKey } from "@/lib/lock/eggs/keys";
import { lockEggsI18n } from "@/i18n/ns/lockEggs";
import { playBlip } from "./blips";
import { SERIF, type GameProps } from "./game-props";

const VISIBLE = 36;
const W = 720;
const H = 300;
const PAD_R = 64;
const UP = "#5fd3a2";
const DOWN = "#ff8f80";

type Joke = "j0" | "j1" | "j2" | "j3" | "j4" | "j5";

function Chart({ candles, total, reveal }: { candles: Candle[]; total: number; reveal: boolean }) {
  const { t } = lockEggsI18n.useT();
  const shown = candles.slice(-VISIBLE);
  const slots = VISIBLE + 1; // the last slot is the «?» of the next candle
  const lo = Math.min(...shown.map((k) => k.l));
  const hi = Math.max(...shown.map((k) => k.h));
  const span = Math.max(hi - lo, hi * 0.01);
  const y = (v: number) => 16 + (1 - (v - (lo - span * 0.08)) / (span * 1.16)) * (H - 32);
  const step = (W - PAD_R) / slots;
  const bw = Math.max(3, step * 0.62);
  const last = shown[shown.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("candle.chart", { price: fmtPrice(last.c) })} className="block h-auto w-full">
      <line x1={0} x2={W - PAD_R + 4} y1={y(last.c)} y2={y(last.c)} stroke="rgba(255,255,255,0.22)" strokeDasharray="3 5" />
      <text x={W - PAD_R + 10} y={y(last.c) + 4} fill="rgba(255,255,255,0.8)" fontSize="13" className="tabular-nums">{fmtPrice(last.c)}</text>
      {shown.map((k, i) => {
        const x = i * step + step / 2;
        const up = k.c >= k.o;
        const color = up ? UP : DOWN;
        const top = y(Math.max(k.o, k.c));
        const bottom = y(Math.min(k.o, k.c));
        const isNew = reveal && i === shown.length - 1;
        return (
          <g key={total - shown.length + i} className={isNew ? "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-50 motion-safe:duration-300" : undefined} style={isNew ? { transformOrigin: `${x}px ${y(k.o)}px`, transformBox: "view-box" } : undefined}>
            <line x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={color} strokeOpacity={0.85} strokeWidth={1.4} />
            <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1.5, bottom - top)} rx={1} fill={color} fillOpacity={up ? 0.9 : 0.85} />
          </g>
        );
      })}
      <rect
        x={VISIBLE * step + step / 2 - bw / 2}
        y={y(last.c) - 22}
        width={bw}
        height={44}
        rx={2}
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeDasharray="3 3"
        className="motion-safe:animate-pulse"
      />
      <text x={VISIBLE * step + step / 2} y={y(last.c) - 30} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="14">?</text>
    </svg>
  );
}

export default function CandleGame({ stats, update, sound }: GameProps) {
  const { t } = lockEggsI18n.useT();
  const walk = React.useRef(newWalk((Date.now() ^ (Math.random() * 1e9)) >>> 0));
  // `total` counts every candle ever drawn, so each one keeps its React key while the window scrolls.
  const [chart, setChart] = React.useState(() => ({ list: generateCandles(walk.current, VISIBLE), total: VISIBLE }));
  const [streak, setStreak] = React.useState<Streak>(NO_STREAK);
  const [salt] = React.useState(() => Math.floor(Math.random() * 6));
  const chartRef = React.useRef(chart);
  const streakRef = React.useRef(streak);
  const soundRef = React.useRef(sound);
  soundRef.current = sound;

  const guess = React.useCallback((g: Guess) => {
    const cur = chartRef.current;
    const next = nextCandle(walk.current);
    const right = outcomeOf(cur.list[cur.list.length - 1]!.c, next) === g;
    const nextChart = { list: [...cur.list, next].slice(-VISIBLE * 2), total: cur.total + 1 };
    const n = applyGuess(streakRef.current, right);
    chartRef.current = nextChart;
    streakRef.current = n;
    setChart(nextChart);
    setStreak(n);
    if (right) update((st) => recordCandleStreak(st, n.streak));
    if (soundRef.current) playBlip(right ? "right" : "wrong");
  }, [update]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!lockEggOwnsKey(e.target, e.key) || e.repeat) return;
      if (e.key === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); guess("higher"); }
      else if (e.key === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); guess("lower"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guess]);

  const best = Math.max(stats.candle.best, streak.best);
  const line = streak.last === "right"
    ? t("candle.right")
    : streak.last === "wrong"
      ? (streak.broke > 0 ? t(`candle.jokes.${`j${jokeIndex(streak.broke, salt)}` as Joke}`) : t("candle.wrong"))
      : t("candle.question");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4 px-1">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl italic leading-none tabular-nums" style={{ fontFamily: SERIF }}>{streak.streak}</span>
          <span className="text-2xs uppercase tracking-[0.24em] text-white/45">{t("candle.streak")}</span>
        </div>
        <div className="text-right text-xs text-white/55 tabular-nums">
          {t("candle.best")} <span className="text-white">{best}</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 p-2">
        <Chart candles={chart.list} total={chart.total} reveal={streak.last !== null} />
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn("min-h-5 text-center text-sm", streak.last === "right" ? "text-[#5fd3a2]" : streak.last === "wrong" ? "text-[#ffb4a8]" : "text-white/70")}
      >
        {line}
      </p>
      <div className="flex justify-center gap-3">
        <button
          type="button"
          onClick={() => guess("higher")}
          className="inline-flex h-11 min-w-32 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 text-sm text-white transition-colors hover:border-[#5fd3a2]/60 hover:bg-[#5fd3a2]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
          {t("candle.higher")}
        </button>
        <button
          type="button"
          onClick={() => guess("lower")}
          className="inline-flex h-11 min-w-32 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 text-sm text-white transition-colors hover:border-[#ff8f80]/60 hover:bg-[#ff8f80]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
          {t("candle.lower")}
        </button>
      </div>
      <p className="text-center text-2xs text-white/40">{t("candle.keys")} · {t("candle.note")}</p>
    </div>
  );
}
