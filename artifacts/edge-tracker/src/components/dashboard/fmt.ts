import { formatCurrency } from "@/lib/format";

const MINUS = "−";

/** Signed R multiple: +2.5R / −1R. */
export function fmtR(r: number | null | undefined, digits = 2): string {
  if (r == null || !Number.isFinite(r)) return "—";
  const v = Math.round(r * 10 ** digits) / 10 ** digits;
  // Dot decimals like every other R on the desk (+0.21R, not +0,21R).
  const abs = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: digits });
  return `${v > 0 ? "+" : v < 0 ? MINUS : ""}${abs}R`;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrency(v).replace("-", MINUS);
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

/** Russian plural: plural(5, ["сделка","сделки","сделок"]). */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
