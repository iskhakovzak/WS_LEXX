/**
 * GET /analyst-actions helpers (item 1.14, moved out of routes/analyst-actions.ts):
 *   • firm aliases — one firm under one name (BofA / B of A Securities / Bank of America …) for the feed, the firm
 *     filter and every per-firm statistic;
 *   • market cap — the scan runs with fetchFundamentals:false, so ticker_data_cache knows the cap of a handful of
 *     tickers; the cap now comes from the Finviz snapshot, then the Finviz earnings calendar, then Yahoo's text;
 *   • scan status — «обновлено» is the last finished run of the scan job (job_runs), not the browser request time.
 * Rule for an unknown cap (owner may revisit): with a min cap set and includeUnknownCap off, a ticker whose cap no
 * source knows is EXCLUDED, and the response says how many actions / tickers were excluded that way.
 */
import { pool } from "@workspace/db";

// ── Firm aliases ────────────────────────────────────────────────────────────

/** Lower-case, accents / dots / apostrophes dropped, «&» → «and», every other non-alphanumeric run → one space. */
export function firmKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Canonical name → normalized prefixes (firmKey form). Order matters where prefixes overlap (TD Cowen before TD). */
export const FIRM_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["BofA Securities", ["bofa", "b of a", "bank of america", "banc of america", "merrill lynch", "baml"]],
  ["Citi", ["citi", "citigroup", "citibank", "citi research"]],
  ["JPMorgan", ["jpmorgan", "jp morgan", "j p morgan", "jpm"]],
  ["Morgan Stanley", ["morgan stanley"]],
  ["Goldman Sachs", ["goldman", "goldman sachs"]],
  ["Wells Fargo", ["wells fargo"]],
  ["Deutsche Bank", ["deutsche bank", "deutsche"]],
  ["Barclays", ["barclays"]],
  ["UBS", ["ubs"]],
  ["Credit Suisse", ["credit suisse"]],
  ["RBC Capital", ["rbc", "royal bank of canada"]],
  ["BMO Capital", ["bmo"]],
  ["TD Cowen", ["td cowen", "cowen"]],
  ["TD Securities", ["td securities"]],
  ["KeyBanc", ["keybanc", "key banc"]],
  ["Piper Sandler", ["piper sandler", "piper jaffray", "piper"]],
  ["Raymond James", ["raymond james"]],
  ["Stifel", ["stifel"]],
  ["Jefferies", ["jefferies"]],
  ["Needham", ["needham"]],
  ["Oppenheimer", ["oppenheimer"]],
  ["Mizuho", ["mizuho"]],
  ["Truist Securities", ["truist", "suntrust"]],
  ["Evercore ISI", ["evercore"]],
  ["Wedbush", ["wedbush"]],
  ["Bernstein", ["bernstein", "sanford c bernstein", "alliancebernstein", "alliance bernstein", "societe generale bernstein"]],
  ["H.C. Wainwright", ["hc wainwright", "h c wainwright"]],
  ["Baird", ["baird", "robert w baird", "rw baird"]],
  ["William Blair", ["william blair"]],
  ["Canaccord Genuity", ["canaccord"]],
  ["B. Riley Securities", ["b riley", "briley"]],
  ["Scotiabank", ["scotiabank", "scotia"]],
  ["Macquarie", ["macquarie"]],
  ["Guggenheim", ["guggenheim"]],
  ["Susquehanna", ["susquehanna"]],
  ["BTIG", ["btig"]],
  ["Benchmark", ["benchmark"]],
  ["Rosenblatt", ["rosenblatt"]],
  ["Loop Capital", ["loop capital"]],
  ["Wolfe Research", ["wolfe"]],
  ["Argus Research", ["argus"]],
  ["Northland", ["northland"]],
  ["Craig-Hallum", ["craig hallum"]],
  ["Roth Capital", ["roth"]],
  ["Citizens JMP", ["citizens jmp", "jmp"]],
  ["Telsey Advisory", ["telsey"]],
  ["D.A. Davidson", ["da davidson", "d a davidson"]],
  ["BNP Paribas Exane", ["bnp paribas", "exane"]],
  ["Nomura", ["nomura", "instinet"]],
  ["HSBC", ["hsbc"]],
  ["Seaport", ["seaport"]],
  ["Alliance Global Partners", ["alliance global", "agp", "a g p"]],
  ["Ladenburg Thalmann", ["ladenburg"]],
  ["Maxim Group", ["maxim"]],
  ["Chardan", ["chardan"]],
  ["Janney", ["janney"]],
  ["Compass Point", ["compass point"]],
  ["Morningstar", ["morningstar"]],
  ["Berenberg", ["berenberg"]],
  ["Redburn Atlantic", ["redburn"]],
  ["Societe Generale", ["societe generale", "soc gen"]],
];

