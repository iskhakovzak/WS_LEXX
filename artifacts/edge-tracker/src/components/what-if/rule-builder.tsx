import { useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { Preset } from "./api";
import { type PreviewTrade, type Rule, type RuleType, chipLabel, isApplied, previewRule } from "./rules";
import { type Mode, fieldsFor } from "./builder-fields";

/**
 * «Свой сценарий»: a sentence-like form instead of a wall of switches —
 * «Исключить сделки, где [время входа] [раньше] [09:45]» → live count of the trades it touches → «Добавить».
 * The fields (builder-fields.ts) the running API does not support (`supported`), the trades cannot answer or — for a
 * choice — have nothing to choose from are hidden.
 */

export function RuleBuilder({
  trades,
  supported,
  rules,
  presets,
  team = false,
  onAdd,
  onApplyPreset,
}: {
  trades: PreviewTrade[];
  supported: ReadonlySet<RuleType>;
  rules: Rule[];
  presets: Preset[];
  /** The whole team: personal tags are not offered. */
  team?: boolean;
  onAdd: (r: Rule) => void;
  onApplyPreset: (p: Preset) => void;
}) {
  const { t } = whatIfI18n.useT();
  const [mode, setMode] = useState<Mode>("exclude");
  const fields = useMemo(() => fieldsFor(mode, trades, supported, team), [mode, trades, supported, team]);

  const [fieldId, setFieldId] = useState<Record<Mode, string>>({ exclude: "time", stop: "dayLoss", cap: "cap" });
  const field = fields.find((f) => f.id === fieldId[mode]) ?? fields[0];
  const choices = useMemo(() => field.options?.(trades) ?? [], [field, trades]);
  const [ops, setOps] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const op = ops[field.id] ?? field.ops[0]?.id ?? "";
  const picked = values[field.id];
  // A choice starts on the most frequent value (and falls back to it when the trades no longer have the picked one).
  const value = field.input === "choice" ? choices.find((c) => c.value === picked)?.value ?? choices[0]?.value ?? "" : picked ?? field.defaultValue;

  const draft = useMemo(() => field.build(op, value), [field, op, value]);
  const preview = useMemo(() => (draft ? previewRule(trades, draft) : null), [draft, trades]);
  const already = draft ? isApplied(rules, draft) : false;

  const topTickers = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades) m.set(t.ticker, (m.get(t.ticker) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  }, [trades]);

  const setValue = (v: string) => setValues((s) => ({ ...s, [field.id]: v }));
  const lead = t(`builder.lead.${mode}`);
  const usablePresets = presets.filter((p) => p.rules.length && p.rules.every((r) => supported.has(r.type)));

  return (
    <div className="flex flex-col gap-3">
      <Segmented<Mode>
        ariaLabel={t("builder.modeAria")}
        size="sm"
        className="self-start"
        value={mode}
        onChange={setMode}
        options={[
          { value: "exclude", label: t("builder.mode.exclude") },
          { value: "stop", label: t("builder.mode.stop") },
          { value: "cap", label: t("builder.mode.cap") },
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
            <SelectTrigger className="h-9 w-auto min-w-[12rem] rounded-full" aria-label={t("builder.fieldAria")}>
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
            ariaLabel={t("builder.opAria")}
            size="sm"
            value={op}
            onChange={(v) => setOps((s) => ({ ...s, [field.id]: v }))}
            options={field.ops.map((o) => ({ value: o.id, label: o.label }))}
          />
        ) : field.ops.length === 1 ? (
          <span className="text-muted-foreground">{field.ops[0].label}</span>
        ) : null}
        {field.input === "time" && (
          <Input type="time" step={60} value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-[7.5rem] rounded-full tabular-nums" aria-label={t("builder.timeAria")} />
        )}
        {field.input === "number" && (
          <span className="inline-flex items-center gap-1.5">
            {field.unit === "$" && <span className="text-muted-foreground">$</span>}
            <Input type="number" inputMode="decimal" min={field.min ?? 0} max={field.max} step={field.step ?? "any"} value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-24 rounded-full tabular-nums" aria-label={field.label} />
            {field.unit && field.unit !== "$" && <span className="text-muted-foreground">{field.unit}</span>}
          </span>
        )}
        {field.input === "tickers" && (
          <Input value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} placeholder={field.placeholder} className="h-9 w-48 rounded-full uppercase" aria-label={t("builder.tickersAria")} />
        )}
        {field.input === "choice" && (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger className="h-9 w-auto min-w-[10rem] max-w-[16rem] rounded-full" aria-label={t("builder.choiceAria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {field.input === "time" && <span className="text-xs text-muted-foreground">ET</span>}
        <Button type="submit" size="sm" className="ml-auto rounded-full bg-primary-solid" disabled={!draft || already || (preview != null && preview.affected === 0)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {already ? t("builder.already") : t("builder.add")}
        </Button>
      </form>

      {field.input === "tickers" && topTickers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("builder.frequent")}</span>
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
          <span className="text-xs text-muted-foreground">{t("builder.presets")}</span>
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
  const { t } = whatIfI18n.useT();
  if (!draft) return <p className="min-h-5 text-xs text-muted-foreground">{t("builder.fill")}</p>;
  if (!preview) return <p className="min-h-5" />;
  if (preview.affected === 0) return <p className="min-h-5 text-xs text-muted-foreground">{t("builder.none")}</p>;
  const share = preview.total ? Math.round((preview.affected / preview.total) * 100) : 0;
  const params = { trades: "\u0000", total: preview.total, share };
  const [before, after] = (mode === "cap" ? t("builder.previewChange", params) : t("builder.previewTouch", params)).split("\u0000");
  return (
    <p className="min-h-5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
      {before}<span className="font-semibold text-foreground">{commonI18n.t("units.trades", { count: preview.affected })}</span>{after}
      {mode === "exclude" || mode === "stop" ? <> {t("builder.previewNet")} <span className={cn("font-medium", preview.net < 0 ? "text-down" : preview.net > 0 ? "text-up" : "")}>{fmtUsd(preview.net, { signed: true, decimals: "auto" })}</span></> : null}
      {" "}{t("builder.previewTotal")}{" "}
      <span className={cn("font-semibold", preview.effect > 0 ? "text-up" : preview.effect < 0 ? "text-down" : "text-foreground")}>{fmtUsd(preview.effect, { signed: true, decimals: "auto" })}</span>
    </p>
  );
}
