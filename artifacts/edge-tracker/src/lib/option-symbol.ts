/**
 * OCC option symbols as PropReports stores them («META261016P00725000» = META, expiry 2026-10-16, put, strike 725).
 * `displayTicker` turns them into «META 725P 16.10» (the year is added when it is not the current one: «16.10.25»);
 * stock tickers pass through. `isOptionSymbol` — the desk-day chart has no candles for options.
 */
const OCC = /^([A-Z][A-Z0-9.]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export type OptionSymbol = { root: string; expiry: string; right: "C" | "P"; strike: number };

export function parseOptionSymbol(symbol: string | null | undefined): OptionSymbol | null {
  const m = OCC.exec((symbol ?? "").trim().toUpperCase());
  if (!m) return null;
  const [, root, yy, mm, dd, right, strike] = m;
  return { root, expiry: `20${yy}-${mm}-${dd}`, right: right as "C" | "P", strike: Number(strike) / 1000 };
}

export function isOptionSymbol(symbol: string | null | undefined): boolean {
  return parseOptionSymbol(symbol) != null;
}

export function displayTicker(symbol: string, currentYear: number = new Date().getFullYear()): string {
  const o = parseOptionSymbol(symbol);
  if (!o) return symbol;
  const [y, m, d] = o.expiry.split("-");
  const strike = Number.isInteger(o.strike) ? String(o.strike) : String(Number(o.strike.toFixed(3)));
  const date = Number(y) === currentYear ? `${d}.${m}` : `${d}.${m}.${y.slice(2)}`;
  return `${o.root} ${strike}${o.right} ${date}`;
}
