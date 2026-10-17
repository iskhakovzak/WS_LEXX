import { useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtUsd, sdeal } from "@/components/analytics-page/metrics";
import { cn } from "@/lib/utils";
import type { Preset } from "./api";
import { type PreviewTrade, type Rule, type RuleType, chipLabel, isApplied, previewRule } from "./rules";

/**
 * «Свой сценарий»: a sentence-like form instead of a wall of switches —
 * «Исключить сделки, где [время входа] [раньше] [09:45]» → live count of the trades it touches → «Добавить».
 * Fields whose rule the running API does not support yet (`supported`) are hidden.
 */

type Mode = "exclude" | "stop" | "cap";
type Op = { id: string; label: string };
type FieldDef = {
  id: string;
  label: string;
  ops: Op[];
  input: "time" | "tickers" | "number" | "none";
  unit?: string;
  placeholder?: string;
  defaultValue: string;
  requires: RuleType;
  build: (op: string, value: string) => Rule | null;
};

const num = (v: string): number | null => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && v.trim() !== "" ? n : null;
};
const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;

const EXCLUDE_FIELDS: FieldDef[] = [
  {
    id: "time", label: "время входа", ops: [{ id: "before", label: "раньше" }, { id: "after", label: "позже" }], input: "time", defaultValue: "09:45", requires: "timeWindow",
    build: (op, v) => (HM.test(v) ? (op === "before" ? { type: "timeWindow", from: v, to: null } : { type: "timeWindow", from: null, to: v }) : null),
  },
  {
    id: "ticker", label: "тикер", ops: [{ id: "in", label: "один из" }], input: "tickers", placeholder: "AMD, TSLA", defaultValue: "", requires: "excludeTickers",
    build: (_op, v) => {
      const tickers = [...new Set(v.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9.\-]{1,16}$/.test(t)))];
      return tickers.length ? { type: "excludeTickers", tickers } : null;
    },
  },
  {
    id: "hold", label: "удержание", ops: [{ id: "lt", label: "короче" }], input: "number", unit: "мин", defaultValue: "2", requires: "minHold",
    build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "minHold", seconds: Math.round(n * 60) } : null; },
  },
  {
    id: "price", label: "цена акции", ops: [{ id: "lt", label: "дешевле" }, { id: "gt", label: "дороже" }], input: "number", unit: "$", defaultValue: "5", requires: "priceRange",
    build: (op, v) => { const n = num(v); return n && n > 0 ? (op === "lt" ? { type: "priceRange", min: n, max: null } : { type: "priceRange", min: null, max: n }) : null; },
  },
  {
    id: "size", label: "размер позиции", ops: [{ id: "lt", label: "меньше" }, { id: "gt", label: "больше" }], input: "number", unit: "акций", defaultValue: "100", requires: "sizeRange",
    build: (op, v) => { const n = num(v); return n && n > 0 ? (op === "lt" ? { type: "sizeRange", min: Math.round(n), max: null } : { type: "sizeRange", min: null, max: Math.round(n) }) : null; },
  },
  {
    id: "side", label: "направление", ops: [{ id: "long", label: "лонг" }, { id: "short", label: "шорт" }], input: "none", defaultValue: "", requires: "excludeSide",
    build: (op) => ({ type: "excludeSide", side: op === "short" ? "short" : "long" }),
  },
  {
    id: "afterLoss", label: "вход после убыточной сделки", ops: [{ id: "within", label: "в течение" }], input: "number", unit: "мин", defaultValue: "5", requires: "afterLoss",
    build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "afterLoss", minutes: n } : null; },
  },
];

const STOP_FIELDS: FieldDef[] = [
  {
    id: "dayLoss", label: "день ушёл в минус на", ops: [], input: "number", unit: "$", defaultValue: "200", requires: "dailyLossLimit",
    build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "dailyLossLimit", usd: n } : null; },
  },
  {
    id: "lossRun", label: "убытков подряд набралось", ops: [], input: "number", unit: "шт.", defaultValue: "3", requires: "stopAfterLosses",
    build: (_op, v) => { const n = num(v); return n && n >= 1 ? { type: "stopAfterLosses", n: Math.round(n) } : null; },
  },
  {
    id: "maxTrades", label: "сделок за день сделано", ops: [], input: "number", unit: "шт.", defaultValue: "10", requires: "maxTradesPerDay",
    build: (_op, v) => { const n = num(v); return n && n >= 1 ? { type: "maxTradesPerDay", n: Math.round(n) } : null; },
  },
];

const CAP_FIELD: FieldDef = {
  id: "cap", label: "убыток одной сделки не больше", ops: [], input: "number", unit: "$", defaultValue: "50", requires: "capLoss",
  build: (_op, v) => { const n = num(v); return n && n > 0 ? { type: "capLoss", usd: n } : null; },
};