const startsWithWord = (key: string, prefix: string) => key === prefix || key.startsWith(prefix + " ");

/** The one display name of a firm: a dictionary hit → its canonical name; otherwise the raw name, spaces collapsed. */
export function canonicalFirm(raw: string | null | undefined): string {
  const key = firmKey(raw);
  if (!key) return "";
  for (const [name, prefixes] of FIRM_ALIASES) if (prefixes.some((p) => startsWithWord(key, p))) return name;
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

/** firmKey(a.firm) in SQL (accents are not folded there). */
const FIRM_KEY_SQL = `btrim(regexp_replace(regexp_replace(replace(lower(a.firm), '&', ' and '), '[.''’]', '', 'g'), '[^a-z0-9]+', ' ', 'g'))`;

/**
 * SQL condition for the `firm` query param: a dictionary firm matches every alias (B of A, BofA, Bank of America …);
 * anything else keeps the old substring match. `next(v)` pushes a param and returns its `$n`.
 */
export function firmFilterSql(param: string, next: (v: unknown) => string): string {
  const canon = canonicalFirm(param);
  const entry = FIRM_ALIASES.find(([name]) => name === canon);
  if (!entry) return `a.firm ILIKE ${next(`%${param}%`)}`;
  const exact = next([...entry[1]]);
  const like = next(entry[1].map((p) => `${p} %`));
  return `(${FIRM_KEY_SQL} = ANY(${exact}::text[]) OR ${FIRM_KEY_SQL} LIKE ANY(${like}::text[]))`;
}

// ── Market cap ──────────────────────────────────────────────────────────────

/** "3.50T" / "150B" / "200M" / "1,234" → USD. */
export function parseMarketCap(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^([\d.,]+)\s*([TBMK])?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return null;
  const mult: Record<string, number> = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 };
  return n * (mult[(m[2] || "").toUpperCase()] ?? 1);
}

