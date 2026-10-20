/**
 * GET /api/earnings/history/:ticker — reported quarters with a fallback chain (item 1.14, audit market.md P1: NASDAQ
 * earnings-surprise answers 200 with empty rows for every ticker, which read as «отчётов не было»).
 *   1. NASDAQ earnings-surprise (dates + EPS) — as before;
 *   2. Yahoo quoteSummary earningsHistory (EPS by fiscal quarter end, no report date) matched to the past report
 *      dates of the Finviz earnings calendar (finviz_earnings, DB only); dates without a Yahoo row still give a
 *      reaction quarter (EPS unknown);
 *   3. nothing → `sourceUnavailable` when every source failed, or when the ticker has traded long enough that it must
 *      have reported; an honest «no reports» only for a young listing whose sources answered.
 * The chain takes its fetchers as arguments (tests inject fakes); the real Yahoo / Finviz readers are below.
 */
export type SurpriseRow = {
  fiscalQuarter: string | null;
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePct: number | null;
};
/** Yahoo earningsHistory row: fiscal quarter end (YYYY-MM-DD) + EPS; surprisePct in percent. */
export type YahooEpsRow = { quarterEnd: string; epsActual: number | null; epsEstimate: number | null; surprisePct: number | null };
export type HistorySource = "nasdaq" | "yahoo" | "finviz";
/** Each fetcher: null = the source failed (unreachable / bad answer), [] = it answered with nothing. */
export type HistoryFetchers = {
  nasdaq: (ticker: string) => Promise<SurpriseRow[] | null>;
  yahoo: (ticker: string) => Promise<YahooEpsRow[] | null>;
  reportDates: (ticker: string) => Promise<string[] | null>;
};

/** A report lands at most this many days after its fiscal quarter end (10-K filers can take ~90 days). */
const REPORT_LAG_MAX_DAYS = 100;
/** Sessions of daily candles after which a listed company must have reported at least once (~4.5 months). */
export const MIN_SESSIONS_WITH_REPORTS = 90;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2025-06-30" → "Jun 2025" (the NASDAQ fiscalQtrEnd form). */
export function fiscalLabel(quarterEnd: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(quarterEnd);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : null;
}
const dayDiff = (a: string, b: string) => (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/**
 * Yahoo EPS quarters × past report dates: each quarter takes the earliest unused report date within
 * (quarterEnd, quarterEnd + 100 d]; a quarter with no date is dropped (no report day → no reaction); a date with no
 * quarter stays as a dates-only row. Newest first.
 */
export function mergeEpsWithDates(yahoo: readonly YahooEpsRow[], dates: readonly string[]): SurpriseRow[] {
  const free = [...new Set(dates)].sort();
  const out: SurpriseRow[] = [];
  for (const q of [...yahoo].sort((a, b) => a.quarterEnd.localeCompare(b.quarterEnd))) {
    const i = free.findIndex((d) => dayDiff(d, q.quarterEnd) > 0 && dayDiff(d, q.quarterEnd) <= REPORT_LAG_MAX_DAYS);
    if (i < 0) continue;
    out.push({ fiscalQuarter: fiscalLabel(q.quarterEnd), date: free[i], epsActual: q.epsActual, epsEstimate: q.epsEstimate, surprisePct: q.surprisePct });
    free.splice(i, 1);
  }
  for (const d of free) out.push({ fiscalQuarter: null, date: d, epsActual: null, epsEstimate: null, surprisePct: null });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const settle = <T>(p: Promise<T | null>): Promise<T | null> => p.catch(() => null);

/** The fallback chain. `today` (NY date) bounds the Finviz dates to reports that already happened. */
export async function surpriseRowsWithFallback(
  ticker: string,
  f: HistoryFetchers,
  today: string,
): Promise<{ rows: SurpriseRow[]; source: HistorySource | null; allFailed: boolean }> {
  const nasdaq = await settle(f.nasdaq(ticker));
  if (nasdaq && nasdaq.length) return { rows: nasdaq, source: "nasdaq", allFailed: false };
  const [yahoo, dates] = await Promise.all([settle(f.yahoo(ticker)), settle(f.reportDates(ticker))]);
  const rows = mergeEpsWithDates(yahoo ?? [], (dates ?? []).filter((d) => d < today));
  if (rows.length) return { rows, source: rows.some((r) => r.epsActual != null) ? "yahoo" : "finviz", allFailed: false };
  return { rows: [], source: null, allFailed: nasdaq === null && yahoo === null && dates === null };
}

/**
 * Empty history → «источник недоступен» (not «отчётов не было») when every source failed, or the ticker has traded
 * ≥ MIN_SESSIONS_WITH_REPORTS sessions (it must have reported), or its candles are unknown too.
 */
export function historyUnavailable(o: { rowsEmpty: boolean; allFailed: boolean; sessions: number | null }): boolean {
  if (!o.rowsEmpty) return false;
  return o.allFailed || o.sessions == null || o.sessions >= MIN_SESSIONS_WITH_REPORTS;
}

// ── Real fetchers (network / DB; lazily imported so the chain stays testable without them) ──

const rawNum = (v: unknown): number | null => {
  const n = typeof v === "object" && v != null ? Number((v as { raw?: unknown }).raw) : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Yahoo quoteSummary earningsHistory (last ~4 quarters). */
export async function fetchYahooEpsHistory(ticker: string): Promise<YahooEpsRow[] | null> {
  try {
    const { fetchYahooWithSession } = await import("./marketDataService");
    const resp = await fetchYahooWithSession((s) =>
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=earningsHistory&crumb=${encodeURIComponent(s.crumb)}`,
    );
    if (!resp || !resp.ok) return null;
    const data = (await resp.json()) as { quoteSummary?: { result?: Array<{ earningsHistory?: { history?: unknown[] } }> } };
    const hist = data?.quoteSummary?.result?.[0]?.earningsHistory?.history;
    if (!Array.isArray(hist)) return null;
    const out: YahooEpsRow[] = [];
    for (const h of hist as Array<Record<string, unknown>>) {
      const sec = rawNum(h.quarter);
      if (sec == null) continue;
      const sp = rawNum(h.surprisePercent);
      out.push({
        quarterEnd: new Date(sec * 1000).toISOString().slice(0, 10),
        epsActual: rawNum(h.epsActual),
        epsEstimate: rawNum(h.epsEstimate),
        surprisePct: sp == null ? null : +(sp * 100).toFixed(2),
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Past report dates from the Finviz earnings calendar (DB only, never a Finviz call). */
export async function readFinvizReportDates(ticker: string): Promise<string[] | null> {
  try {
    const { db } = await import("./finviz/store");
    const { rows } = await db().query(
      `SELECT date FROM finviz_earnings WHERE ticker = $1 AND superseded_at IS NULL ORDER BY date DESC LIMIT 12`,
      [ticker],
    );
    return rows.map((r) => String(r.date)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch {
    return null;
  }
}
