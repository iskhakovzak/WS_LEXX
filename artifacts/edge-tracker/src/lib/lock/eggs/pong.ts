/**
 * Lock-screen easter egg «Пинг-понг»: pure Pong physics (no DOM, no timers). The component (components/lock/eggs/
 * pong-game.tsx) owns the loop and the canvas; this module only advances a state by `dt` seconds.
 *
 * Field: FIELD_W × FIELD_H logical units, origin top-left. The player is the left paddle, the bot the right one.
 * Positions of paddles and ball are their CENTRES. A paddle hit bends the ball by where it landed (up to MAX_ANGLE) and
 * speeds it up by SPEEDUP up to the max speed; a rally counts paddle hits in the current point. First to WIN_SCORE wins.
 * The ball moves in sub-steps no longer than half a paddle's width, so it never tunnels through a paddle.
 */

export const FIELD_W = 800;
export const FIELD_H = 500;
export const PADDLE_W = 12;
export const PADDLE_H = 84;
export const PADDLE_INSET = 28;
export const BALL = 12;
export const WIN_SCORE = 7;
export const SERVE_DELAY = 0.9;
export const MAX_ANGLE = (55 * Math.PI) / 180;
export const SPEEDUP = 1.045;
export const KEY_SPEED = 560;
export const POINTER_SPEED = 2400;

export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/**
 * The bot: top speed, aim error (± units, re-rolled at every hit, growing with the ball's speed), whether it reads wall
 * bounces ahead, and how far across the field (share of the width from the left) the ball must come before it reacts.
 */
export const BOT: Record<Difficulty, { speed: number; error: number; predicts: boolean; sees: number }> = {
  easy: { speed: 260, error: 40, predicts: false, sees: 0.55 },
  normal: { speed: 360, error: 26, predicts: true, sees: 0.5 },
  hard: { speed: 470, error: 22, predicts: true, sees: 0.38 },
};

/** Ball speeds (units/s). Reduced motion: slower, still playable. */
export function ballSpeeds(reduced: boolean): { base: number; max: number } {
  return reduced ? { base: 260, max: 560 } : { base: 420, max: 1050 };
}

export type Side = "player" | "bot";

export type PongState = {
  ball: { x: number; y: number; vx: number; vy: number };
  player: number;
  bot: number;
  /** Where the bot aims, relative to the ball's predicted y. */
  botError: number;
  score: { player: number; bot: number };
  rally: number;
  /** Longest rally of this match. */
  bestRally: number;
  /** Seconds until the next serve (the ball waits in the middle). */
  serveIn: number;
  /** Who receives the next serve. */
  serveTo: Side;
  winner: Side | null;
};

export type PongInput = {
  /** Pointer / touch target for the player's paddle centre (field units), or null. */
  target: number | null;
  /** Held keys: −1 up, 1 down, 0 none. */
  dir: -1 | 0 | 1;
};

export type PongConfig = { difficulty: Difficulty; reduced: boolean };

export type PongEvent = "paddle" | "wall" | "point-player" | "point-bot" | "win" | "lose";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const PADDLE_MIN = PADDLE_H / 2;
const PADDLE_MAX = FIELD_H - PADDLE_H / 2;
const BALL_MIN = BALL / 2;
const BALL_MAX = FIELD_H - BALL / 2;
/** The x where the ball's edge meets each paddle's face. */
const PLAYER_FACE = PADDLE_INSET + PADDLE_W / 2;
const BOT_FACE = FIELD_W - PADDLE_INSET - PADDLE_W / 2;

export function newMatch(serveTo: Side = "bot"): PongState {
  return {
    ball: { x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0 },
    player: FIELD_H / 2,
    bot: FIELD_H / 2,
    botError: 0,
    score: { player: 0, bot: 0 },
    rally: 0,
    bestRally: 0,
    serveIn: SERVE_DELAY,
    serveTo,
    winner: null,
  };
}

/** Launch the ball from the centre towards `to`, at a gentle random angle (`r` in [0, 1)). */
export function serve(s: PongState, cfg: PongConfig, r: number): PongState {
  const { base } = ballSpeeds(cfg.reduced);
  const angle = (r * 2 - 1) * (MAX_ANGLE / 2.2);
  const dir = s.serveTo === "player" ? -1 : 1;
  return {
    ...s,
    serveIn: 0,
    ball: { x: FIELD_W / 2, y: FIELD_H / 2, vx: dir * base * Math.cos(angle), vy: base * Math.sin(angle) },
  };
}

/** Where the ball will cross x = `atX`, folding wall bounces; the current y when it moves away. */
export function predictY(ball: PongState["ball"], atX: number): number {
  if (ball.vx === 0 || (atX - ball.x) / ball.vx < 0) return ball.y;
  const t = (atX - ball.x) / ball.vx;
  const span = BALL_MAX - BALL_MIN;
  let y = ball.y + ball.vy * t - BALL_MIN;
  y = ((y % (2 * span)) + 2 * span) % (2 * span);
  return BALL_MIN + (y > span ? 2 * span - y : y);
}

function movePlayer(y: number, input: PongInput, dt: number): number {
  if (input.target != null) {
    const step = POINTER_SPEED * dt;
    return clamp(y + clamp(input.target - y, -step, step), PADDLE_MIN, PADDLE_MAX);
  }
  return clamp(y + input.dir * KEY_SPEED * dt, PADDLE_MIN, PADDLE_MAX);
}

