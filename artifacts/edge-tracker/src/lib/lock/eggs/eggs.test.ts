import { describe, expect, it } from "vitest";
import {
  BALL, FIELD_H, FIELD_W, PADDLE_INSET, PADDLE_W, SERVE_DELAY, SPEEDUP, WIN_SCORE, ballSpeeds, newMatch, predictY, serve,
  step, type PongConfig, type PongState,
} from "./pong";
import { JOKE_COUNT, NO_STREAK, applyGuess, generateCandles, jokeIndex, mulberry32, newWalk, nextCandle, outcomeOf } from "./candles";
import { breathAt, cycleSeconds, cyclesFor, sessionSeconds } from "./breath";
import { DEFAULT_STATS, eggsKey, loadEggStats, parseEggStats, recordCandleStreak, recordPongMatch, recordRally, saveEggStats } from "./egg-store";
import { lockEggOwnsKey } from "./keys";

const CFG: PongConfig = { difficulty: "normal", reduced: false };
const still = { target: null, dir: 0 as const };
const half = () => 0.5;

/** A match with the ball in flight at a given position / velocity. */
function inFlight(ball: PongState["ball"], over: Partial<PongState> = {}): PongState {
  return { ...newMatch(), serveIn: 0, ...over, ball };
}

describe("pong: serve and paddles", () => {
  it("waits SERVE_DELAY in the middle, then serves towards the receiver at the base speed", () => {
    let s = newMatch("player");
    let t = 0;
    while (s.ball.vx === 0 && t < 3) { s = step(s, still, CFG, 1 / 60, half).state; t += 1 / 60; }
    expect(t).toBeGreaterThanOrEqual(SERVE_DELAY - 1 / 60);
    expect(t).toBeLessThan(SERVE_DELAY + 2 / 60);
    expect(s.ball.vx).toBeLessThan(0);
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeCloseTo(ballSpeeds(false).base, 5);
  });

  it("reduced motion serves slower", () => {
    const a = serve(newMatch(), { ...CFG, reduced: true }, 0.5);
    const b = serve(newMatch(), CFG, 0.5);
    expect(Math.abs(a.ball.vx)).toBeLessThan(Math.abs(b.ball.vx));
  });

  it("the player's paddle follows the pointer and the keys, clamped to the field", () => {
    const s = newMatch();
    const toward = step(s, { target: 40, dir: 0 }, CFG, 1 / 60).state;
    expect(toward.player).toBeLessThan(s.player);
    const far = step(s, { target: -500, dir: 0 }, CFG, 1 / 20).state;
    expect(far.player).toBeGreaterThanOrEqual(42);
    const down = step(s, { target: null, dir: 1 }, CFG, 1 / 60).state;
    expect(down.player).toBeGreaterThan(s.player);
  });
});

