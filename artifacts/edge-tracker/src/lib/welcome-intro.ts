/**
 * When the opening «Добро пожаловать, трейдер» / «Доброе утро, Закир» intro plays (components/shell/welcome-intro.tsx).
 * Pure decision + storage bookkeeping, no DOM: the component passes in what it read from the browser.
 *
 *   Signed out → "welcome" (sign-in screen); signed in → "greeting" (time of day by the desk clock, New York).
 *   At most once per browser session (sessionStorage); the signed-in greeting at most once per NY trading day
 *   (localStorage). Never on a deep link (any path but the app root, or any query string), in the print view,
 *   under automation (navigator.webdriver: headless recording / e2e) or with the per-browser switch
 *   localStorage ws_lexx_intro = "off" (demo / recording machines). `?intro=0` turns it off for one load,
 *   `?intro=1` forces it (review, screenshots) past every limit above.
 */
import { nyDate } from "./trading-date";

export type IntroKind = "welcome" | "greeting";
export type DayPart = "night" | "morning" | "day" | "evening";

/** sessionStorage: "1" once any intro played in this browser session. */
export const INTRO_SESSION_KEY = "ws_lexx_intro_seen";
/** localStorage: the NY date (YYYY-MM-DD) of the last signed-in greeting. */
export const INTRO_DAY_KEY = "ws_lexx_intro_day";
/** localStorage: "off" disables the intro in this browser (demo / recording machines). */
export const INTRO_OFF_KEY = "ws_lexx_intro";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export interface IntroEnv {
  authed: boolean;
  /** location.pathname with the app BASE already removed. */
  path: string;
  /** location.search («?a=1» or ""). */
  search: string;
  now: Date;
  /** navigator.webdriver — headless recording / automated browser. */
  automated: boolean;
  /** matchMedia("print").matches */
  printing: boolean;
  /** null when the browser blocks storage. */
  session: KeyValueStore | null;
  local: KeyValueStore | null;
}

function read(store: KeyValueStore | null, key: string): string | null {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
function write(store: KeyValueStore | null, key: string, value: string): void {
  try { store?.setItem(key, value); } catch { /* storage full or blocked */ }
}

/** `?intro=1` → "force", `?intro=0` / `?intro=off` → "off", otherwise null. */
export function introParam(search: string): "force" | "off" | null {
  const v = new URLSearchParams(search).get("intro");
  if (v === "1" || v === "on") return "force";
  if (v === "0" || v === "off") return "off";
  return null;
}

const ROOT_PATHS = new Set(["", "/", "/login"]);

/** Which intro to play on this load, or null. */
export function decideIntro(env: IntroEnv): IntroKind | null {
  const kind: IntroKind = env.authed ? "greeting" : "welcome";
  const param = introParam(env.search);
  if (param === "off") return null;
  if (param === "force") return kind;
  if (env.printing || env.automated) return null;
  if (read(env.local, INTRO_OFF_KEY) === "off") return null;
  // Deep link (a shared trade, a report, the dev `?ny=` clock…): straight to the content.
  if (!ROOT_PATHS.has(env.path) || env.search.replace(/^\?/, "") !== "") return null;
  if (read(env.session, INTRO_SESSION_KEY)) return null;
  if (kind === "greeting" && read(env.local, INTRO_DAY_KEY) === nyDate(env.now)) return null;
  return kind;
}

/** Record that `kind` just started playing (so a reload mid-intro does not replay it). */
export function markIntroShown(kind: IntroKind, env: Pick<IntroEnv, "now" | "session" | "local">): void {
  write(env.session, INTRO_SESSION_KEY, "1");
  if (kind === "greeting") write(env.local, INTRO_DAY_KEY, nyDate(env.now));
}

const nyHourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });

/** Part of the day by the desk clock (New York) — the same rule as the dashboard greeting. */
export function dayPartNY(d: Date): DayPart {
  const h = Number(nyHourFmt.format(d)) % 24;
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "day";
  return "evening";
}

/** First word of a display name («Дмитрий К.» → «Дмитрий»); "" for none. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}