export function RuleBuilder({
  trades,
  supported,
  rules,
  presets,
  onAdd,
  onApplyPreset,
}: {
  trades: PreviewTrade[];
  supported: ReadonlySet<RuleType>;
  rules: Rule[];
  presets: Preset[];
  onAdd: (r: Rule) => void;
  onApplyPreset: (p: Preset) => void;
}) {
  const [mode, setMode] = useState<Mode>("exclude");
  const excludeFields = useMemo(() => EXCLUDE_FIELDS.filter((f) => supported.has(f.requires)), [supported]);
  const stopFields = useMemo(() => STOP_FIELDS.filter((f) => supported.has(f.requires)), [supported]);
  const listed = mode === "exclude" ? excludeFields : mode === "stop" ? stopFields : [CAP_FIELD];
  const fields = listed.length ? listed : [CAP_FIELD];

  const [fieldId, setFieldId] = useState<Record<Mode, string>>({ exclude: "time", stop: "dayLoss", cap: "cap" });
  const field = fields.find((f) => f.id === fieldId[mode]) ?? fields[0];
  const [ops, setOps] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const op = ops[field.id] ?? field.ops[0]?.id ?? "";
  const value = values[field.id] ?? field.defaultValue;

  const draft = useMemo(() => field.build(op, value), [field, op, value]);
  const preview = useMemo(() => (draft ? previewRule(trades, draft) : null), [draft, trades]);
  const already = draft ? isApplied(rules, draft) : false;

  const topTickers = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades) m.set(t.ticker, (m.get(t.ticker) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  }, [trades]);

  const setValue = (v: string) => setValues((s) => ({ ...s, [field.id]: v }));
  const lead = mode === "exclude" ? "Исключить сделки, где" : mode === "stop" ? "Заканчивать день, когда" : "Считать, что";
  const usablePresets = presets.filter((p) => p.rules.length && p.rules.every((r) => supported.has(r.type)));

  return (
    <div className="flex flex-col gap-3">
      <Segmented<Mode>
        ariaLabel="Тип правила"
        size="sm"
        className="self-start"
        value={mode}
        onChange={setMode}
        options={[
          { value: "exclude", label: "Убрать сделки" },
          { value: "stop", label: "Стоп на день" },
          { value: "cap", label: "Ограничить убыток" },
        ]}
      />

      <form
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft && !already) onAdd(draft);
        }}
      >
        <span className="font-medium text-foreground">{lead}</span>
        {fields.length > 1 ? (
          <Select value={field.id} onValueChange={(v) => setFieldId((s) => ({ ...s, [mode]: v }))}>
            <SelectTrigger className="h-9 w-auto min-w-[12rem] rounded-full" aria-label="Поле">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-foreground">{field.label}</span>
        )}
        {field.ops.length > 1 ? (
          <Segmented
            ariaLabel="Условие"
            size="sm"
            value={op}
            onChange={(v) => setOps((s) => ({ ...s, [field.id]: v }))}
            options={field.ops.map((o) => ({ value: o.id, label: o.label }))}
          />
        ) : field.ops.length === 1 ? (
          <span className="text-muted-foreground">{field.ops[0].label}</span>
        ) : null}
        {field.input === "time" && (
          <Input type="time" step={60} value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-[7.5rem] rounded-full tabular-nums" aria-label="Время (ET)" />
        )}
        {field.input === "number" && (
          <span className="inline-flex items-center gap-1.5">
            {field.unit === "$" && <span className="text-muted-foreground">$</span>}
            <Input type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-24 rounded-full tabular-nums" aria-label={field.label} />
            {field.unit && field.unit !== "$" && <span className="text-muted-foreground">{field.unit}</span>}
          </span>
        )}
        {field.input === "tickers" && (
          <Input value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} placeholder={field.placeholder} className="h-9 w-48 rounded-full uppercase" aria-label="Тикеры через запятую" />
        )}
        {field.input === "time" && <span className="text-xs text-muted-foreground">ET</span>}
        <Button type="submit" size="sm" className="ml-auto rounded-full bg-primary-solid" disabled={!draft || already || (preview != null && preview.affected === 0)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {already ? "Уже в сценарии" : "Добавить в сценарий"}
        </Button>
      </form>

      {field.input === "tickers" && topTickers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Частые:</span>
          {topTickers.map((t) => {
            const on = value.split(/[\s,;]+/).includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setValue(on ? value.split(/[\s,;]+/).filter((x) => x && x !== t).join(", ") : [value.trim().replace(/,$/, ""), t].filter(Boolean).join(", "))}
                className="chip min-h-7 px-2.5 text-xs font-medium"
              >
                {t}
              </button>
            );
          })}
        </div>
      )}

      <PreviewLine preview={preview} draft={draft} mode={mode} />

      {usablePresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--glass-border)] pt-3">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs text-muted-foreground">Готовые наборы:</span>
          {usablePresets.map((p) => (
            <button key={p.id} type="button" onClick={() => onApplyPreset(p)} className="chip min-h-7 px-2.5 text-xs font-medium" title={`${p.description}: ${p.rules.map(chipLabel).join(" · ")}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewLine({ preview, draft, mode }: { preview: ReturnType<typeof previewRule> | null; draft: Rule | null; mode: Mode }) {
  if (!draft) return <p className="min-h-5 text-xs text-muted-foreground">Заполни значение — покажем, сколько сделок это затронет.</p>;
  if (!preview) return <p className="min-h-5" />;
  if (preview.affected === 0) return <p className="min-h-5 text-xs text-muted-foreground">Ни одной сделки за период под это правило не попадает.</p>;
  const verb = mode === "cap" ? "изменит" : "затронет";
  const share = preview.total ? Math.round((preview.affected / preview.total) * 100) : 0;
  return (
    <p className="min-h-5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
      Само по себе {verb} <span className="font-semibold text-foreground">{sdeal(preview.affected)}</span> из {preview.total} ({share}%)
      {mode === "exclude" || mode === "stop" ? <> · их нетто <span className={cn("font-medium", preview.net < 0 ? "text-down" : preview.net > 0 ? "text-up" : "")}>{fmtUsd(preview.net)}</span></> : null}
      {" "}→ итог за период{" "}
      <span className={cn("font-semibold", preview.effect > 0 ? "text-up" : preview.effect < 0 ? "text-down" : "text-foreground")}>{fmtUsd(preview.effect)}</span>
    </p>
  );
}
