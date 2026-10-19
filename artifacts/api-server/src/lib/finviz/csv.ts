/**
 * Finviz export CSV → typed rows (pure; unit-tested with fixtures in __tests__/fixtures). Columns are matched by
 * HEADER NAME (aliases below), never by position, so a view with extra / missing / reordered columns still parses.
 *
 * Cells: "" and "-" are null. Numbers may carry "%", "K", "M", "B", "T" suffixes and thousands separators
 * ("1,234.5", "15.20B", "4.50%"). A bare number in a size column is in Finviz's export unit (BARE_UNIT: market cap /
 * shares in millions, average volume in thousands), a suffixed one is absolute. Earnings dates come as
 * "10/21/2026 4:30:00 PM", "10/21/2026", "2026-10-21", "Oct 21/b" or "Oct 21 AMC".
 */
import type { EarningsTiming } from "./types";

export type FinvizRow = {
  ticker: string;
  company: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  float: number | null;
  shortFloatPct: number | null;
  shortRatio: number | null;
  beta: number | null;
  atr: number | null;
  gapPct: number | null;
  avgVolume: number | null;
  relVolume: number | null;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  earningsDate: string | null;
  earningsTiming: EarningsTiming | null;
};

type Field = Exclude<keyof FinvizRow, "earningsTiming">;

/** Lower-cased header → field. */
const HEADERS: Record<string, Field> = {
  ticker: "ticker",
  company: "company",
  sector: "sector",
  industry: "industry",
  country: "country",
  "market cap": "marketCap",
  "shares outstanding": "sharesOutstanding",
  outstanding: "sharesOutstanding",
  "shares float": "float",
  float: "float",
  "short float": "shortFloatPct",
  "float short": "shortFloatPct",
  "short ratio": "shortRatio",
  beta: "beta",
  atr: "atr",
  "average true range": "atr",
  "atr (14)": "atr",
  gap: "gapPct",
  "average volume": "avgVolume",
  "avg volume": "avgVolume",
  "relative volume": "relVolume",
  "rel volume": "relVolume",
  price: "price",
  change: "changePct",
  volume: "volume",
  "earnings date": "earningsDate",
  earnings: "earningsDate",
};

const TEXT_FIELDS = new Set<Field>(["ticker", "company", "sector", "industry", "country"]);

/** Unit of a bare (unsuffixed) number per column, as Finviz exports it. Open question until the first real export. */
export const BARE_UNIT: Partial<Record<Field, number>> = {
  marketCap: 1e6,
  sharesOutstanding: 1e6,
  float: 1e6,
  avgVolume: 1e3,
};

const SUFFIX: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** RFC-4180-ish split: quoted cells, "" escapes, CRLF/LF; a trailing empty line is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const isEmpty = (s: string | undefined): boolean => s == null || s.trim() === "" || s.trim() === "-" || s.trim() === "N/A";

/**
 * "15.20B" → 15_200_000_000, "4.50%" → 4.5, "1,234" → 1234, "(1.5)" → -1.5, "" / "-" → null.
 * `bareUnit` multiplies a number without a K/M/B/T suffix (Finviz size columns in millions / thousands).
 */
export function parseNumber(raw: string | undefined, bareUnit = 1): number | null {
  if (isEmpty(raw)) return null;
  let s = raw!.trim().replace(/,/g, "").replace(/^\$/, "");
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  s = s.replace(/%$/, "");
  let mult = bareUnit;
  const last = s.slice(-1).toUpperCase();
  if (SUFFIX[last]) { mult = SUFFIX[last]; s = s.slice(0, -1); }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s) * mult * sign;
  if (!Number.isFinite(n)) return null;
  // keep cents / ratios exact enough, drop float noise from the multiplication
  return Math.abs(n) >= 1000 ? Math.round(n) : Math.round(n * 1e6) / 1e6;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Year for a month/day without one: the occurrence closest to `today` (Dec ↔ Jan wrap). */