/** USD → "3.50T" / "150.00B" / "200.00M" (the ticker_data_cache text form). */
export function capText(usd: number | null | undefined): string | null {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd >= 1e12) return `${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `${(usd / 1e6).toFixed(2)}M`;
  return String(Math.round(usd));
}

/** Joins that give a.ticker its market cap sources (Finviz snapshot, latest Finviz earnings row, Yahoo text). */
export const CAP_JOINS_SQL = `
    LEFT JOIN ticker_data_cache t ON t.ticker = a.ticker
    LEFT JOIN finviz_ticker_snapshot fs ON fs.ticker = a.ticker AND fs.as_of IS NOT NULL
    LEFT JOIN LATERAL (SELECT fe.market_cap FROM finviz_earnings fe
                        WHERE fe.ticker = a.ticker AND fe.market_cap IS NOT NULL ORDER BY fe.date DESC LIMIT 1) fe ON TRUE`;

const YAHOO_CAP_SQL = `(
      CASE
        WHEN t.market_cap ~* '^[0-9.,]+\\s*T$' THEN (regexp_replace(t.market_cap, '[^0-9.]', '', 'g'))::numeric * 1e12
        WHEN t.market_cap ~* '^[0-9.,]+\\s*B$' THEN (regexp_replace(t.market_cap, '[^0-9.]', '', 'g'))::numeric * 1e9
        WHEN t.market_cap ~* '^[0-9.,]+\\s*M$' THEN (regexp_replace(t.market_cap, '[^0-9.]', '', 'g'))::numeric * 1e6
        WHEN t.market_cap ~* '^[0-9.,]+\\s*K$' THEN (regexp_replace(t.market_cap, '[^0-9.]', '', 'g'))::numeric * 1e3
        WHEN t.market_cap ~* '^[0-9.,]+$'      THEN (regexp_replace(t.market_cap, '[^0-9.]', '', 'g'))::numeric
        ELSE NULL
      END
    )`;

/** Market cap in USD (NULL = no source knows it). Finviz first: it covers the scan's tickers, Yahoo's text rarely does. */
export const CAP_USD_SQL = `COALESCE(fs.market_cap::numeric, fe.market_cap::numeric, ${YAHOO_CAP_SQL})`;

/**
 * Min-cap condition (pushed into SQL: LIMIT applies after it). Unknown cap: excluded unless includeUnknownCap.
 * `excludesUnknown` → the route also counts the actions / tickers that were dropped for an unknown cap.
 */
export function capFilterSql(minMarketCap: number, includeUnknownCap: boolean, next: (v: unknown) => string): { clause: string; excludesUnknown: boolean } | null {
  if (!(minMarketCap > 0)) return null;
  const p = next(minMarketCap);
  return includeUnknownCap
    ? { clause: `COALESCE(${CAP_USD_SQL} >= ${p}, TRUE)`, excludesUnknown: false }
    : { clause: `${CAP_USD_SQL} >= ${p}`, excludesUnknown: true };
}

/** Feed row cap: the SQL-resolved number, else Yahoo's text parsed. */
export function rowCap(capUsd: unknown, yahooText: string | null | undefined): { marketCapNum: number | null; marketCap: string | null } {
  const n = capUsd == null ? null : Number(capUsd);
  const num = n != null && Number.isFinite(n) && n > 0 ? n : parseMarketCap(yahooText);
  return { marketCapNum: num, marketCap: yahooText ?? capText(num) };
}

// ── Scan status (job_runs) ──────────────────────────────────────────────────

/** jobs/definitions.ts: the analyst scan job (cron every 20 min). */
export const ANALYST_SCAN_JOB = "market.analyst-actions";
/** No successful scan for this long → the source counts as unavailable (6 missed runs). */
export const SCAN_STALE_MS = 2 * 3600_000;

export type ScanStatus = { scannedAt: string | null; sourceUnavailable: boolean; checkedAt: string };
type RunRow = { status: string; started_at: Date | string | null; finished_at: Date | string | null } | null | undefined;
const isoOf = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/**
 * scannedAt = finish of the last successful scan; sourceUnavailable when the scan never succeeded, the last finished
 * run failed (error / timeout) or the last success is older than SCAN_STALE_MS; checkedAt = when the last finished run
 * ended (the «HH:MM» of «источник недоступен»), else now.
 */
export function scanStatusOf(last: RunRow, lastOkAt: Date | string | null | undefined, now = Date.now()): ScanStatus {
  const scannedAt = isoOf(lastOkAt);
  const failed = !!last && last.status !== "ok";
  const stale = !scannedAt || now - Date.parse(scannedAt) > SCAN_STALE_MS;
  return {
    scannedAt,
    sourceUnavailable: failed || stale,
    checkedAt: isoOf(last?.finished_at) ?? isoOf(last?.started_at) ?? new Date(now).toISOString(),
  };
}

/** Last finished run + last success of the scan job. A missing job_runs table reads as «never ran». */
export async function readScanStatus(): Promise<ScanStatus> {
  try {
    const { rows } = await pool.query<{ last: RunRow; last_ok: Date | null }>(
      `SELECT (SELECT row_to_json(x) FROM (SELECT status, started_at, finished_at FROM job_runs
                 WHERE job = $1 AND status IN ('ok', 'error', 'timeout') ORDER BY started_at DESC, id DESC LIMIT 1) x) AS last,
              (SELECT MAX(finished_at) FROM job_runs WHERE job = $1 AND status = 'ok') AS last_ok`,
      [ANALYST_SCAN_JOB],
    );
    return scanStatusOf(rows[0]?.last, rows[0]?.last_ok);
  } catch {
    return scanStatusOf(null, null);
  }
}