describe("pong: physics step", () => {
  it("bounces off the top wall and reports it", () => {
    const s = inFlight({ x: 400, y: 8, vx: 100, vy: -300 });
    const r = step(s, still, CFG, 1 / 60);
    expect(r.state.ball.vy).toBeGreaterThan(0);
    expect(r.state.ball.y).toBeGreaterThanOrEqual(BALL / 2);
    expect(r.events).toContain("wall");
  });

  it("a paddle hit sends the ball back, speeds it up and counts the rally; the centre returns it flat", () => {
    const face = PADDLE_INSET + PADDLE_W / 2;
    const s = inFlight({ x: face + BALL / 2 + 3, y: FIELD_H / 2, vx: -500, vy: 0 });
    const r = step(s, still, CFG, 1 / 60, half);
    expect(r.events).toContain("paddle");
    expect(r.state.ball.vx).toBeGreaterThan(0);
    expect(Math.abs(r.state.ball.vy)).toBeLessThan(1e-6);
    expect(Math.hypot(r.state.ball.vx, r.state.ball.vy)).toBeCloseTo(500 * SPEEDUP, 5);
    expect(r.state.rally).toBe(1);
    expect(r.state.bestRally).toBe(1);
  });

  it("an edge hit bends the ball away from the centre", () => {
    const face = PADDLE_INSET + PADDLE_W / 2;
    const s = inFlight({ x: face + BALL / 2 + 3, y: FIELD_H / 2 - 40, vx: -500, vy: 0 });
    const r = step(s, still, CFG, 1 / 60, half);
    expect(r.state.ball.vy).toBeLessThan(-100);
  });

  it("speed is capped at the max over a long rally", () => {
    const face = PADDLE_INSET + PADDLE_W / 2;
    const { max } = ballSpeeds(false);
    const s = inFlight({ x: face + BALL / 2 + 3, y: FIELD_H / 2, vx: -max, vy: 0 });
    const r = step(s, still, CFG, 1 / 120, half);
    expect(Math.hypot(r.state.ball.vx, r.state.ball.vy)).toBeLessThanOrEqual(max + 1e-6);
  });

  it("a fast ball never tunnels through the paddle on a long frame", () => {
    const face = PADDLE_INSET + PADDLE_W / 2;
    const s = inFlight({ x: face + 40, y: FIELD_H / 2, vx: -1000, vy: 0 });
    const r = step(s, still, CFG, 1 / 20, half);
    expect(r.events).toContain("paddle");
    expect(r.state.ball.vx).toBeGreaterThan(0);
  });

  it("a missed ball scores for the other side, resets the rally and serves to the one who lost the point", () => {
    const s = inFlight({ x: 4, y: 20, vx: -600, vy: 0 }, { player: FIELD_H - 50, rally: 5, bestRally: 5 });
    const r = step(s, still, CFG, 1 / 30, half);
    expect(r.events).toContain("point-bot");
    expect(r.state.score).toEqual({ player: 0, bot: 1 });
    expect(r.state.rally).toBe(0);
    expect(r.state.bestRally).toBe(5);
    expect(r.state.serveTo).toBe("player");
    expect(r.state.serveIn).toBe(SERVE_DELAY);
    expect(r.state.ball).toMatchObject({ x: FIELD_W / 2, vx: 0 });
  });

  it("first to 7 wins; the finished match no longer moves", () => {
    const s = inFlight({ x: FIELD_W - 4, y: 20, vx: 600, vy: 0 }, { bot: FIELD_H - 50, score: { player: WIN_SCORE - 1, bot: 3 } });
    const r = step(s, still, CFG, 1 / 30, half);
    expect(r.events).toEqual(expect.arrayContaining(["point-player", "win"]));
    expect(r.state.winner).toBe("player");
    expect(step(r.state, still, CFG, 1 / 60).state).toBe(r.state);
  });

  it("predictY folds wall bounces", () => {
    expect(predictY({ x: 400, y: 250, vx: 100, vy: 0 }, 500)).toBeCloseTo(250);
    // 1 s to reach x=500, 300 units up from y=250 → bounces at 6 and comes back to 6 + (300 − 244) = 62.
    expect(predictY({ x: 400, y: 250, vx: 100, vy: -300 }, 500)).toBeCloseTo(62);
    expect(predictY({ x: 400, y: 250, vx: -100, vy: 50 }, 700)).toBe(250);
  });

  it("the hard bot can be beaten: a simulated match against a perfect player ends 7:x", () => {
    let s = newMatch();
    const rand = mulberry32(7);
    let frames = 0;
    while (!s.winner && frames < 60 * 60 * 20) {
      s = step(s, { target: s.ball.y + 30, dir: 0 }, { difficulty: "hard", reduced: false }, 1 / 60, rand).state;
      frames++;
    }
    expect(s.winner).not.toBeNull();
    expect(Math.max(s.score.player, s.score.bot)).toBe(WIN_SCORE);
  });

  it("one step is cheap (well under 2 ms)", () => {
    let s = serve(newMatch(), CFG, 0.3);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) s = step(s, { target: s.ball.y, dir: 0 }, CFG, 1 / 60).state;
    expect((performance.now() - t0) / 2000).toBeLessThan(0.2);
  });
});