function nearestYear(m: number, d: number, today: string): number {
  const y = Number(today.slice(0, 4));
  const t = Date.parse(`${today}T12:00:00Z`);
  let best = y;
  let bestDiff = Infinity;
  for (const cand of [y - 1, y, y + 1]) {
    const diff = Math.abs(Date.UTC(cand, m - 1, d, 12) - t);
    if (diff < bestDiff) { best = cand; bestDiff = diff; }
  }
  return best;
}

/** Timing from a clock time: before noon = before the open, from noon = after the close; 12:00 AM = unknown. */
function timingFromClock(h: number, min: number, ampm: string | undefined): EarningsTiming | null {
  let hh = h;
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (hh === 12) hh = pm ? 12 : 0;
    else if (pm) hh += 12;
  }
  if (hh === 0 && min === 0) return null;
  return hh < 12 ? "bmo" : "amc";
}

function timingFromWord(w: string | undefined): EarningsTiming | null {
  const s = (w ?? "").trim().toLowerCase();
  if (s === "b" || s === "bmo" || s === "before") return "bmo";
  if (s === "a" || s === "amc" || s === "after") return "amc";
  return null;
}

/** Earnings cell → { date, timing } (date null when unparseable). `today` = NY "YYYY-MM-DD" for year-less dates. */
export function parseEarnings(raw: string | undefined, today: string): { date: string | null; timing: EarningsTiming | null } {
  if (isEmpty(raw)) return { date: null, timing: null };
  const s = raw!.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i.exec(s);
  if (m) {
    const date = validYmd(Number(m[3]), Number(m[1]), Number(m[2]));
    const timing = m[4] != null ? timingFromClock(Number(m[4]), Number(m[5]), m[6]) : null;
    return { date, timing: date ? timing : null };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(s);
  if (m) {
    const date = validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    const timing = m[4] != null ? timingFromClock(Number(m[4]), Number(m[5]), undefined) : null;
    return { date, timing: date ? timing : null };
  }
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:\s*[/\s]\s*([A-Za-z]+))?$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (!mon) return { date: null, timing: null };
    const day = Number(m[2]);
    const date = validYmd(nearestYear(mon, day, today), mon, day);
    return { date, timing: date ? timingFromWord(m[3]) : null };
  }
  return { date: null, timing: null };
}

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * Parse a whole export. Rows without a valid ticker are skipped; duplicate tickers keep the first row.
 * Throws when the text is not a Finviz CSV (an HTML login page, an error text, no Ticker column).
 */
export function parseFinvizCsv(text: string, today: string): FinvizRow[] {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith("<") || head.includes("<html")) throw new Error("finviz: HTML instead of CSV (token rejected?)");
  const table = parseCsv(text);
  if (!table.length) return [];
  const header = table[0].map((h) => h.trim().toLowerCase());
  const cols: Array<Field | null> = header.map((h) => HEADERS[h] ?? null);
  if (!cols.includes("ticker")) throw new Error("finviz: CSV without a Ticker column");
  const out: FinvizRow[] = [];
  const seen = new Set<string>();
  for (const cells of table.slice(1)) {
    const row: FinvizRow = {
      ticker: "", company: null, sector: null, industry: null, country: null, marketCap: null, sharesOutstanding: null,
      float: null, shortFloatPct: null, shortRatio: null, beta: null, atr: null, gapPct: null, avgVolume: null,
      relVolume: null, price: null, changePct: null, volume: null, earningsDate: null, earningsTiming: null,
    };
    cols.forEach((f, i) => {
      if (!f) return;
      const cell = cells[i];
      if (f === "earningsDate") {
        const e = parseEarnings(cell, today);
        row.earningsDate = e.date;
        row.earningsTiming = e.timing;
      } else if (TEXT_FIELDS.has(f)) {
        (row as Record<string, unknown>)[f] = isEmpty(cell) ? null : cell!.trim();
      } else {
        (row as Record<string, unknown>)[f] = parseNumber(cell, BARE_UNIT[f] ?? 1);
      }
    });
    const t = (row.ticker ?? "").toUpperCase();
    if (!TICKER_RE.test(t) || seen.has(t)) continue;
    seen.add(t);
    row.ticker = t;
    out.push(row);
  }
  return out;
}