function moveBot(s: PongState, cfg: PongConfig, dt: number): number {
  const bot = BOT[cfg.difficulty];
  const coming = s.ball.vx > 0 && s.serveIn <= 0 && s.ball.x >= FIELD_W * bot.sees;
  const aim = coming
    ? (bot.predicts ? predictY(s.ball, BOT_FACE - BALL / 2) : s.ball.y) + s.botError
    : FIELD_H / 2 + (s.ball.y - FIELD_H / 2) * 0.25;
  const step = bot.speed * dt;
  return clamp(s.bot + clamp(aim - s.bot, -step, step), PADDLE_MIN, PADDLE_MAX);
}

/** Bounce off a paddle at `paddleY`: the angle follows the hit offset, the speed grows by SPEEDUP. */
function bounce(ball: PongState["ball"], paddleY: number, dir: 1 | -1, max: number): PongState["ball"] {
  const rel = clamp((ball.y - paddleY) / (PADDLE_H / 2 + BALL / 2), -1, 1);
  const speed = Math.min(max, Math.hypot(ball.vx, ball.vy) * SPEEDUP);
  const angle = rel * MAX_ANGLE;
  return { ...ball, vx: dir * speed * Math.cos(angle), vy: speed * Math.sin(angle) };
}

/** The bot's aim error after a hit: wider for a faster ball. */
function botError(cfg: PongConfig, speed: number, r: number): number {
  const k = Math.max(1, speed / ballSpeeds(cfg.reduced).base);
  return (r * 2 - 1) * BOT[cfg.difficulty].error * k;
}

const hits = (ballY: number, paddleY: number) => Math.abs(ballY - paddleY) <= PADDLE_H / 2 + BALL / 2;

/**
 * Advance the match by `dt` seconds (clamped to 1/20 s). `rand` gives numbers in [0, 1) for the serve angle and the
 * bot's aim error (inject a seeded one in tests). Returns the new state and what happened, for sounds and stats.
 */
export function step(prev: PongState, input: PongInput, cfg: PongConfig, dt: number, rand: () => number = Math.random): { state: PongState; events: PongEvent[] } {
  const events: PongEvent[] = [];
  if (prev.winner) return { state: prev, events };
  dt = clamp(dt, 0, 1 / 20);
  let s: PongState = { ...prev, player: movePlayer(prev.player, input, dt) };
  s.bot = moveBot(s, cfg, dt);

  if (s.serveIn > 0) {
    const left = s.serveIn - dt;
    s = left > 0 ? { ...s, serveIn: left } : serve(s, cfg, rand());
    return { state: s, events };
  }

  const { max } = ballSpeeds(cfg.reduced);
  let ball = { ...s.ball };
  const n = Math.max(1, Math.ceil((Math.abs(ball.vx) + Math.abs(ball.vy)) * dt / (PADDLE_W / 2)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const px = ball.x;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    if (ball.y < BALL_MIN) { ball.y = 2 * BALL_MIN - ball.y; ball.vy = Math.abs(ball.vy); events.push("wall"); }
    else if (ball.y > BALL_MAX) { ball.y = 2 * BALL_MAX - ball.y; ball.vy = -Math.abs(ball.vy); events.push("wall"); }

    let hit = false;
    const leftEdge = ball.x - BALL / 2;
    const rightEdge = ball.x + BALL / 2;
    if (ball.vx < 0 && px - BALL / 2 >= PLAYER_FACE - PADDLE_W && leftEdge <= PLAYER_FACE && hits(ball.y, s.player)) {
      ball.x = PLAYER_FACE + BALL / 2;
      ball = bounce(ball, s.player, 1, max);
      hit = true;
    } else if (ball.vx > 0 && px + BALL / 2 <= BOT_FACE + PADDLE_W && rightEdge >= BOT_FACE && hits(ball.y, s.bot)) {
      ball.x = BOT_FACE - BALL / 2;
      ball = bounce(ball, s.bot, -1, max);
      hit = true;
    }
    if (hit) {
      s = { ...s, rally: s.rally + 1, bestRally: Math.max(s.bestRally, s.rally + 1), botError: botError(cfg, Math.hypot(ball.vx, ball.vy), rand()) };
      events.push("paddle");
    }

    if (ball.x < -BALL || ball.x > FIELD_W + BALL) {
      const scorer: Side = ball.x < 0 ? "bot" : "player";
      return { state: scorePoint({ ...s, ball }, scorer, events), events };
    }
  }
  return { state: { ...s, ball }, events };
}

function scorePoint(s: PongState, scorer: Side, events: PongEvent[]): PongState {
  const score = { ...s.score, [scorer]: s.score[scorer] + 1 };
  events.push(scorer === "player" ? "point-player" : "point-bot");
  const winner: Side | null = score[scorer] >= WIN_SCORE ? scorer : null;
  if (winner) events.push(winner === "player" ? "win" : "lose");
  return {
    ...s,
    score,
    winner,
    rally: 0,
    // The one who lost the point receives the next serve.
    serveTo: scorer === "player" ? "bot" : "player",
    serveIn: winner ? 0 : SERVE_DELAY,
    ball: { x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0 },
  };
}
