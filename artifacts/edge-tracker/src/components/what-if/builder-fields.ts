/**
 * Field definitions of «Свой сценарий» (rule-builder.tsx): what each sentence field asks, its input and the rule it
 * builds. Pure (labels are getters over the whatIf namespace, read when rendered). A field is offered only when the
 * running API supports its rule (`requires`), the loaded trades can answer it (`visible`) and, for a choice, there is
 * something to choose (`options`).
 */
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { errorLabel, isErrorCode, type ErrorCode } from "@/components/shared/error-vocab";
import { ENTRY_MISTAKES, MAX_TAG_LEN, type PreviewTrade, type Rule, type RuleType, stopsRecorded } from "./rules";

export type Mode = "exclude" | "stop" | "cap";
export type Op = { id: string; label: string };
export type Choice = { value: string; label: string };
export type FieldDef = {
  id: string;
  label: string;
  ops: Op[];
  input: "time" | "tickers" | "number" | "none" | "choice";
  unit?: string;
  placeholder?: string;
  defaultValue: string;
  /** Number input bounds (default min 0, any step). */
  min?: number;
  max?: number;
  step?: number;
  requires: RuleType;
  /** Shown only when the loaded trades can answer the question (default: always). */
  visible?: (trades: PreviewTrade[], ctx: { team: boolean }) => boolean;
  /** Choice input: the values present in the loaded trades, most frequent first. */
  options?: (trades: PreviewTrade[]) => Choice[];
  build: (op: string, value: string) => Rule | null;
};

const num = (v: string): number | null => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && v.trim() !== "" ? n : null;
};
const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const wt = whatIfI18n.t;
const isOp: Op = { id: "is", get label() { return wt("builder.op.is"); } };

/** Values by count, most frequent first (ties by label). */
function byCount<K>(trades: PreviewTrade[], keysOf: (t: PreviewTrade) => K[] | undefined, limit = Infinity): [K, number][] {
  const m = new Map<K, number>();
  for (const t of trades) for (const k of keysOf(t) ?? []) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

/**
 * Entry-time mistake codes marked on the loaded trades. Exit / outcome mistakes («Пересидел убыток», «Поздний выход» …)
 * are set because the trade went wrong: removing those trades would be a circular «what if».
 */
export function mistakeOptions(trades: PreviewTrade[]): Choice[] {
  return byCount<ErrorCode>(trades, (t) => t.mistakes?.filter((c) => ENTRY_MISTAKES.has(c))).map(([code]) => ({ value: code, label: errorLabel(code) }));
}

/** Personal tags of the loaded trades (case-insensitive, the first spelling), top 20; a rule takes tags ≤ 60 chars. */
export function tagOptions(trades: PreviewTrade[]): Choice[] {
  const spelling = new Map<string, string>();
  const top = byCount<string>(trades, (t) => t.ptags?.filter((p) => p.trim().length <= MAX_TAG_LEN).map((p) => {
    const k = p.trim().toLowerCase();
    if (!spelling.has(k)) spelling.set(k, p.trim());
    return k;
  }).filter(Boolean), 20);
  return top.map(([k]) => ({ value: spelling.get(k) ?? k, label: spelling.get(k) ?? k }));
}

export const EXCLUDE_FIELDS: FieldDef[] = [
  {
    id: "time", get label() { return wt("builder.field.time"); }, ops: [{ id: "before", get label() { return wt("builder.op.before"); } }, { id: "after", get label() { return wt("builder.op.after"); } }], input: "time", defaultValue: "09:45", requires: "timeWindow",
    build: (op, v) => (HM.test(v) ? (op === "before" ? { type: "timeWindow", from: v, to: null } : { type: "timeWindow", from: null, to: v }) : null),
  },
  {
    id: "ticker", get label() { return wt("builder.field.ticker"); }, ops: [{ id: "in", get label() { return wt("builder.op.in"); } }], input: "tickers", placeholder: "AMD, TSLA", defaultValue: "", requires: "excludeTickers",
    build: (_op, v) => {
      const tickers = [...new Set(v.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9.\-]{1,16}$/.test(t)))];
      return tickers.length ? { type: "excludeTickers", tickers } : null;
    },
  },
  {
    id: "hold", get label() { return wt("builder.field.hold"); }, ops: [{ id: "lt", get label() { return wt("builder.op.shorter"); } }], input: "number", get unit() { return wt("builder.unit.min"); }, defaultValue: "2", requires: "minHold",
    build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "minHold", seconds: Math.round(n * 60) } : null; },
  },
  {
    id: "price", get label() { return wt("builder.field.price"); }, ops: [{ id: "lt", get label() { return wt("builder.op.cheaper"); } }, { id: "gt", get label() { return wt("builder.op.pricier"); } }], input: "number", unit: "$", defaultValue: "5", requires: "priceRange",
    build: (op, v) => { const n = num(v); return n && n > 0 ? (op === "lt" ? { type: "priceRange", min: n, max: null } : { type: "priceRange", min: null, max: n }) : null; },
  },
  {
    id: "size", get label() { return wt("builder.field.size"); }, ops: [{ id: "lt", get label() { return wt("builder.op.less"); } }, { id: "gt", get label() { return wt("builder.op.more"); } }], input: "number", get unit() { return wt("builder.unit.shares"); }, defaultValue: "100", requires: "sizeRange",
    build: (op, v) => { const n = num(v); return n && n > 0 ? (op === "lt" ? { type: "sizeRange", min: Math.round(n), max: null } : { type: "sizeRange", min: null, max: Math.round(n) }) : null; },
  },
  {
    id: "side", get label() { return wt("builder.field.side"); }, ops: [{ id: "long", get label() { return wt("builder.op.long"); } }, { id: "short", get label() { return wt("builder.op.short"); } }], input: "none", defaultValue: "", requires: "excludeSide",
    build: (op) => ({ type: "excludeSide", side: op === "short" ? "short" : "long" }),
  },
  {
    id: "afterLoss", get label() { return wt("builder.field.afterLoss"); }, ops: [{ id: "within", get label() { return wt("builder.op.within"); } }], input: "number", get unit() { return wt("builder.unit.min"); }, defaultValue: "5", requires: "afterLoss",
    build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "afterLoss", minutes: n } : null; },
  },
  {
    id: "imx", get label() { return wt("builder.field.imx"); }, ops: [isOp], input: "none", defaultValue: "", requires: "excludeImx",
    visible: (trades) => trades.some((t) => t.imx === true),
    build: () => ({ type: "excludeImx" }),
  },
  {
    id: "reentry", get label() { return wt("builder.field.reentry"); }, ops: [isOp], input: "none", defaultValue: "", requires: "noReentry",
    visible: (trades) => trades.some((t) => t.reentry === true),
    build: () => ({ type: "noReentry" }),
  },
  {
    // Only where stops are recorded on a real share of the trades (else «no stop recorded» is just «not marked»).
    id: "noStop", get label() { return wt("builder.field.noStop"); }, ops: [isOp], input: "none", defaultValue: "", requires: "requireStop",
    visible: stopsRecorded,
    build: () => ({ type: "requireStop" }),
  },
  {
    id: "mistake", get label() { return wt("builder.field.mistake"); }, ops: [], input: "choice", defaultValue: "", requires: "excludeMistakes",
    options: mistakeOptions,
    build: (_op, v) => (isErrorCode(v) ? { type: "excludeMistakes", codes: [v] } : null),
  },
  {
    // Personal tags are each trader's own words: not offered for the whole team.
    id: "tag", get label() { return wt("builder.field.tag"); }, ops: [], input: "choice", defaultValue: "", requires: "excludeTags",
    visible: (_trades, ctx) => !ctx.team,
    options: tagOptions,
    build: (_op, v) => (v.trim() ? { type: "excludeTags", tags: [v.trim()] } : null),
  },
];

