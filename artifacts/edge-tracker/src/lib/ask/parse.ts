// «Спроси журнал» — deterministic Russian query parser (no AI / LLM, no React).
//
// A phrase like «шорты INTC в октябре после 11:00» becomes a structured AskQuery: filters (trader, tickers,
// setups, side, result, NY date range, ET entry-time window, weekdays, entry price, hold time, size, «после
// убытка», «последние N сделок»), an intent (list | count | sum | avg | winrate | fees | pf | hold | size |
// drawdown | best | worst | compare | streak | insight), a group-by dimension, a metric and top-N.
//
// Pipeline:
//   1. prepare(): lowercase, ё→е, punctuation → spaces, number words → digits, wrong keyboard layout and typo
//      correction. Every prepared char remembers its span in the user's text.
//   2. An ordered list of regex rules runs over the prepared text. Each accepted match masks its span, so later
//      (looser) rules never re-read it. Accepted matches become AskTokens («понял как» chips) with the span in
//      the ORIGINAL text — a chip can be removed / replaced in place (textWithoutToken / replaceToken).
//   3. Leftovers: trader names, known setups, Latin tickers, noise words; anything else → `unknown`.
//   4. Resolution: two values of one facet + «vs / сравни / или» ⇒ comparison; intent precedence; defaults.
//
// Dates are computed from the NY trading date passed in ctx.today (nyDate() from @/lib/trading-date).

import { addDays, prevWeekday } from "@/lib/trading-date";
import { mapSpan, prepare, type Correction, type Prepared } from "./prepare";

export type AskSide = "Long" | "Short";
export type AskOutcome = "win" | "loss" | "breakeven";
export type AskIntent =
  | "list" | "count" | "sum" | "avg" | "winrate" | "fees" | "pf" | "hold" | "size" | "drawdown"
  | "best" | "worst" | "compare" | "streak" | "insight";
export type AskDim =
  | "ticker" | "day" | "hour" | "weekday" | "month" | "week" | "side" | "trade" | "setup" | "slot" | "holdBucket" | "sizeBucket" | "trader";
export type AskMetric = "net" | "winRate" | "avg" | "n" | "fees" | "pf";
export type AskTokenKind =
  | "trader" | "ticker" | "setup" | "side" | "outcome" | "date" | "time" | "weekday" | "price" | "hold" | "qty" | "after" | "last"
  | "intent" | "group" | "compare" | "scope";

export interface AskToken {
  /** Unique within one query (kind + span start). */
  key: string;
  kind: AskTokenKind;
  /** Chip text: «Период: 01.10–31.10.2026». */
  label: string;
  /** Short phrase used in the answer sentence: «в октябре», «после 11:00». */
  phrase: string;
  /** The original text the rule consumed. */
  text: string;
  /** Span in the original string; -1 for derived tokens (not removable). */
  start: number;
  end: number;
}

export interface AskDateRange { from: string; to: string; phrase: string }
export interface AskTimeRange { fromMin: number | null; toMin: number | null; phrase: string }
export interface AskNumRange { min: number | null; max: number | null }
export interface AskAfter { kind: "win" | "loss"; n: number }

/** Every filter a query (or one side of a comparison) can carry. */
export interface AskFilter {
  trader: string | null;
  tickers: string[];
  setups: string[];
  side: AskSide | null;
  outcome: AskOutcome | null;
  date: AskDateRange | null;
  /** Entry time window in ET minutes since midnight; `toMin` exclusive. */
  time: AskTimeRange | null;
  /** 0 = Monday … 4 = Friday (close date). */
  weekdays: number[] | null;
  /** Entry price, USD. */
  price: AskNumRange | null;
  /** Hold time, seconds. */
  holdSec: AskNumRange | null;
  /** Position size, shares. */
  qty: AskNumRange | null;
  /** Previous trade(s) of the same trader on the same day were losses / wins. */
  after: AskAfter | null;
  /** Only the last N trades (after the other filters). */
  lastN: number | null;
}

export type AskCompareDim = "ticker" | "side" | "time" | "date" | "weekday" | "setup" | "trader" | "outcome";
export interface AskCompareSide { label: string; patch: Partial<AskFilter> }
export interface AskCompare { dim: AskCompareDim; a: AskCompareSide; b: AskCompareSide }

export interface AskQuery extends AskFilter {
  raw: string;
  /** Staff asked about the whole desk («все трейдеры», «по трейдерам»). */
  allTraders: boolean;
  intent: AskIntent;
  /** Subject of best/worst («лучший тикер» ⇒ ticker). */
  target: AskDim | null;
  groupBy: AskDim | null;
  metric: AskMetric;
  /** best/worst: how many rows the answer is about (1 = «лучший день», 5 = «худшие дни»). */
  topN: number;
  compare: AskCompare | null;
  /** streak: which streak and over what (trades or days). */
  streak: { kind: "win" | "loss" | null; unit: "trade" | "day" } | null;
  /** insight: «когда я теряю больше всего» (worst) / «когда я зарабатываю» (best). */
  insight: "best" | "worst" | null;
  tokens: AskToken[];
  /** Words the parser did not understand (original spelling). */
  unknown: string[];
  /** Typos / keyboard-layout fixes applied before parsing. */
  corrections: Correction[];
  /** At least one thing was understood. */
  ok: boolean;
}

