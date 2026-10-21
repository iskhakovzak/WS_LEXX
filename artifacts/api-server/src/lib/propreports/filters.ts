/**
 * PropReports API v2 "Advanced Filtering" for the `fills` action (pure).
 *
 *   text     symbol, liquidity, route, orderId, execBroker, contra
 *              exact `AAPL` · list `AAPL,MSFT` · trailing wildcard `AAPL%` · empty value `""` · mixed `ARCA,""`
 *              (a leading `%AAPL` is NOT a suffix match on the server — it is treated as an exact value)
 *   numeric  quantity, price
 *              `>1000` · `>=1000` · `!=1000` · range `1000-2000` · not in range `!=1000-2000`
 *              list `1000,1500,2000` · exclusion list `!=1000,2000`
 *   type     comma list of B (Buy), S (Sell), T (Short), C (Cover)
 *
 * Callers pass either a raw string (sent as is after validation) or a structured value that is serialised here.
 */

export type TextFilter =
  | string
  | { values: Array<string | "">; prefix?: never }
  | { prefix: string; values?: never };

export type NumericFilter =
  | string
  | number
  | { gt: number }
  | { gte: number }
  | { ne: number }
  | { between: [number, number] }
  | { notBetween: [number, number] }
  | { in: number[] }
  | { notIn: number[] };

export type FillSide = "B" | "S" | "T" | "C";

export interface FillFilters {
  symbol?: TextFilter;
  type?: FillSide | FillSide[];
  quantity?: NumericFilter;
  price?: NumericFilter;
  route?: TextFilter;
  liquidity?: TextFilter;
  orderId?: TextFilter;
  /** superuser only */
  execBroker?: TextFilter;
  /** superuser only */
  contra?: TextFilter;
}

export const TEXT_FILTER_KEYS = ["symbol", "route", "liquidity", "orderId", "execBroker", "contra"] as const;
export const NUMERIC_FILTER_KEYS = ["quantity", "price"] as const;
export const FILL_SIDES: readonly FillSide[] = ["B", "S", "T", "C"];

export class FilterError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "FilterError";
  }
}

const num = (n: number): string => {
  if (!Number.isFinite(n)) throw new FilterError("number", `not a finite number: ${n}`);
  return String(n);
};

const quoteEmpty = (v: string): string => (v === "" ? '""' : v);

/** One text value: no commas inside (the server splits on them), `%` only at the end. */
function checkTextValue(field: string, v: string): void {
  if (v === '""' || v === "") return;
  if (v.includes(",")) throw new FilterError(field, `value may not contain a comma: ${v}`);
  const pct = v.indexOf("%");
  if (pct >= 0 && pct !== v.length - 1) throw new FilterError(field, `only a trailing % wildcard is supported: ${v}`);
}

export function serializeTextFilter(field: string, f: TextFilter): string {
  if (typeof f === "string") {
    const s = f.trim();
    if (!s) throw new FilterError(field, "empty filter (use { values: [\"\"] } to match an empty value)");
    s.split(",").forEach((v) => checkTextValue(field, v.trim()));
    return s.split(",").map((v) => v.trim()).join(",");
  }
  if ("prefix" in f && f.prefix != null) {
    const p = f.prefix.trim();
    if (!p) throw new FilterError(field, "empty prefix");
    checkTextValue(field, `${p}%`);
    return `${p}%`;
  }
  const values = (f.values ?? []).map((v) => v.trim());
  if (!values.length) throw new FilterError(field, "no values");
  values.forEach((v) => checkTextValue(field, v));
  return values.map(quoteEmpty).join(",");
}

const NUMERIC_RE = /^(?:>=?\d+(?:\.\d+)?|!=\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?|(?:,\d+(?:\.\d+)?)+)?|\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?|(?:,\d+(?:\.\d+)?)+)?)$/;

export function serializeNumericFilter(field: string, f: NumericFilter): string {
  let s: string;
  if (typeof f === "number") s = num(f);
  else if (typeof f === "string") s = f.replace(/\s+/g, "");
  else if ("gt" in f) s = `>${num(f.gt)}`;
  else if ("gte" in f) s = `>=${num(f.gte)}`;
  else if ("ne" in f) s = `!=${num(f.ne)}`;
  else if ("between" in f) s = `${num(Math.min(...f.between))}-${num(Math.max(...f.between))}`;
  else if ("notBetween" in f) s = `!=${num(Math.min(...f.notBetween))}-${num(Math.max(...f.notBetween))}`;
  else if ("in" in f) {
    if (!f.in.length) throw new FilterError(field, "empty list");
    s = f.in.map(num).join(",");
  } else {
    if (!f.notIn.length) throw new FilterError(field, "empty exclusion list");
    s = `!=${f.notIn.map(num).join(",")}`;
  }
  if (!NUMERIC_RE.test(s)) throw new FilterError(field, `unsupported numeric filter: ${s}`);
  return s;
}

export function serializeSides(t: FillSide | FillSide[] | string): string {
  const list = (Array.isArray(t) ? t : String(t).split(",")).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!list.length) throw new FilterError("type", "empty");
  for (const x of list) if (!FILL_SIDES.includes(x as FillSide)) throw new FilterError("type", `unknown side ${x} (B, S, T, C)`);
  return [...new Set(list)].join(",");
}

/** FillFilters → request params (only the keys that are set). Throws FilterError on malformed input. */
export function fillFilterParams(f: FillFilters = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TEXT_FILTER_KEYS) {
    const v = f[k];
    if (v != null) out[k] = serializeTextFilter(k, v);
  }
  for (const k of NUMERIC_FILTER_KEYS) {
    const v = f[k];
    if (v != null) out[k] = serializeNumericFilter(k, v);
  }
  if (f.type != null) out.type = serializeSides(f.type);
  return out;
}