describe("candles: random walk", () => {
  it("is deterministic for a seed and different across seeds", () => {
    const a = generateCandles(newWalk(42), 20);
    const b = generateCandles(newWalk(42), 20);
    const c = generateCandles(newWalk(43), 20);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("candles are consistent: open = previous close, high ≥ max(o,c), low ≤ min(o,c), close ≠ open, prices > 0", () => {
    const w = newWalk(1);
    let prev = w.price;
    for (let i = 0; i < 2000; i++) {
      const k = nextCandle(w);
      expect(k.o).toBe(prev);
      expect(k.h).toBeGreaterThanOrEqual(Math.max(k.o, k.c));
      expect(k.l).toBeLessThanOrEqual(Math.min(k.o, k.c));
      expect(k.c).not.toBe(k.o);
      expect(k.l).toBeGreaterThan(0);
      prev = k.c;
    }
  });

  it("stays in a sane range and goes both ways (no edge to find)", () => {
    const w = newWalk(9);
    const ks = generateCandles(w, 5000);
    const ups = ks.filter((k) => outcomeOf(k.o, k) === "higher").length;
    expect(ups / ks.length).toBeGreaterThan(0.4);
    expect(ups / ks.length).toBeLessThan(0.6);
    expect(Math.min(...ks.map((k) => k.l))).toBeGreaterThan(20);
    expect(Math.max(...ks.map((k) => k.h))).toBeLessThan(500);
  });

  it("mulberry32 stays in [0, 1)", () => {
    const r = mulberry32(123);
    for (let i = 0; i < 1000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe("candles: streak", () => {
  it("right guesses build the streak and the best; a wrong one breaks it and remembers what broke", () => {
    let s = applyGuess(NO_STREAK, true);
    s = applyGuess(s, true);
    s = applyGuess(s, true);
    expect(s).toEqual({ streak: 3, best: 3, broke: 0, last: "right" });
    s = applyGuess(s, false);
    expect(s).toEqual({ streak: 0, best: 3, broke: 3, last: "wrong" });
    s = applyGuess(s, true);
    expect(s).toEqual({ streak: 1, best: 3, broke: 0, last: "right" });
  });

  it("joke index is stable and within the list", () => {
    for (let n = 0; n < 50; n++) {
      const j = jokeIndex(n, 3);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(JOKE_COUNT);
      expect(jokeIndex(n, 3)).toBe(j);
    }
  });
});

describe("breathing", () => {
  it("about a minute in whole cycles", () => {
    expect(cycleSeconds("box")).toBe(16);
    expect(cyclesFor("box")).toBe(4);
    expect(sessionSeconds("box")).toBe(64);
    expect(sessionSeconds("478")).toBe(57);
  });

  it("box: in → hold → out → rest with a 4-3-2-1 countdown and the circle filling and emptying", () => {
    expect(breathAt(0, "box")).toMatchObject({ phase: "in", count: 4, scale: 0.55 });
    expect(breathAt(3.5, "box")).toMatchObject({ phase: "in", count: 1 });
    expect(breathAt(5, "box")).toMatchObject({ phase: "hold", scale: 1 });
    expect(breathAt(10, "box").phase).toBe("out");
    expect(breathAt(13, "box").phase).toBe("rest");
    expect(breathAt(17, "box")).toMatchObject({ phase: "in", cycle: 1 });
    expect(breathAt(64, "box").done).toBe(true);
  });

  it("4-7-8 holds for 7 and breathes out for 8", () => {
    expect(breathAt(4.5, "478")).toMatchObject({ phase: "hold", count: 7 });
    expect(breathAt(11.5, "478")).toMatchObject({ phase: "out", count: 8 });
    expect(breathAt(19, "478")).toMatchObject({ phase: "in", cycle: 1 });
  });
});

describe("egg records (localStorage, per person)", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
  };

  it("parses garbage into defaults and keeps valid fields", () => {
    expect(parseEggStats(null)).toEqual(DEFAULT_STATS);
    expect(parseEggStats("{not json")).toEqual(DEFAULT_STATS);
    const p = parseEggStats(JSON.stringify({ pong: { bestRally: 12.7, winStreak: -3 }, prefs: { sound: "yes", difficulty: "hard", breath: "nope" } }));
    expect(p.pong.bestRally).toBe(12);
    expect(p.pong.winStreak).toBe(0);
    expect(p.prefs).toEqual({ sound: false, difficulty: "hard", breath: "box" });
  });

  it("is keyed per person and round-trips", () => {
    const s = mem();
    const won = recordPongMatch(DEFAULT_STATS, true, 9);
    saveEggStats("Zakir Iskhakov", won, s);
    expect([...s.m.keys()]).toEqual([eggsKey("Zakir Iskhakov")]);
    expect(loadEggStats("Zakir Iskhakov", s)).toEqual(won);
    expect(loadEggStats("Someone Else", s)).toEqual(DEFAULT_STATS);
    expect(eggsKey("")).toBe("ws_lexx_lock_eggs:anon");
  });

  it("survives blocked storage", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadEggStats("x", broken)).toEqual(DEFAULT_STATS);
    expect(() => saveEggStats("x", DEFAULT_STATS, broken)).not.toThrow();
    expect(loadEggStats("x", null)).toEqual(DEFAULT_STATS);
  });

  it("win streak grows and resets; best rally and best streak only grow", () => {
    let s = recordPongMatch(DEFAULT_STATS, true, 6);
    s = recordPongMatch(s, true, 3);
    expect(s.pong).toMatchObject({ winStreak: 2, bestStreak: 2, bestRally: 6, wins: 2, losses: 0 });
    s = recordPongMatch(s, false, 11);
    expect(s.pong).toMatchObject({ winStreak: 0, bestStreak: 2, bestRally: 11, losses: 1 });
    expect(recordRally(s, 4)).toBe(s);
    expect(recordRally(s, 14).pong.bestRally).toBe(14);
    expect(recordCandleStreak(s, 5).candle.best).toBe(5);
    expect(recordCandleStreak(recordCandleStreak(s, 5), 2).candle.best).toBe(5);
  });
});

describe("who owns a key on the lock screen", () => {
  const zone = (z: string | null) => ({ closest: () => (z ? { getAttribute: () => z } : null) });

  it("a game owns every key, the launcher only its navigation keys, elsewhere nothing", () => {
    expect(lockEggOwnsKey(zone("game"), "5")).toBe(true);
    expect(lockEggOwnsKey(zone("game"), "ArrowUp")).toBe(true);
    expect(lockEggOwnsKey(zone("menu"), "Enter")).toBe(true);
    expect(lockEggOwnsKey(zone("menu"), " ")).toBe(true);
    expect(lockEggOwnsKey(zone("menu"), "Escape")).toBe(true);
    expect(lockEggOwnsKey(zone("menu"), "7")).toBe(false);
    expect(lockEggOwnsKey(zone(null), "7")).toBe(false);
    expect(lockEggOwnsKey(null, "7")).toBe(false);
    expect(lockEggOwnsKey({} as never, "Enter")).toBe(false);
  });
});