export interface ParseContext {
  /** NY trading date YYYY-MM-DD (nyDate()). */
  today: string;
  /** Known trader names (staff can name a trader: «Ориф, MRK, 15 октября»). */
  traders?: readonly string[];
  /** Tickers present in the book (protects them from layout «fixes»). */
  tickers?: readonly string[];
  /** Setup names present in the book: matched as bare words («news», «gap and go»). */
  setups?: readonly string[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const partsOf = (date: string) => date.split("-").map(Number) as [number, number, number];
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const validYmd = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
/** Lower bound for open-ended ranges («до 15 октября»). */
export const BOOK_START = "2000-01-01";

function fmtDay(date: string, withYear = true): string {
  const [y, m, d] = partsOf(date);
  return withYear ? `${pad(d)}.${pad(m)}.${y}` : `${pad(d)}.${pad(m)}`;
}

export function fmtRange(r: { from: string; to: string }): string {
  if (r.from === r.to) return fmtDay(r.from);
  if (r.from <= BOOK_START) return `до ${fmtDay(r.to)}`;
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  return `${fmtDay(r.from, !sameYear)}–${fmtDay(r.to)}`;
}

/** Month without an explicit year: the latest occurrence not after today. */
function resolveYear(month: number, today: string, explicit?: string): number {
  if (explicit) return Number(explicit);
  const [ty, tm] = partsOf(today);
  return month > tm ? ty - 1 : ty;
}

const MONTH_STEMS: Array<[RegExp, number]> = [
  [/^янв/, 1], [/^фев/, 2], [/^мар/, 3], [/^апр/, 4], [/^ма[йяею]$/, 5], [/^июн/, 6], [/^июл/, 7],
  [/^авг/, 8], [/^сен/, 9], [/^окт/, 10], [/^ноя/, 11], [/^дек/, 12],
];
function monthIndex(word: string): number | null {
  const w = word.replace(/\.$/, "");
  for (const [r, m] of MONTH_STEMS) if (r.test(w)) return m;
  return null;
}

const MONTH_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

// ── Number / unit helpers ─────────────────────────────────────────────────────

const toNum = (s: string | undefined) => (s == null ? NaN : Number(s.replace(",", ".")));

function unitSeconds(u: string): number {
  const c = u[0];
  if (c === "с" || c === "s") return 1;
  if (c === "ч" || c === "h") return 3600;
  return 60;
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} с`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return s ? `${m} мин ${s} с` : `${m} мин`;
  }
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function fmtClock(min: number): string {
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

const fmtUsd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

// ── Regex building blocks (JS \b does not work for Cyrillic ⇒ explicit lookarounds) ──

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const re = (body: string) => new RegExp(`${L}(?:${body})${R}`, "gu");

const MON = "(январ\\p{L}*|феврал\\p{L}*|март\\p{L}*|апрел\\p{L}*|ма[йяею]|июн\\p{L}*|июл\\p{L}*|август\\p{L}*|сентябр\\p{L}*|октябр\\p{L}*|ноябр\\p{L}*|декабр\\p{L}*|янв|фев|мар|апр|авг|сент|сен|окт|ноя|дек)\\.?";
const NUM = "(\\d+(?:[.,]\\d+)?)";
const UNIT = "(секунд\\p{L}*|сек|с|sec|s|минут\\p{L}*|мин|м|min|m|час\\p{L}*|ч|h)";
const HH = "(\\d{1,2})(?:[:.](\\d{2}))?";
const CUR_RE = /\$|долл|usd|бакс|цен/;
const LOSS_W = "убыт\\p{L}*|убыточн\\p{L}*|лосс\\p{L}*|минус\\p{L}*|стоп\\p{L}*|проигрыш\\p{L}*|поражени\\p{L}*|красн\\p{L}*";
const WIN_W = "прибыльн\\p{L}*|профит\\p{L}*|плюс\\p{L}*|выигрыш\\p{L}*|побед\\p{L}*|зелен\\p{L}*";
const isLossWord = (w: string) => /^(убыт|лосс|минус|стоп|проигр|пораж|красн)/.test(w);

// ── Parser state ──────────────────────────────────────────────────────────────

interface Draft {
  traders: string[];
  allTraders: boolean;
  tickers: string[];
  setups: string[];
  sides: AskSide[];
  outcomes: AskOutcome[];
  dates: AskDateRange[];
  allTime: boolean;
  times: AskTimeRange[];
  timeBound: { fromMin: number | null; toMin: number | null } | null;
  weekdaySets: number[][];
  price: AskNumRange | null;
  holdSec: AskNumRange | null;
  qty: AskNumRange | null;
  after: AskAfter | null;
  lastN: number | null;
  compareFlag: "strong" | "weak" | null;
  best: "best" | "worst" | null;
  topN: number | null;
  plural: boolean;
  target: AskDim | null;
  whichTarget: AskDim | null;
  leak: "best" | "worst" | null;
  whenFlag: boolean;
  mostFlag: boolean;
  verb: "earn" | "lose" | null;
  streak: { kind: "win" | "loss" | null; unit: "trade" | "day" } | null;
  explicit: Set<"count" | "sum" | "avg" | "winrate" | "fees" | "pf" | "hold" | "size" | "drawdown">;
  countHint: boolean;
  groupBy: AskDim | null;
}

interface State {
  orig: string;
  prep: Prepared;
  s: string;
  today: string;
  traders: readonly string[];
  setups: readonly string[];
  d: Draft;
  tokens: AskToken[];
}

type TokenBody = Omit<AskToken, "key" | "text" | "start" | "end">;
type Handler = (m: RegExpExecArray, st: State) => TokenBody | null | false;

interface Rule { re: RegExp; fn: Handler }

function mask(st: State, start: number, end: number) {
  st.s = st.s.slice(0, start) + " ".repeat(end - start) + st.s.slice(end);
}

function runRule(st: State, rule: Rule) {
  rule.re.lastIndex = 0;
  const found: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = rule.re.exec(st.s))) {
    if (m[0] === "") { rule.re.lastIndex++; continue; }
    found.push(m);
  }
  for (const mm of found) {
    // Skip if an earlier match of this same rule already masked part of the span.
    if (st.s.slice(mm.index, mm.index + mm[0].length) !== mm[0]) continue;
    const res = rule.fn(mm, st);
    if (res === false) continue;
    const start = mm.index, end = mm.index + mm[0].length;
    if (res) {
      const [os, oe] = mapSpan(st.prep, start, end);
      st.tokens.push({ ...res, key: `${res.kind}:${os}`, text: st.orig.slice(os, oe).trim(), start: os, end: oe });
    }
    mask(st, start, end);
  }
}

// ── Date resolution ───────────────────────────────────────────────────────────

const PHRASE_ALIAS: Record<string, string> = {
  ytd: "с начала года", mtd: "в этом месяце", qtd: "за квартал", today: "сегодня", yesterday: "вчера",
  сегодняшние: "сегодня", вчерашние: "вчера",
};

function setDate(st: State, from: string, to: string, phrase: string): TokenBody {
  if (from > to) [from, to] = [to, from];
  phrase = PHRASE_ALIAS[phrase] ?? phrase;
  st.d.dates.push({ from, to, phrase });
  return { kind: "date", label: `Период: ${fmtRange({ from, to })}`, phrase };
}

function monthRange(y: number, m: number) {
  return { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) };
}

function quarterRange(y: number, q: number) {
  const m0 = (q - 1) * 3 + 1;
  return { from: ymd(y, m0, 1), to: ymd(y, m0 + 2, daysInMonth(y, m0 + 2)) };
}

function phraseOf(m: RegExpExecArray) {
  return m[0].trim().replace(/\s+/g, " ");
}

const WEEKDAYS: Record<string, number> = { понедельник: 0, вторник: 1, среду: 2, среда: 2, четверг: 3, пятницу: 4, пятница: 4 };
const WD_NOM = ["понедельник", "вторник", "среда", "четверг", "пятница"];
const WD_DAT_PL = ["понедельникам", "вторникам", "средам", "четвергам", "пятницам"];

function weekdayIndex(w: string): number | null {
  if (/^(понедельн|пн$)/.test(w)) return 0;
  if (/^(вторн|вт$)/.test(w)) return 1;
  if (/^сред[аыу]?$|^средам$/.test(w)) return 2;
  if (/^(четверг|чт$)/.test(w)) return 3;
  if (/^(пятниц|пт$)/.test(w)) return 4;
  return null;
}

function dayMonthRule(st: State, d: string, monWord: string, year?: string): { date: string } | null {
  const mo = monthIndex(monWord);
  if (!mo) return null;
  const y = resolveYear(mo, st.today, year);
  const dd = Number(d);
  if (!validYmd(y, mo, dd)) return null;
  return { date: ymd(y, mo, dd) };
}

const clock = (h: string, mm?: string) => {
  const hh = Number(h), mi = mm ? Number(mm) : 0;
  if (hh > 23 || mi > 59) return null;
  return hh * 60 + mi;
};
const plausibleBareHour = (h: string) => Number(h) >= 4 && Number(h) <= 20;

// ── Rules (ORDER MATTERS) ─────────────────────────────────────────────────────

const TARGET = "дн\\p{L}*\\s+недели|день\\s+недели|тикер\\p{L}*|бумаг\\p{L}*|акци\\p{L}*|дн(?:и|ей|я|ям)|день|час(?:ы|ов|а)?|время|месяц\\p{L}*|недел\\p{L}*|сделк\\p{L}*|сделок|трейд(?:ы|ов|а)?|сторон\\p{L}*|направлени\\p{L}*|сетап\\p{L}*|setup\\p{L}*|трейдер\\p{L}*|сесси\\p{L}*";
const TARGET_MAP: Array<[RegExp, AskDim]> = [
  [/^(дн\p{L}*|день) недели/u, "weekday"], [/^трейдер/, "trader"], [/^(тикер|бумаг|акци)/, "ticker"], [/^(дн|день)/, "day"],
  [/^(час|время)/, "hour"], [/^сесси/, "slot"], [/^месяц/, "month"], [/^недел/, "week"], [/^(сделк|сделок|трейд)/, "trade"],
  [/^(сторон|направлен)/, "side"], [/^(сетап|setup)/, "setup"],
];
const PLURAL_TARGET = /^(тикеры|тикеров|тикера|акции|акций|бумаги|бумаг|дни|дней|часы|часов|сделки|сделок|трейды|трейдов|месяцы|месяцев|недели|недель|сетапы|сетапов|сессии|трейдеры|трейдеров)/;
const targetOf = (w: string): AskDim | null => {
  const s = w.replace(/\s+/g, " ");
  return TARGET_MAP.find(([r]) => r.test(s))?.[1] ?? null;
};

function buildRules(): Rule[] {
  const rules: Rule[] = [];
  const add = (body: string, fn: Handler) => rules.push({ re: re(body), fn });

  // 0. Scope and «all time».
  add("за\\s+(?:все|всю)\\s+(?:время|историю|период)|все\\s+время|вся\\s+история|за\\s+весь\\s+период|всегда", (_m, st) => {
    st.d.allTime = true;
    return { kind: "date", label: "Период: всё время", phrase: "за всё время" };
  });
  add("(?:по\\s+)?(?:всем|все|всех)\\s+трейдер\\p{L}*|(?:весь|всему|всего|по)\\s+деск\\p{L}*|(?:вся|всей|по)\\s+команд\\p{L}*|деск|desk", (_m, st) => {
    st.d.allTraders = true;
    return { kind: "scope", label: "Трейдеры: весь деск", phrase: "по всему деску" };
  });

  // 1. «последние 20 сделок», «последняя сделка».
  add("(?:последн\\p{L}*|крайн\\p{L}*)\\s+(\\d{1,4})\\s+(?:сделк\\p{L}*|сделок|трейд\\p{L}*)", (m, st) => {
    const n = Number(m[1]);
    if (!(n > 0)) return false;
    st.d.lastN = n;
    return { kind: "last", label: `Последние ${n}`, phrase: `последние ${n} ${n % 10 === 1 && n % 100 !== 11 ? "сделка" : "сделок"}` };
  });
  add("(?:последн\\p{L}*|крайн\\p{L}*)\\s+(сделк\\p{L}*|трейд\\p{L}*)", (m, st) => {
    const one = /^(сделка|сделку|трейд)$/.test(m[1]);
    st.d.lastN = one ? 1 : 20;
    return one
      ? { kind: "last", label: "Последняя сделка", phrase: "последняя сделка" }
      : { kind: "last", label: "Последние 20", phrase: "последние 20 сделок" };
  });

  // 2. «после убытка», «после 2 убытков подряд», «после прибыльной сделки».
  add(`после\\s+(?:(\\d{1,2})\\s+)?(${LOSS_W}|${WIN_W})(?:\\s+(?:сделк\\p{L}*|сделок|трейд\\p{L}*))?(?:\\s+подряд)?`, (m, st) => {
    const n = m[1] ? Math.min(10, Math.max(1, Number(m[1]))) : 1;
    const kind = isLossWord(m[2]) ? "loss" : "win";
    st.d.after = { kind, n };
    const phrase = afterPhrase({ kind, n });
    return { kind: "after", label: `Контекст: ${phrase}`, phrase };
  });

  // 3. Streaks.
  add(`(?:(?:сам\\p{L}*\\s+)?(?:длинн\\p{L}*|долг\\p{L}*|больш\\p{L}*|максимальн\\p{L}*|рекордн\\p{L}*)\\s+)?(?:сери\\p{L}*|стрик\\p{L}*|streak)(?:\\s+(?:из\\s+)?(${LOSS_W}|${WIN_W}))?(?:\\s+(?:по\\s+)?(сделкам|сделок|сделки|трейдов|дням|дней|дня|дни))?`, (m, st) => {
    const kind = m[1] ? (isLossWord(m[1]) ? "loss" : "win") : null;
    const unit = m[2] && /^дн|^дн/.test(m[2]) ? "day" : "trade";
    st.d.streak = { kind, unit };
    return { kind: "intent", label: `Ответ: серия${kind ? (kind === "loss" ? " убытков" : " побед") : ""}${unit === "day" ? " (по дням)" : ""}`, phrase: "серии" };
  });
  add(`(${LOSS_W}|${WIN_W})\\s+(?:(сделк\\p{L}*|сделок|дн\\p{L}*|дней)\\s+)?подряд`, (m, st) => {
    const kind = isLossWord(m[1]) ? "loss" : "win";
    const unit = m[2] && /^дн/.test(m[2]) ? "day" : "trade";
    st.d.streak = { kind, unit };
    return { kind: "intent", label: `Ответ: серия ${kind === "loss" ? "убытков" : "побед"}`, phrase: "серии" };
  });

  // 4. Which / when / most — the «когда я теряю больше всего» family.
  add(`(?:в\\s+|во\\s+|на\\s+|по\\s+|у\\s+)?как(?:ой|ая|ие|их|ом|ую|им|ое|ому)\\s+(${TARGET})`, (m, st) => {
    const t = targetOf(m[1]);
    if (!t) return false;
    st.d.whichTarget = t;
    return null;
  });
  add("слаб\\p{L}*\\s+(?:мест\\p{L}*|сторон\\p{L}*)|утечк\\p{L}*|где\\s+(?:я\\s+)?слива\\p{L}*|на\\s+ч[е]м\\s+(?:я\\s+)?слива\\p{L}*", (_m, st) => {
    st.d.leak = "worst";
    return null;
  });
  add("сильн\\p{L}*\\s+(?:мест\\p{L}*|сторон\\p{L}*)|что\\s+(?:у\\s+меня\\s+)?(?:лучше\\s+всего\\s+)?работает", (_m, st) => {
    st.d.leak = "best";
    return null;
  });
  add("когда|где|в\\s+ч[е]м|на\\s+ч[е]м|при\\s+как\\p{L}*\\s+услови\\p{L}*", (_m, st) => { st.d.whenFlag = true; return null; });
  add("(?:больше|сильнее|чаще)\\s+всего", (_m, st) => { st.d.mostFlag = true; return null; });
  add("теря\\p{L}*|слива\\p{L}*|проигрыва\\p{L}*|ошиба\\p{L}*", (_m, st) => { st.d.verb = "lose"; return null; });
  add("зарабатыва\\p{L}*|выигрыва\\p{L}*", (_m, st) => { st.d.verb = "earn"; return null; });
  add("(?:сколько\\s+)?(?:я\\s+)?(потерял\\p{L}*|слил\\p{L}*|проиграл\\p{L}*|заработал\\p{L}*|выиграл\\p{L}*|наторговал\\p{L}*)", (m, st) => {
    st.d.verb = /^(заработ|выигр|наторг)/.test(m[1]) ? "earn" : "lose";
    st.d.explicit.add("sum");
    return { kind: "intent", label: "Ответ: нетто", phrase: "нетто" };
  });
  // «лучше/хуже» (comparative) and «или» hint at a comparison; «лучший» is handled by the best rule.
  add("лучше|хуже|или|либо", (_m, st) => { if (!st.d.compareFlag) st.d.compareFlag = "weak"; return null; });

  // 5. Hold time (before price/time: «до 5 минут» is not 5:00 and not $5).
  const holdRange = (a: number, b: number, st: State): TokenBody | false => {
    if (!(a >= 0 && b > 0)) return false;
    const min = Math.min(a, b), max = Math.max(a, b);
    st.d.holdSec = { min, max };
    return { kind: "hold", label: `Удержание: ${fmtDuration(min)}–${fmtDuration(max)}`, phrase: `с удержанием от ${fmtDuration(min)} до ${fmtDuration(max)}` };
  };
  add(`от\\s+${NUM}\\s*(?:${UNIT}\\s+)?(?:до|-|–)\\s*${NUM}\\s*${UNIT}`, (m, st) => {
    const unitB = unitSeconds(m[4]);
    const unitA = m[2] ? unitSeconds(m[2]) : unitB;
    return holdRange(toNum(m[1]) * unitA, toNum(m[3]) * unitB, st);
  });
  add(`${NUM}\\s*[-–]\\s*${NUM}\\s*${UNIT}`, (m, st) => {
    const u = unitSeconds(m[3]);
    return holdRange(toNum(m[1]) * u, toNum(m[2]) * u, st);
  });
  const holdBound = (dir: "min" | "max"): Handler => (m, st) => {
    const unit = m[3];
    if (!m[2] && unit.length < 3) return false; // «дольше м» is not a duration; «дольше минуты» is
    const n = m[2] ? toNum(m[2]) : 1;
    if (!(n > 0)) return false;
    const sec = n * unitSeconds(unit);
    const prev = st.d.holdSec ?? { min: null, max: null };
    st.d.holdSec = dir === "min" ? { ...prev, min: sec } : { ...prev, max: sec };
    return dir === "min"
      ? { kind: "hold", label: `Удержание: > ${fmtDuration(sec)}`, phrase: `дольше ${fmtDuration(sec)}` }
      : { kind: "hold", label: `Удержание: < ${fmtDuration(sec)}`, phrase: `короче ${fmtDuration(sec)}` };
  };
  add(`(дольше|длиннее|больше|более|свыше|от|не\\s+меньше|минимум)\\s+(?:${NUM}\\s*)?${UNIT}`, holdBound("min"));
  add(`(короче|быстрее|меньше|менее|до|не\\s+дольше|не\\s+больше|максимум|в\\s+пределах)\\s+(?:${NUM}\\s*)?${UNIT}`, holdBound("max"));
  add("скальп\\p{L}*|быстр\\p{L}*\\s+сделк\\p{L}*", (_m, st) => {
    st.d.holdSec = { min: null, max: 60 };
    return { kind: "hold", label: "Удержание: < 1 мин", phrase: "короче 1 мин" };
  });

  // 6. Position size (shares) — needs «акций/шт» or a «размер/объём/позиция» prefix.
  const SH = "(?:\\s*(акци\\p{L}*|шт\\p{L}*|shares|лот\\p{L}*))";
  const SZ = "(?:размер\\p{L}*|объем\\p{L}*|qty|позици\\p{L}*)";
  add(`(${SZ}\\s+)?(?:от\\s+)?(\\d+)\\s*(?:-|–|до)\\s*(\\d+)${SH}?`, (m, st) => {
    if (!m[1] && !m[4]) return false;
    const a = Number(m[2]), b = Number(m[3]);
    if (!(a >= 0 && b > 0)) return false;
    st.d.qty = { min: Math.min(a, b), max: Math.max(a, b) };
    return { kind: "qty", label: `Размер: ${Math.min(a, b)}–${Math.max(a, b)} акций`, phrase: `размером ${Math.min(a, b)}–${Math.max(a, b)} акций` };
  });
  add(`(${SZ}\\s+)?(больше|более|свыше|от|не\\s+меньше|меньше|менее|до|не\\s+больше|>|<)\\s*(\\d+)${SH}?`, (m, st) => {
    if (!m[1] && !m[4]) return false;
    const n = Number(m[3]);
    if (!(n > 0)) return false;
    const max = /^(меньше|менее|до|не\s+больше|<)$/.test(m[2]);
    const prev = st.d.qty ?? { min: null, max: null };
    st.d.qty = max ? { ...prev, max: n } : { ...prev, min: n };
    return max
      ? { kind: "qty", label: `Размер: < ${n} акций`, phrase: `размером меньше ${n} акций` }
      : { kind: "qty", label: `Размер: ≥ ${n} акций`, phrase: `размером от ${n} акций` };
  });

  // 7. Entry price.
  add(`(?:(?:цен\\p{L}*|по\\s+цене)\\s+)?от\\s*\\$?\\s*${NUM}\\s*\\$?\\s*(?:до|-|–)\\s*\\$?\\s*${NUM}\\s*(?:\\$|долл\\p{L}*|usd|бакс\\p{L}*)?`, (m, st) => {
    if (!CUR_RE.test(m[0])) return false;
    const a = toNum(m[1]), b = toNum(m[2]);
    if (!(a >= 0 && b > 0)) return false;
    st.d.price = { min: Math.min(a, b), max: Math.max(a, b) };
    return { kind: "price", label: `Цена входа: ${fmtUsd(Math.min(a, b))}–${fmtUsd(Math.max(a, b))}`, phrase: `по цене ${fmtUsd(Math.min(a, b))}–${fmtUsd(Math.max(a, b))}` };
  });
  const priceBound = (dir: "min" | "max", soft: RegExp): Handler => (m, st) => {
    const kw = m[2];
    const hasCur = CUR_RE.test(m[0]);
    if (!hasCur && !soft.test(kw)) return false; // «меньше 5» / «до 10» need a $ marker
    const n = toNum(m[3]);
    if (!(n > 0)) return false;
    const prev = st.d.price ?? { min: null, max: null };
    st.d.price = dir === "max" ? { ...prev, max: n } : { ...prev, min: n };
    return dir === "max"
      ? { kind: "price", label: `Цена входа: < ${fmtUsd(n)}`, phrase: `дешевле ${fmtUsd(n)}` }
      : { kind: "price", label: `Цена входа: > ${fmtUsd(n)}`, phrase: `дороже ${fmtUsd(n)}` };
  };
  const CUR_TAIL = "\\s*(?:\\$|долл\\p{L}*|usd|бакс\\p{L}*)?";
  add(`((?:цен\\p{L}*|по\\s+цене)\\s+)?(дешевле|ниже|меньше|до|не\\s+дороже)\\s*\\$?\\s*${NUM}${CUR_TAIL}`, priceBound("max", /^(дешевле|ниже|не\s+дороже)$/));
  add(`((?:цен\\p{L}*|по\\s+цене)\\s+)?(дороже|выше|больше|от|не\\s+дешевле)\\s*\\$?\\s*${NUM}${CUR_TAIL}`, priceBound("min", /^(дороже|выше|не\s+дешевле)$/));
  rules.push({
    re: /([<>])\s*\$\s*(\d+(?:[.,]\d+)?)|([<>])\s*(\d+(?:[.,]\d+)?)\s*\$/gu,
    fn: (m, st) => {
      const op = m[1] ?? m[3], n = toNum(m[2] ?? m[4]);
      if (!(n > 0)) return false;
      const prev = st.d.price ?? { min: null, max: null };
      if (op === "<") { st.d.price = { ...prev, max: n }; return { kind: "price", label: `Цена входа: < ${fmtUsd(n)}`, phrase: `дешевле ${fmtUsd(n)}` }; }
      st.d.price = { ...prev, min: n };
      return { kind: "price", label: `Цена входа: > ${fmtUsd(n)}`, phrase: `дороже ${fmtUsd(n)}` };
    },
  });

  // 8. Dates — explicit ranges first.
  add(`с\\s+(\\d{1,2})(?:\\s+${MON})?\\s+(?:по|до)\\s+(\\d{1,2})\\s+${MON}(?:\\s+(\\d{4}))?(?:\\s+г(?:ода|\\.)?)?`, (m, st) => {
    const end = dayMonthRule(st, m[3], m[4], m[5]);
    if (!end) return false;
    let start: { date: string } | null;
    if (m[2]) start = dayMonthRule(st, m[1], m[2], m[5] ?? end.date.slice(0, 4));
    else {
      const [y, mo] = partsOf(end.date);
      start = validYmd(y, mo, Number(m[1])) ? { date: ymd(y, mo, Number(m[1])) } : null;
    }
    if (!start) return false;
    return setDate(st, start.date, end.date, phraseOf(m));
  });
  add(`(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+${MON}(?:\\s+(\\d{4}))?`, (m, st) => {
    const end = dayMonthRule(st, m[2], m[3], m[4]);
    if (!end) return false;
    const [y, mo] = partsOf(end.date);
    if (!validYmd(y, mo, Number(m[1]))) return false;
    return setDate(st, ymd(y, mo, Number(m[1])), end.date, phraseOf(m));
  });
  add(`(?:с\\s+)?(\\d{4}-\\d{2}-\\d{2})\\s*(?:по|до|-|–)\\s*(\\d{4}-\\d{2}-\\d{2})`, (m, st) => {
    const [a, b] = [m[1], m[2]].map(partsOf);
    if (!validYmd(...a) || !validYmd(...b)) return false;
    return setDate(st, m[1], m[2], `с ${fmtDay(m[1])} по ${fmtDay(m[2])}`);
  });
  add(`(?:начиная\\s+)?(?:с|после)\\s+(\\d{1,2})(?:-?го)?\\s+${MON}(?:\\s+(\\d{4}))?`, (m, st) => {
    const start = dayMonthRule(st, m[1], m[2], m[3]);
    if (!start) return false;
    return setDate(st, start.date, st.today, `с ${fmtDay(start.date, false)}`);
  });
  add(`(?:до|по)\\s+(\\d{1,2})(?:-?го)?\\s+${MON}(?:\\s+(\\d{4}))?`, (m, st) => {
    const end = dayMonthRule(st, m[1], m[2], m[3]);
    if (!end) return false;
    return setDate(st, BOOK_START, end.date, `до ${fmtDay(end.date, false)}`);
  });
  add(`(?:начиная\\s+)?с\\s+${MON}(?:\\s+(\\d{4}))?`, (m, st) => {
    const mo = monthIndex(m[1]);
    if (!mo) return false;
    const y = resolveYear(mo, st.today, m[2]);
    return setDate(st, ymd(y, mo, 1), st.today, phraseOf(m));
  });
  add(`(\\d{1,2})(?:-?го)?\\s+${MON}(?:\\s+(\\d{4}))?(?:\\s+г(?:ода|\\.)?)?`, (m, st) => {
    const day = dayMonthRule(st, m[1], m[2], m[3]);
    if (!day) return false;
    return setDate(st, day.date, day.date, phraseOf(m));
  });
  add(`(\\d{4}-\\d{2}-\\d{2})`, (m, st) => {
    const p = partsOf(m[1]);
    if (!validYmd(...p)) return false;
    return setDate(st, m[1], m[1], fmtDay(m[1]));
  });
  // «октябрь 2025» — month + explicit year, before the bare-year rule takes «2025».
  add(`(?:(?:в|во|за)\\s+)?${MON}\\s+(20\\d{2})(?:\\s+г(?:ода|\\.)?)?`, (m, st) => {
    const mo = monthIndex(m[1]);
    if (!mo) return false;
    const y = Number(m[2]);
    const r = monthRange(y, mo);
    return setDate(st, r.from, r.to, `в ${MONTH_PREP[mo - 1]} ${y}`);
  });
  add(`(?:(?:в|за)\\s+)?(20\\d{2})(?:\\s*(?:г\\.?|год\\p{L}*))?`, (m, st) => {
    const y = Number(m[1]);
    const ty = Number(st.today.slice(0, 4));
    if (y > ty || y < 2000) return false;
    return setDate(st, `${y}-01-01`, y === ty ? st.today : `${y}-12-31`, `в ${y} году`);
  });

  // Relative periods.
  const rel = (body: string, f: (st: State, m: RegExpExecArray) => { from: string; to: string; phrase?: string } | null) =>
    add(body, (m, st) => {
      const r = f(st, m);
      if (!r) return false;
      return setDate(st, r.from, r.to, r.phrase ?? phraseOf(m));
    });
  rel("сегодня|сегодняшн\\p{L}*|за\\s+сегодня|today", (st) => ({ from: st.today, to: st.today, phrase: "сегодня" }));
  rel("позавчера", (st) => { const d = prevWeekday(prevWeekday(st.today)); return { from: d, to: d }; });
  rel("вчера|вчерашн\\p{L}*|yesterday", (st) => { const d = prevWeekday(st.today); return { from: d, to: d, phrase: "вчера" }; });
  rel("(?:на|за)\\s+прошл\\p{L}*\\s+недел\\p{L}*|прошл\\p{L}*\\s+недел\\p{L}*", (st) => {
    const mon = addDays(st.today, -weekdayOf(st.today) - 7);
    return { from: mon, to: addDays(mon, 4), phrase: "на прошлой неделе" };
  });
  rel("(?:на|за)\\s+(?:эт\\p{L}*|текущ\\p{L}*)\\s+недел\\p{L}*|(?:эт\\p{L}*|текущ\\p{L}*)\\s+недел\\p{L}*", (st) => ({ from: addDays(st.today, -weekdayOf(st.today)), to: st.today, phrase: "на этой неделе" }));
  rel("(?:за\\s+)?последн\\p{L}*\\s+(\\d{1,3})\\s+(?:торгов\\p{L}*\\s+)?(дн\\p{L}*|день|недел\\p{L}*|месяц\\p{L}*)|за\\s+(\\d{1,3})\\s+(?:торгов\\p{L}*\\s+)?(дн\\p{L}*|день|недел\\p{L}*|месяц\\p{L}*)", (st, m) => {
    const n = Number(m[1] ?? m[3]);
    const u = m[2] ?? m[4];
    if (!(n > 0)) return null;
    const unit = u.startsWith("нед") ? 7 : u.startsWith("мес") ? 30 : 1;
    const word = unit === 7 ? (n === 1 ? "неделю" : n < 5 ? "недели" : "недель") : unit === 30 ? (n === 1 ? "месяц" : n < 5 ? "месяца" : "месяцев") : (n === 1 ? "день" : n < 5 ? "дня" : "дней");
    return { from: addDays(st.today, -(n * unit) + 1), to: st.today, phrase: `за последние ${n} ${word}` };
  });
  rel("за\\s+(?:последн\\p{L}*\\s+)?недел\\p{L}*|за\\s+7\\s+дней", (st) => ({ from: addDays(st.today, -6), to: st.today, phrase: "за последнюю неделю" }));
  rel("(?:в|за)\\s+прошл\\p{L}*\\s+месяц\\p{L}*|прошл\\p{L}*\\s+месяц\\p{L}*", (st) => {
    const [y, m] = partsOf(st.today);
    return { ...(m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1)), phrase: "в прошлом месяце" };
  });
  rel("(?:в|за)\\s+(?:эт\\p{L}*|текущ\\p{L}*)\\s+месяц\\p{L}*|(?:эт\\p{L}*|текущ\\p{L}*)\\s+месяц\\p{L}*|mtd", (st) => {
    const [y, m] = partsOf(st.today);
    return { from: ymd(y, m, 1), to: st.today, phrase: "в этом месяце" };
  });
  rel("за\\s+(?:последн\\p{L}*\\s+)?месяц|за\\s+30\\s+дней", (st) => ({ from: addDays(st.today, -29), to: st.today, phrase: "за последний месяц" }));
  rel("(?:в|за)\\s+прошл\\p{L}*\\s+квартал\\p{L}*|прошл\\p{L}*\\s+квартал\\p{L}*", (st) => {
    const [y, m] = partsOf(st.today);
    const q = Math.floor((m - 1) / 3) + 1;
    return { ...(q === 1 ? quarterRange(y - 1, 4) : quarterRange(y, q - 1)), phrase: "в прошлом квартале" };
  });
  rel("(?:в|за)\\s+(?:эт\\p{L}*|текущ\\p{L}*)\\s+квартал\\p{L}*|за\\s+квартал|(?:эт\\p{L}*|текущ\\p{L}*)\\s+квартал\\p{L}*|qtd", (st) => {
    const [y, m] = partsOf(st.today);
    const q = Math.floor((m - 1) / 3) + 1;
    return { from: quarterRange(y, q).from, to: st.today, phrase: "за квартал" };
  });
  rel("(?:(?:в|за)\\s+)?(?:q|к)([1-4])(?:\\s+(\\d{4}))?", (st, m) => {
    const [ty, tm] = partsOf(st.today);
    const q = Number(m[1]);
    const y = m[2] ? Number(m[2]) : (q - 1) * 3 + 1 > tm ? ty - 1 : ty;
    const r = quarterRange(y, q);
    return { from: r.from, to: r.to < st.today ? r.to : st.today, phrase: `в Q${q} ${y}` };
  });
  rel("(?:(?:в|за)\\s+)?([1-4])(?:-?(?:й|ом|м|ый))?\\s+квартал\\p{L}*(?:\\s+(\\d{4}))?", (st, m) => {
    const [ty, tm] = partsOf(st.today);
    const q = Number(m[1]);
    const y = m[2] ? Number(m[2]) : (q - 1) * 3 + 1 > tm ? ty - 1 : ty;
    const r = quarterRange(y, q);
    return { from: r.from, to: r.to < st.today ? r.to : st.today, phrase: `в Q${q} ${y}` };
  });
  rel("ytd|с\\s+начала\\s+года|(?:в|за)\\s+эт\\p{L}*\\s+год\\p{L}*|этот\\s+год", (st) => ({ from: `${st.today.slice(0, 4)}-01-01`, to: st.today, phrase: "с начала года" }));
  rel("(?:в|за)\\s+прошл\\p{L}*\\s+год\\p{L}*|прошл\\p{L}*\\s+год\\p{L}*", (st) => {
    const y = Number(st.today.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, phrase: "в прошлом году" };
  });
  rel("за\\s+(?:последн\\p{L}*\\s+)?год", (st) => ({ from: addDays(st.today, -364), to: st.today, phrase: "за последний год" }));
  rel("(?:в|во)\\s+(понедельник|вторник|среду|четверг|пятницу)", (st, m) => {
    const wd = WEEKDAYS[m[1]];
    const back = (weekdayOf(st.today) - wd + 7) % 7;
    const d = addDays(st.today, -back);
    return { from: d, to: d };
  });
  // Month name alone: «в октябре», «за сентябрь», «октябрь 2025».
  add(`(?:(?:в|во|за)\\s+)?${MON}(?:\\s+(\\d{4}))?(?:\\s+г(?:ода|\\.)?)?`, (m, st) => {
    const mo = monthIndex(m[1]);
    if (!mo) return false;
    const y = resolveYear(mo, st.today, m[2]);
    const r = monthRange(y, mo);
    const phrase = `в ${MONTH_PREP[mo - 1]}${m[2] ? ` ${y}` : ""}`;
    return setDate(st, r.from, r.to, phrase);
  });

  // 9. Named sessions (before generic time: «до открытия», «после закрытия», «после обеда»).
  const session = (body: string, from: number, to: number, phrase: string) =>
    add(body, (_m, st) => {
      st.d.times.push({ fromMin: from, toMin: to, phrase });
      return { kind: "time", label: `Время входа: ${fmtClock(from)}–${fmtClock(to)} (${phrase})`, phrase };
    });
  session("после\\s+обеда|во\\s+второй\\s+половине\\s+дня|вторая\\s+половина\\s+дня|afternoon", 840, 960, "после обеда");
  session("премаркет\\p{L}*|пре-?маркет\\p{L}*|pre-?market|до\\s+открытия", 240, 570, "в премаркете");
  session("постмаркет\\p{L}*|афтермаркет\\p{L}*|after-?hours|post-?market|после\\s+закрытия", 960, 1200, "в постмаркете");
  session("power\\s*hour|пауэр[\\s-]*ауэр\\p{L}*|павер[\\s-]*хаур\\p{L}*|(?:в\\s+)?последн\\p{L}*\\s+час\\p{L}*|в\\s+конце\\s+дня|перед\\s+закрытием", 900, 960, "в power hour");
  session("(?:в\\s+)?перв\\p{L}*\\s+час\\p{L}*", 570, 630, "в первый час");
  session("(?:на\\s+)?открыти\\p{L}*|перв\\p{L}*\\s+30\\s+минут|opening", 570, 600, "на открытии");
  session("(?:по\\s+)?утр\\p{L}*|утренн\\p{L}*|с\\s+утра|morning", 570, 660, "утром");
  session("(?:в\\s+|во\\s+время\\s+)?обед\\p{L}*|lunch|ланч\\p{L}*|(?:в\\s+)?середин\\p{L}*\\s+дня", 660, 840, "в обед");

  // 10. Time of day (ET entry time).
  const pushRange = (a: number, b: number, st: State): TokenBody => {
    const phrase = `с ${fmtClock(a)} до ${fmtClock(b)}`;
    st.d.times.push({ fromMin: a, toMin: b, phrase });
    return { kind: "time", label: `Время входа: ${fmtClock(a)}–${fmtClock(b)}`, phrase };
  };
  add(`(?:с|между)\\s+${HH}\\s+(?:до|и|по)\\s+${HH}(?:\\s*(?:ч|час\\p{L}*))?`, (m, st) => {
    if (!m[2] && !m[4] && !(plausibleBareHour(m[1]) && plausibleBareHour(m[3]))) return false;
    const a = clock(m[1], m[2]), b = clock(m[3], m[4]);
    if (a == null || b == null || a >= b) return false;
    return pushRange(a, b, st);
  });
  rules.push({
    re: new RegExp(`${L}(\\d{1,2})[:.](\\d{2})\\s*[-–]\\s*(\\d{1,2})[:.](\\d{2})${R}`, "gu"),
    fn: (m, st) => {
      const a = clock(m[1], m[2]), b = clock(m[3], m[4]);
      if (a == null || b == null || a >= b) return false;
      return pushRange(a, b, st);
    },
  });
  add(`(после|позже|с)\\s+${HH}(?:\\s*(?:ч|час\\p{L}*))?`, (m, st) => {
    if (!m[3] && (m[1] === "с" || !plausibleBareHour(m[2]))) return false;
    const a = clock(m[2], m[3]);
    if (a == null) return false;
    st.d.timeBound = { fromMin: a, toMin: st.d.timeBound?.toMin ?? null };
    return { kind: "time", label: `Время входа: после ${fmtClock(a)}`, phrase: `после ${fmtClock(a)}` };
  });
  add(`(?:до|раньше|ранее)\\s+${HH}(?:\\s*(?:ч|час\\p{L}*))?`, (m, st) => {
    if (!m[2] && !plausibleBareHour(m[1])) return false;
    const b = clock(m[1], m[2]);
    if (b == null) return false;
    st.d.timeBound = { fromMin: st.d.timeBound?.fromMin ?? null, toMin: b };
    return { kind: "time", label: `Время входа: до ${fmtClock(b)}`, phrase: `до ${fmtClock(b)}` };
  });

  // 11. Numeric dates «15.10», «15.10.2026» (after time so «10.30» as a clock never lands here first).
  rules.push({
    re: new RegExp(`${L}(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?${R}(?!\\s*\\$)`, "gu"),
    fn: (m, st) => {
      const d = Number(m[1]), mo = Number(m[2]);
      let y = m[3] ? Number(m[3]) : resolveYear(mo, st.today);
      if (y < 100) y += 2000;
      if (!validYmd(y, mo, d)) return false;
      const date = ymd(y, mo, d);
      return setDate(st, date, date, fmtDay(date));
    },
  });

  // 12. Weekdays as a filter: «по пятницам», «понедельники и пятницы», «пт».
  const WD_ANY = "понедельник(?:и|ам|ов)?|вторник(?:и|ам|ов)?|сред(?:а|ы|ам)|четверг(?:и|ам|ов)?|пятниц(?:а|ы|ам)|пн|вт|чт|пт";
  add(`(?:по\\s+|в\\s+)?(?:${WD_ANY})(?:\\s*(?:и|,|\\/)\\s*(?:по\\s+)?(?:${WD_ANY}))*`, (m, st) => {
    const days = [...m[0].matchAll(/[\p{L}]+/gu)].map((x) => weekdayIndex(x[0])).filter((x): x is number => x != null);
    const set = [...new Set(days)].sort();
    if (!set.length) return false;
    st.d.weekdaySets.push(set);
    const phrase = weekdayPhrase(set);
    return { kind: "weekday", label: `День недели: ${set.map((d) => WD_NOM[d]).join(", ")}`, phrase };
  });

  // 13. Intent words.
  add("сравни\\p{L}*|сравнени\\p{L}*|vs\\.?|versus|против|в\\s+сравнении", (_m, st) => {
    st.d.compareFlag = "strong";
    return null; // the compare token is derived after all rules ran
  });
  const BEST_W = "лучш\\p{L}*|самы\\p{L}*\\s+(?:прибыльн|доходн|удачн)\\p{L}*|наиболее\\s+(?:прибыльн|доходн)\\p{L}*";
  const WORST_W = "худш\\p{L}*|самы\\p{L}*\\s+(?:убыточн|неудачн|провальн)\\p{L}*|наиболее\\s+убыточн\\p{L}*";
  add(`(?:(топ|антитоп)[\\s-]*(\\d{1,2})?|(?:(\\d{1,2})\\s+)?(${BEST_W}|${WORST_W}))(?:\\s+(\\d{1,2}))?(?:\\s+(${TARGET}))?`, (m, st) => {
    const word = m[1] ?? m[4];
    const worst = word === "антитоп" || /^(худш)/.test(word) || /(убыточн|неудачн|провальн)/.test(word);
    st.d.best = worst ? "worst" : "best";
    const n = Number(m[2] ?? m[3] ?? m[5] ?? 0);
    if (n > 0) st.d.topN = Math.min(50, n);
    if (m[6]) {
      st.d.target = targetOf(m[6]);
      if (PLURAL_TARGET.test(m[6])) st.d.plural = true;
    }
    if (/(ие|их)$/.test(word) || /^самые|^самых/.test(word)) st.d.plural = true;
    return null;
  });
  add("комисси\\p{L}*|комс\\p{L}*|fees?|сбор\\p{L}*|издержк\\p{L}*", (_m, st) => {
    st.d.explicit.add("fees");
    return { kind: "intent", label: "Ответ: комиссии", phrase: "комиссии" };
  });
  add("вин\\s*рейт\\p{L}*|винрейт\\p{L}*|win\\s*rate|winrate|wr|процент\\s+(?:побед|прибыльных|выигрышей|выигрышных)|точност\\p{L}*", (_m, st) => {
    st.d.explicit.add("winrate");
    return { kind: "intent", label: "Ответ: винрейт", phrase: "винрейт" };
  });
  add("профит[\\s-]*фактор\\p{L}*|profit\\s*factor|pf", (_m, st) => {
    st.d.explicit.add("pf");
    return { kind: "intent", label: "Ответ: профит-фактор", phrase: "профит-фактор" };
  });
  add("(?:максимальн\\p{L}*\\s+)?просадк\\p{L}*|drawdown|dd", (_m, st) => {
    st.d.explicit.add("drawdown");
    return { kind: "intent", label: "Ответ: макс. просадка", phrase: "просадка" };
  });
  add("(?<!по\\s{1,3})(?:средн\\p{L}*\\s+)?(?:врем\\p{L}*\\s+)?удержани\\p{L}*(?=\\s*$)|средн\\p{L}*\\s+(?:врем\\p{L}*\\s+)?удержани\\p{L}*|сколько\\s+(?:я\\s+)?(?:в\\s+среднем\\s+)?держ\\p{L}*|как\\s+долго\\s+(?:я\\s+)?держ\\p{L}*|средн\\p{L}*\\s+длительност\\p{L}*", (_m, st) => {
    st.d.explicit.add("hold");
    return { kind: "intent", label: "Ответ: среднее удержание", phrase: "среднее удержание" };
  });
  add("средн\\p{L}*\\s+(?:размер\\p{L}*|объем\\p{L}*|позици\\p{L}*)|размер\\p{L}*\\s+позици\\p{L}*|каким\\s+размером", (_m, st) => {
    st.d.explicit.add("size");
    return { kind: "intent", label: "Ответ: средний размер", phrase: "средний размер" };
  });
  const GROUPS: Array<[RegExp, AskDim, string]> = [
    [/^дням недели/, "weekday", "по дням недели"], [/^(тикерам|бумагам|акциям)/, "ticker", "по тикерам"], [/^дням/, "day", "по дням"],
    [/^часам/, "hour", "по часам"], [/^месяцам/, "month", "по месяцам"], [/^неделям/, "week", "по неделям"],
    [/^(сторонам|направлени)/, "side", "по сторонам"], [/^(сетапам|setup)/, "setup", "по сетапам"], [/^трейдерам/, "trader", "по трейдерам"],
    [/^(удержани|длительност|времени удержания)/, "holdBucket", "по удержанию"], [/^(размер|объем)/, "sizeBucket", "по размеру"],
    [/^(времени дня|сессиям|времени)/, "slot", "по времени дня"],
  ];
  add("(?:по|в\\s+разрезе|с\\s+разбивкой\\s+по)\\s+(дням\\s+недели|тикерам|бумагам|акциям|дням|часам|месяцам|неделям|сторонам|направлению|направлениям|сетапам|setups?|трейдерам|удержанию|длительности|времени\\s+удержания|размеру|объему|времени\\s+дня|сессиям|времени)", (m, st) => {
    const w = m[1].replace(/\s+/g, " ");
    const g = GROUPS.find(([r]) => r.test(w));
    if (!g) return false;
    st.d.groupBy = g[1];
    if (g[1] === "trader") st.d.allTraders = true;
    return { kind: "group", label: `Группировка: ${g[2]}`, phrase: g[2] };
  });
  add("средн\\p{L}*|в\\s+среднем|avg|матожидани\\p{L}*|мат\\s+ожидани\\p{L}*|ожидани\\p{L}*|expectancy", (_m, st) => {
    st.d.explicit.add("avg");
    return { kind: "intent", label: "Ответ: среднее нетто на сделку", phrase: "в среднем" };
  });
  add("сколько\\s+(?:было\\s+|всего\\s+)?(?:сделок|трейдов|раз)|количество(?:\\s+сделок)?|число\\s+сделок|кол-?во(?:\\s+сделок)?", (_m, st) => {
    st.d.explicit.add("count");
    return { kind: "intent", label: "Ответ: количество сделок", phrase: "сколько сделок" };
  });
  add("нетто|net|p&l|pnl|пнл|прибыл[ьи]|итог\\p{L}*|результат\\p{L}*|сумм\\p{L}*|доход\\p{L}*|заработ(?:ок|ка)|профит", (_m, st) => {
    st.d.explicit.add("sum");
    return { kind: "intent", label: "Ответ: нетто", phrase: "нетто" };
  });
  add("сколько", (_m, st) => {
    st.d.countHint = true;
    return null;
  });

  // 14. Side and result.
  add("лонг\\p{L}*|long\\p{L}*|покупк\\p{L}*|шорт\\p{L}*|short\\p{L}*", (m, st) => {
    const side: AskSide = /^(лонг|long|покуп)/.test(m[0]) ? "Long" : "Short";
    if (!st.d.sides.includes(side)) st.d.sides.push(side);
    return { kind: "side", label: `Сторона: ${side === "Long" ? "лонг" : "шорт"}`, phrase: side === "Long" ? "лонги" : "шорты" };
  });
  const outcome = (body: string, o: AskOutcome, word: string) =>
    add(body, (_m, st) => {
      if (!st.d.outcomes.includes(o)) st.d.outcomes.push(o);
      return { kind: "outcome", label: `Результат: ${word}`, phrase: word };
    });
  outcome("убыточн\\p{L}*|минусов\\p{L}*|в\\s+минус|лосс\\p{L}*|losses|losers?|losing|проигрышн\\p{L}*|стопы|убытк\\p{L}*|убыток", "loss", "убыточные");
  outcome("прибыльн\\p{L}*|плюсов\\p{L}*|в\\s+плюс|профитн\\p{L}*|выигрышн\\p{L}*|winners?|winning", "win", "прибыльные");
  outcome("безубыт\\p{L}*|в\\s+ноль|breakeven|break-even", "breakeven", "безубыточные");

  // 15. «сетап X» (any word after it; known setups are matched later as bare words too).
  add("(?:сетап\\p{L}*|setup|паттерн\\p{L}*|стратеги\\p{L}*)\\s+([\\p{L}\\p{N}][\\p{L}\\p{N}\\-]*(?:\\s+(?:and|&|и|n)\\s+[\\p{L}\\p{N}][\\p{L}\\p{N}\\-]*)?)", (m, st) => {
    const word = m[1];
    if (/^(по|и|в|за|на|с)$/.test(word)) return false;
    const known = st.setups.find((s) => normWord(s) === word) ?? st.setups.find((s) => normWord(s).startsWith(word) || word.startsWith(normWord(s)));
    const name = known ?? word;
    if (!st.d.setups.includes(name)) st.d.setups.push(name);
    return { kind: "setup", label: `Сетап: ${name}`, phrase: `сетап «${name}»` };
  });

  return rules;
}

const RULES = buildRules();

// ── Leftovers: trader names, setups, tickers, noise ───────────────────────────

const NOISE = new Set([
  "сделки", "сделок", "сделка", "сделку", "сделках", "сделкам", "сделками", "трейды", "трейдов", "трейд", "трейдам",
  "мои", "мой", "моих", "моя", "мое", "мне", "меня", "я", "у", "по", "в", "во", "на", "за", "и", "а", "с", "со", "от", "до", "для", "из", "к", "о", "об", "при",
  "все", "всех", "всего", "какой", "какая", "какие", "каким", "каких", "какое", "был", "была", "были", "было", "есть", "самый", "самая", "самое", "самые", "самых",
  "что", "как", "это", "эти", "этот", "покажи", "показать", "найди", "выведи", "список", "дай", "скажи", "пожалуйста", "плиз",
  "ли", "бы", "же", "только", "торговля", "торговли", "торговал", "торговала", "торгую", "торговать", "входы", "вход", "входа", "года", "год", "г", "г.", "-", "—", "–", ":",
  "и/или", "мною", "трейдер", "трейдера", "трейдеру", "журнал", "журнале", "холд", "удержание", "удержания", "удержанием", "держал", "держала", "цена", "цене", "входе",
  "съели", "съедают", "съело", "ушло", "ушли", "потратил", "заплатил", "плачу", "платил", "мне", "нам", "чаще", "реже", "всё", "весь", "целом", "общем",
  "сделал", "сделала", "делал", "открывал", "открыл", "закрыл", "акций", "акции", "шт", "позиции", "позиция", "размер", "размером", "раз", "дней", "дня",
  "show", "me", "my", "the", "of", "in", "for", "all", "and", "a", "trades", "trade",
]);

/** Latin words that are vocabulary, not tickers. */
const NOT_TICKERS = new Set([
  "long", "short", "vs", "ytd", "mtd", "qtd", "net", "pnl", "wr", "am", "pm", "and", "or", "the", "of", "in", "on", "by", "all", "my", "me",
  "top", "best", "worst", "fee", "fees", "s", "m", "h", "min", "sec", "usd", "win", "wins", "loss", "trades", "trade", "show", "for", "a", "to", "from",
  "pf", "dd", "desk", "setup", "setups", "vs.",
]);

const NAME_SUFFIX = "(?:а|у|ом|е|ым|ой|ы|я|ю|ем|и)?";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normWord(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[_]+/g, " ").trim();
}

function matchTraders(st: State) {
  const names = [...st.traders].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const n = normWord(name);
    if (n.length < 2) continue;
    runRule(st, {
      re: re(`(?:у\\s+|трейдер\\p{L}*\\s+)?${escapeRe(n)}${NAME_SUFFIX}`),
      fn: (_m, s) => {
        if (s.d.traders.includes(name)) return null;
        s.d.traders.push(name);
        return { kind: "trader", label: `Трейдер: ${name}`, phrase: name };
      },
    });
  }
}

function matchSetups(st: State) {
  const names = [...st.setups].filter((s) => s && s.length >= 3).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const n = normWord(name);
    runRule(st, {
      re: re(escapeRe(n).replace(/\s+/g, "\\s+")),
      fn: (_m, s) => {
        if (s.d.setups.includes(name)) return null;
        s.d.setups.push(name);
        return { kind: "setup", label: `Сетап: ${name}`, phrase: `сетап «${name}»` };
      },
    });
  }
}

function matchTickers(st: State) {
  runRule(st, {
    re: new RegExp(`${L}\\$?([a-z]{1,5}(?:\\.[a-z]{1,2})?)${R}`, "gu"),
    fn: (m, s) => {
      const w = m[1];
      if (NOT_TICKERS.has(w)) return false;
      const t = w.toUpperCase();
      if (s.d.tickers.includes(t)) return null;
      s.d.tickers.push(t);
      return { kind: "ticker", label: `Тикер: ${t}`, phrase: t };
    },
  });
}

function collectUnknown(st: State): string[] {
  const out: string[] = [];
  const wordRe = /[^\s]+/gu;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(st.s))) {
    const w = m[0].replace(/^[.:\-–—/&]+|[.:\-–—/&]+$/g, "");
    if (!w || NOISE.has(w) || NOT_TICKERS.has(w)) continue;
    const [os, oe] = mapSpan(st.prep, m.index, m.index + m[0].length);
    const origWord = st.orig.slice(os, oe).replace(/^[.:\-–—/,]+|[.:\-–—/,]+$/g, "");
    out.push(origWord || w);
  }
  return out;
}

// ── Phrases ───────────────────────────────────────────────────────────────────

export function afterPhrase(a: AskAfter): string {
  if (a.kind === "loss") return a.n > 1 ? `после ${a.n} убытков подряд` : "после убытка";
  return a.n > 1 ? `после ${a.n} прибыльных подряд` : "после прибыльной сделки";
}

export function weekdayPhrase(set: number[]): string {
  if (set.length === 1) return `по ${WD_DAT_PL[set[0]]}`;
  const names = set.map((d) => WD_DAT_PL[d]);
  return `по ${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

export const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function timeLabel(t: AskTimeRange): string {
  return t.phrase;
}

// ── Public API ────────────────────────────────────────────────────────────────

const TARGET_NOUN: Record<AskDim, { noun: string; pl: string; g: "m" | "f" }> = {
  ticker: { noun: "тикер", pl: "тикеры", g: "m" }, day: { noun: "день", pl: "дни", g: "m" }, hour: { noun: "час", pl: "часы", g: "m" },
  weekday: { noun: "день недели", pl: "дни недели", g: "m" }, month: { noun: "месяц", pl: "месяцы", g: "m" },
  week: { noun: "неделя", pl: "недели", g: "f" }, side: { noun: "сторона", pl: "стороны", g: "f" }, trade: { noun: "сделка", pl: "сделки", g: "f" },
  setup: { noun: "сетап", pl: "сетапы", g: "m" }, slot: { noun: "время дня", pl: "отрезки дня", g: "m" },
  holdBucket: { noun: "удержание", pl: "удержания", g: "m" }, sizeBucket: { noun: "размер", pl: "размеры", g: "m" },
  trader: { noun: "трейдер", pl: "трейдеры", g: "m" },
};

export function targetTitle(kind: "best" | "worst", dim: AskDim, plural = false): string {
  const t = TARGET_NOUN[dim];
  if (plural) return `${kind === "best" ? "Лучшие" : "Худшие"} ${t.pl}`;
  const adj = kind === "best" ? (t.g === "m" ? "Лучший" : "Лучшая") : t.g === "m" ? "Худший" : "Худшая";
  return `${adj} ${t.noun}`;
}

const METRIC_OF: Record<string, AskMetric> = { winrate: "winRate", fees: "fees", count: "n", avg: "avg", pf: "pf" };

function emptyDraft(): Draft {
  return {
    traders: [], allTraders: false, tickers: [], setups: [], sides: [], outcomes: [], dates: [], allTime: false, times: [], timeBound: null,
    weekdaySets: [], price: null, holdSec: null, qty: null, after: null, lastN: null, compareFlag: null, best: null, topN: null,
    plural: false, target: null, whichTarget: null, leak: null, whenFlag: false, mostFlag: false, verb: null, streak: null,
    explicit: new Set(), countHint: false, groupBy: null,
  };
}

function boundingDate(ds: AskDateRange[]): AskDateRange | null {
  if (!ds.length) return null;
  if (ds.length === 1) return ds[0];
  const from = ds.reduce((a, d) => (d.from < a ? d.from : a), ds[0].from);
  const to = ds.reduce((a, d) => (d.to > a ? d.to : a), ds[0].to);
  return { from, to, phrase: ds.map((d) => d.phrase).join(" и ") };
}

function boundingTime(ts: AskTimeRange[], bound: Draft["timeBound"]): AskTimeRange | null {
  let t: AskTimeRange | null = null;
  if (ts.length === 1) t = ts[0];
  else if (ts.length > 1) {
    const from = Math.min(...ts.map((x) => x.fromMin ?? 0));
    const to = Math.max(...ts.map((x) => x.toMin ?? 24 * 60));
    t = { fromMin: from, toMin: to, phrase: ts.map((x) => x.phrase).join(" и ") };
  }
  if (bound) {
    const fromMin = Math.max(t?.fromMin ?? -1, bound.fromMin ?? -1);
    const toMin = Math.min(t?.toMin ?? 9999, bound.toMin ?? 9999);
    const f = fromMin < 0 ? null : fromMin, to = toMin >= 9999 ? null : toMin;
    const phrase = f != null && to != null ? `с ${fmtClock(f)} до ${fmtClock(to)}` : f != null ? `после ${fmtClock(f)}` : `до ${fmtClock(to ?? 0)}`;
    return { fromMin: f, toMin: to, phrase: t ? `${t.phrase}, ${phrase}` : phrase };
  }
  return t;
}

/** Pick the facet to compare (or null) — two values of one facet + a compare hint. */
function pickCompare(d: Draft): AskCompare | null {
  const flag = d.compareFlag;
  const sideA = (s: AskSide): AskCompareSide => ({ label: s === "Long" ? "лонг" : "шорт", patch: { side: s } });
  if (d.sides.length === 2 && (flag || !d.tickers.length || d.tickers.length < 2)) {
    // «лонг и шорт» always means a comparison, unless the user compares two tickers.
    if (!(flag && d.tickers.length >= 2)) return { dim: "side", a: sideA("Long"), b: sideA("Short") };
  }
  if (d.traders.length >= 2) return { dim: "trader", a: { label: d.traders[0], patch: { trader: d.traders[0] } }, b: { label: d.traders[1], patch: { trader: d.traders[1] } } };
  if (!flag) return null;
  if (d.tickers.length >= 2) return { dim: "ticker", a: { label: d.tickers[0], patch: { tickers: [d.tickers[0]] } }, b: { label: d.tickers[1], patch: { tickers: [d.tickers[1]] } } };
  if (d.times.length >= 2) {
    const [x, y] = d.times;
    return { dim: "time", a: { label: timeLabel(x), patch: { time: x } }, b: { label: timeLabel(y), patch: { time: y } } };
  }
  if (d.weekdaySets.length >= 2) {
    const [x, y] = d.weekdaySets;
    const lab = (s: number[]) => s.map((i) => WD_NOM[i]).join(", ");
    return { dim: "weekday", a: { label: lab(x), patch: { weekdays: x } }, b: { label: lab(y), patch: { weekdays: y } } };
  }
  if (d.dates.length >= 2) {
    const [x, y] = d.dates;
    return { dim: "date", a: { label: x.phrase, patch: { date: x } }, b: { label: y.phrase, patch: { date: y } } };
  }
  if (d.setups.length >= 2) return { dim: "setup", a: { label: d.setups[0], patch: { setups: [d.setups[0]] } }, b: { label: d.setups[1], patch: { setups: [d.setups[1]] } } };
  if (d.outcomes.length >= 2) {
    const lab = (o: AskOutcome) => (o === "win" ? "прибыльные" : o === "loss" ? "убыточные" : "безубыточные");
    return { dim: "outcome", a: { label: lab(d.outcomes[0]), patch: { outcome: d.outcomes[0] } }, b: { label: lab(d.outcomes[1]), patch: { outcome: d.outcomes[1] } } };
  }
  if (flag === "strong" && d.sides.length < 2 && !d.tickers.length) return { dim: "side", a: sideA("Long"), b: sideA("Short") };
  return null;
}

export function parseAsk(text: string, ctx: ParseContext): AskQuery {
  const raw = text ?? "";
  const traders = ctx.traders ?? [];
  const setups = ctx.setups ?? [];
  const protect = new Set<string>([...traders, ...setups].map(normWord).filter((x) => x.length >= 2));
  const prep = prepare(raw, { protect, tickers: new Set((ctx.tickers ?? []).map((t) => t.toUpperCase())) });
  const st: State = { orig: raw, prep, s: prep.text, today: ctx.today, traders, setups, tokens: [], d: emptyDraft() };

  // Trader names first: a name like «Тимур» must not be eaten by another rule, and Latin names are not tickers.
  matchTraders(st);
  for (const rule of RULES) runRule(st, rule);
  matchSetups(st);
  matchTickers(st);
  const unknown = collectUnknown(st);

  const d = st.d;
  const tokens = [...st.tokens];

  let compare = pickCompare(d);
  // Keep the user's order: «утро vs после обеда» ⇒ A = утро, even when the «после обеда» rule ran first.
  if (compare) {
    const pos = (label: string) => {
      const l = label.toLowerCase();
      const tok = tokens.find((t) => t.start >= 0 && (t.phrase.toLowerCase() === l || t.text.toLowerCase() === l || t.label.toLowerCase().endsWith(l)));
      return tok ? tok.start : -1;
    };
    const pa = pos(compare.a.label), pb = pos(compare.b.label);
    if (pa >= 0 && pb >= 0 && pb < pa) compare = { ...compare, a: compare.b, b: compare.a };
  }
  const cdim = compare?.dim;

  // Filters (the compared facet stays out of the base filter).
  const side: AskSide | null = cdim === "side" ? null : d.sides.length === 1 ? d.sides[0] : null;
  const tickers = cdim === "ticker" ? [] : d.tickers;
  const date = cdim === "date" || d.allTime ? (d.allTime && cdim !== "date" ? null : null) : boundingDate(d.dates);
  const time = cdim === "time" ? (d.timeBound ? boundingTime([], d.timeBound) : null) : boundingTime(d.times, d.timeBound);
  const wdUnion = [...new Set(d.weekdaySets.flat())].sort();
  const weekdays = cdim === "weekday" || !wdUnion.length ? null : wdUnion;
  const setupsF = cdim === "setup" ? [] : d.setups;
  const outcomeF = cdim === "outcome" ? null : d.outcomes.length ? d.outcomes[d.outcomes.length - 1] : null;
  const trader = cdim === "trader" ? null : d.traders[0] ?? null;

  // Intent precedence.
  let intent: AskIntent = "list";
  let target: AskDim | null = null;
  let insight: "best" | "worst" | null = null;
  let metric: AskMetric = "net";
  for (const k of ["winrate", "fees", "pf", "count", "avg"] as const) if (d.explicit.has(k)) { metric = METRIC_OF[k]; break; }
  if (d.mostFlag && !d.verb && d.whichTarget && !d.best) metric = "n";

  if (compare) intent = "compare";
  else if (d.streak) intent = "streak";
  else if (d.best) { intent = d.best; target = d.target ?? d.whichTarget ?? d.groupBy ?? "trade"; }
  else if ((d.whenFlag || d.mostFlag || d.whichTarget) && d.verb && !d.explicit.has("fees")) {
    if (d.whichTarget) { intent = d.verb === "lose" ? "worst" : "best"; target = d.whichTarget; }
    else { intent = "insight"; insight = d.verb === "lose" ? "worst" : "best"; }
  } else if (d.leak && !d.explicit.has("fees")) {
    if (d.whichTarget) { intent = d.leak; target = d.whichTarget; }
    else { intent = "insight"; insight = d.leak; }
  } else if (d.whichTarget && d.mostFlag) { intent = "best"; target = d.whichTarget; }
  else if (d.explicit.has("fees")) intent = "fees";
  else if (d.explicit.has("winrate")) intent = "winrate";
  else if (d.explicit.has("pf")) intent = "pf";
  else if (d.explicit.has("hold")) intent = "hold";
  else if (d.explicit.has("size")) intent = "size";
  else if (d.explicit.has("drawdown")) intent = "drawdown";
  else if (d.explicit.has("avg")) intent = "avg";
  else if (d.explicit.has("sum")) intent = "sum";
  else if (d.explicit.has("count") || d.countHint) intent = "count";
  if (intent === "best" || intent === "worst") {
    if (metric === "net" && d.explicit.has("avg")) metric = "avg";
  }

  let groupBy: AskDim | null = d.groupBy ?? (intent === "list" || intent === "sum" || intent === "count" || intent === "winrate" || intent === "avg" || intent === "fees" || intent === "pf" ? d.whichTarget : null);
  if ((intent === "best" || intent === "worst") && target && target !== "trade") groupBy = target;
  if (intent === "compare") groupBy = null;
  const topN = intent === "best" || intent === "worst" ? (d.topN ?? (d.plural ? 5 : 1)) : 1;

  if (compare) {
    tokens.push({ key: "compare", kind: "compare", label: `Сравнение: ${compare.a.label} vs ${compare.b.label}`, phrase: `${compare.a.label} vs ${compare.b.label}`, text: "", start: -1, end: -1 });
  }
  if ((intent === "best" || intent === "worst") && target) {
    const title = topN > 1 ? `${targetTitle(intent, target, true).toLowerCase()} (топ ${topN})` : targetTitle(intent, target).toLowerCase();
    const by = metric !== "net" ? ` · ${METRIC_WORD[metric]}` : "";
    tokens.push({ key: "intent:best", kind: "intent", label: `Ответ: ${title}${by}`, phrase: title, text: "", start: -1, end: -1 });
  }
  if (intent === "insight") {
    tokens.push({ key: "intent:insight", kind: "intent", label: insight === "worst" ? "Ответ: где вы теряете больше всего" : "Ответ: где вы зарабатываете больше всего", phrase: "разбор", text: "", start: -1, end: -1 });
  }
  if (intent === "count" && !tokens.some((t) => t.kind === "intent" && t.phrase === "сколько сделок")) {
    tokens.push({ key: "intent:count", kind: "intent", label: "Ответ: количество сделок", phrase: "сколько сделок", text: "", start: -1, end: -1 });
  }

  tokens.sort((a, b) => (a.start < 0 ? 1 : b.start < 0 ? -1 : a.start - b.start));

  return {
    raw,
    trader,
    allTraders: d.allTraders,
    tickers,
    setups: setupsF,
    side,
    outcome: outcomeF,
    date,
    time,
    weekdays,
    price: d.price,
    holdSec: d.holdSec,
    qty: d.qty,
    after: d.after,
    lastN: d.lastN,
    intent,
    target,
    groupBy,
    metric,
    topN,
    compare,
    streak: d.streak,
    insight,
    tokens,
    unknown,
    corrections: prep.corrections,
    ok: tokens.length > 0,
  };
}

export const METRIC_WORD: Record<AskMetric, string> = {
  net: "по нетто", winRate: "по винрейту", avg: "по среднему нетто", n: "по числу сделок", fees: "по комиссиям", pf: "по PF",
};

/** The filter part of a query (for one side of a comparison: merge `compare.x.patch` on top). */
export function filterOf(q: AskQuery): AskFilter {
  return {
    trader: q.trader, tickers: q.tickers, setups: q.setups, side: q.side, outcome: q.outcome, date: q.date, time: q.time,
    weekdays: q.weekdays, price: q.price, holdSec: q.holdSec, qty: q.qty, after: q.after, lastN: q.lastN,
  };
}

function tidy(s: string): string {
  return s.replace(/\s*,\s*(,\s*)+/g, ", ").replace(/^[\s,]+|[\s,]+$/g, "").replace(/\s{2,}/g, " ");
}

/** Text of the query with one chip's source span blanked (re-parse it to drop that facet). */
export function textWithoutToken(q: AskQuery, key: string): string {
  const tok = q.tokens.find((t) => t.key === key);
  if (!tok || tok.start < 0) return q.raw;
  return tidy(q.raw.slice(0, tok.start) + " " + q.raw.slice(tok.end));
}

/** Text of the query with one chip's source span replaced by `replacement` (chip editing). */
export function replaceToken(q: AskQuery, key: string, replacement: string): string {
  const tok = q.tokens.find((t) => t.key === key);
  if (!tok || tok.start < 0) return tidy(`${q.raw} ${replacement}`);
  return tidy(q.raw.slice(0, tok.start) + ` ${replacement} ` + q.raw.slice(tok.end));
}

export function removeToken(q: AskQuery, key: string, ctx: ParseContext): AskQuery {
  return parseAsk(textWithoutToken(q, key), ctx);
}

const SIDE_PL: Record<AskSide, string> = { Long: "лонги", Short: "шорты" };
const SIDE_GEN: Record<AskSide, string> = { Long: "лонгов", Short: "шортов" };
const OUTCOME_ADJ: Record<AskOutcome, string> = { win: "прибыльные", loss: "убыточные", breakeven: "безубыточные" };
const OUTCOME_GEN: Record<AskOutcome, string> = { win: "прибыльных", loss: "убыточных", breakeven: "безубыточных" };

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function holdPhrase(h: AskNumRange): string {
  if (h.min != null && h.max != null) return `с удержанием ${fmtDuration(h.min)}–${fmtDuration(h.max)}`;
  if (h.min != null) return `дольше ${fmtDuration(h.min)}`;
  return `короче ${fmtDuration(h.max ?? 0)}`;
}

function pricePhrase(p: AskNumRange): string {
  if (p.min != null && p.max != null) return `по цене ${fmtUsd(p.min)}–${fmtUsd(p.max)}`;
  if (p.min != null) return `дороже ${fmtUsd(p.min)}`;
  return `дешевле ${fmtUsd(p.max ?? 0)}`;
}

function qtyPhrase(p: AskNumRange): string {
  if (p.min != null && p.max != null) return `размером ${p.min}–${p.max} акций`;
  if (p.min != null) return `размером от ${p.min} акций`;
  return `размером меньше ${p.max ?? 0} акций`;
}

/** Context tail shared by every headline: tickers, setups, period, time, weekdays, price, hold, size, context, trader. */
export function filterTail(q: AskFilter, opts: { tickers?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.tickers !== false && q.tickers.length) parts.push(q.tickers.join(", "));
  if (q.setups.length) parts.push(q.setups.map((s) => `«${s}»`).join(", "));
  if (q.date) parts.push(q.date.phrase.toLowerCase());
  if (q.weekdays) parts.push(weekdayPhrase(q.weekdays));
  if (q.time) parts.push(q.time.phrase);
  if (q.price) parts.push(pricePhrase(q.price));
  if (q.holdSec) parts.push(holdPhrase(q.holdSec));
  if (q.qty) parts.push(qtyPhrase(q.qty));
  if (q.after) parts.push(afterPhrase(q.after));
  if (q.lastN) parts.push(`(последние ${q.lastN})`);
  if (q.trader) parts.push(`· ${q.trader}`);
  return parts.join(" ");
}

/** Short noun phrase for the filtered set: «Шорты INTC в октябре после 11:00». */
export function describeFilter(q: AskFilter): string {
  let base: string;
  if (q.side && q.outcome) base = `${cap(OUTCOME_ADJ[q.outcome])} ${SIDE_PL[q.side]}`;
  else if (q.side) base = cap(SIDE_PL[q.side]);
  else if (q.outcome) base = `${cap(OUTCOME_ADJ[q.outcome])} сделки`;
  else base = "Сделки";
  const tail = filterTail(q);
  return tail ? `${base} ${tail}` : base;
}

/**
 * Human subject of the query (no numbers): «Шорты INTC в октябре после 11:00», «Лучший тикер за месяц»,
 * «Лонг vs шорт за квартал».
 */
export function describeSubject(q: AskQuery): string {
  if (q.intent === "compare" && q.compare) {
    const head = `${cap(q.compare.a.label)} vs ${q.compare.b.label}`;
    const base = [q.outcome ? OUTCOME_ADJ[q.outcome] : "", q.side ? SIDE_PL[q.side] : "", filterTail(q)].filter(Boolean).join(" ");
    return [head, base].filter(Boolean).join(" · ");
  }
  if ((q.intent === "best" || q.intent === "worst") && q.target) {
    const among: string[] = [];
    if (q.outcome && q.side) among.push(`среди ${OUTCOME_GEN[q.outcome]} ${SIDE_GEN[q.side]}`);
    else if (q.side) among.push(`среди ${SIDE_GEN[q.side]}`);
    else if (q.outcome) among.push(`среди ${OUTCOME_GEN[q.outcome]}`);
    return [targetTitle(q.intent, q.target, q.topN > 1), ...among, filterTail(q)].filter(Boolean).join(" ");
  }
  if (q.intent === "insight") {
    const head = q.insight === "worst" ? "Где вы теряете больше всего" : "Где вы зарабатываете больше всего";
    const tail = [q.side ? `(${SIDE_PL[q.side]})` : "", filterTail(q)].filter(Boolean).join(" ");
    return tail ? `${head} ${tail}` : head;
  }
  if (q.intent === "streak") {
    const head = q.streak?.kind === "loss" ? "Серии убытков" : q.streak?.kind === "win" ? "Серии побед" : "Серии";
    const tail = filterTail(q);
    return tail ? `${head} ${tail}` : head;
  }
  return describeFilter(q);
}

/** Hints for «Не понял»: what the parser knows. */
export const ASK_HINTS = [
  "Тикер латиницей: INTC, MRK; сетап: «сетап news»",
  "Сторона: лонги / шорты; результат: прибыльные / убыточные",
  "Период: сегодня, вчера, на этой неделе, в сентябре, с 1 августа, за последние 2 недели, YTD, за всё время",
  "Время входа: утром, в обед, после обеда, power hour, до 10:30, после 11:00; дни: по пятницам",
  "Удержание: дольше 5 минут; размер: больше 100 акций; цена: дешевле 10$; контекст: после убытка",
  "Ответ: сколько, нетто, винрейт, комиссии, PF, просадка, среднее удержание, серии",
  "Топ и сравнения: топ 5 тикеров, худшие дни, утро vs после обеда, AAPL vs NVDA, когда я теряю больше всего",
] as const;