export const STOP_FIELDS: FieldDef[] = [
  {
    id: "dayLoss", get label() { return wt("builder.field.dayLoss"); }, ops: [], input: "number", unit: "$", defaultValue: "200", requires: "dailyLossLimit",
    build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "dailyLossLimit", usd: n } : null; },
  },
  {
    id: "profitTarget", get label() { return wt("builder.field.profitTarget"); }, ops: [], input: "number", unit: "$", defaultValue: "300", requires: "dailyProfitTarget",
    build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "dailyProfitTarget", usd: n } : null; },
  },
  {
    id: "lossRun", get label() { return wt("builder.field.lossRun"); }, ops: [], input: "number", get unit() { return wt("builder.unit.pcs"); }, defaultValue: "3", requires: "stopAfterLosses",
    build: (_op, v) => { const n = num(v); return n && n >= 1 ? { type: "stopAfterLosses", n: Math.round(n) } : null; },
  },
  {
    id: "maxTrades", get label() { return wt("builder.field.maxTrades"); }, ops: [], input: "number", get unit() { return wt("builder.unit.pcs"); }, defaultValue: "10", requires: "maxTradesPerDay",
    build: (_op, v) => { const n = num(v); return n && n >= 1 ? { type: "maxTradesPerDay", n: Math.round(n) } : null; },
  },
];

export const CAP_FIELD: FieldDef = {
  id: "cap", get label() { return wt("builder.field.cap"); }, ops: [], input: "number", unit: "$", defaultValue: "50", requires: "capLoss",
  build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "capLoss", usd: n } : null; },
};

export const CAP_FIELDS: FieldDef[] = [
  CAP_FIELD,
  {
    id: "sizeRel", get label() { return wt("builder.field.sizeRel"); }, ops: [], input: "number", get unit() { return wt("builder.unit.timesUsual"); }, defaultValue: "2", min: 1, max: 5, step: 0.5, requires: "maxSizeRel",
    visible: (trades) => trades.some((t) => t.sizeRel != null),
    build: (_op, v) => { const n = num(v); return n != null && n >= 1 && n <= 5 ? { type: "maxSizeRel", x: n } : null; },
  },
];

/** The fields of a mode offered for these trades (falls back to the loss cap, which every API build supports). */
export function fieldsFor(mode: Mode, trades: PreviewTrade[], supported: ReadonlySet<RuleType>, team: boolean): FieldDef[] {
  const all = mode === "exclude" ? EXCLUDE_FIELDS : mode === "stop" ? STOP_FIELDS : CAP_FIELDS;
  const listed = all.filter((f) => supported.has(f.requires) && (f.visible?.(trades, { team }) ?? true) && (!f.options || f.options(trades).length > 0));
  return listed.length ? listed : [CAP_FIELD];
}
