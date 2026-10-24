/**
 * «Вид» → Детали → «Ещё настройки», money part: each win / loss / break-even colour, the break-even range (display
 * only) and the header guardrails. The presets up front live in tab-details.tsx.
 */
import * as React from "react";
import { RotateCcw } from "lucide-react";
import { useAppearance } from "@/contexts/appearance-context";
import { Segmented } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { BE_RANGE_MAX, GUARD_MODES, type Appearance } from "@/lib/appearance/model";
import { classifyPnl } from "@/lib/appearance/be-range";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { CustomSwatch, GuardNote, Section, Swatch, SwatchGroup } from "./bits";
import { GuardMeterView, useGuardState } from "./guard-meter";

type MoneyKey = "win" | "loss" | "be";
const PRESETS: Record<MoneyKey, readonly string[]> = {
  win: ["#22c55e", "#10b981", "#14b8a6", "#3b82f6"],
  loss: ["#ef4444", "#f43f5e", "#f97316", "#a855f7"],
  be: ["#f59e0b", "#eab308", "#94a3b8", "#06b6d4"],
};
const TOKEN: Record<MoneyKey, string> = { win: "--up", loss: "--down", be: "--be" };
const SAMPLE: Record<MoneyKey, number> = { win: 1240, loss: -860, be: 0 };
const BE_QUICK = [0, 1, 5, 10, 25] as const;
const GUARD_PRESETS = ["#f59e0b", "#3b82f6", "#a855f7", "#14b8a6"] as const;

function MoneyRow({ k }: { k: MoneyKey }) {
  const { t } = appearanceI18n.useT();
  const { appearance, update, computed } = useAppearance();
  const value = appearance.money[k];
  const set = (hex: string | null) => update((a) => ({ ...a, money: { ...a.money, [k]: hex } }));
  const custom = value && !PRESETS[k].includes(value) ? value : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 shrink-0 text-sm font-medium text-foreground">{t(`money.${k}`)}</span>
        <span className={cn("min-w-20 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums", k === "win" ? "bg-up/12 text-up" : k === "loss" ? "bg-down/12 text-down" : "bg-be/15 text-be")}>
          {fmtUsd(SAMPLE[k], { signed: true, decimals: 0 })}
        </span>
        <SwatchGroup label={t(`money.${k}`)}>
          <Swatch color={`hsl(var(${TOKEN[k]}))`} label={t("money.byDefault")} selected={value == null} onSelect={() => set(null)}>
            {value != null && <RotateCcw className="h-3.5 w-3.5 text-background mix-blend-difference" aria-hidden="true" />}
          </Swatch>
          {PRESETS[k].map((hex) => <Swatch key={hex} color={hex} label={hex} selected={value === hex} onSelect={() => set(hex)} />)}
          <CustomSwatch value={custom} selected={!!custom} label={t("colors.customAria", { name: t(`money.${k}`) })} onPick={set} />
        </SwatchGroup>
      </div>
      <GuardNote result={computed.report[k]} />
    </div>
  );
}

function BeRangeSection() {
  const { t } = appearanceI18n.useT();
  const { appearance, update } = useAppearance();
  const range = appearance.money.beRange;
  const [draft, setDraft] = React.useState(String(range || ""));
  React.useEffect(() => { setDraft(range ? String(range) : ""); }, [range]);
  const commit = (v: number) => update((a) => ({ ...a, money: { ...a.money, beRange: Math.min(BE_RANGE_MAX, Math.max(0, Math.round(v * 100) / 100)) } }));
  const amount = fmtUsd(range || 0, { decimals: "trim" });
  const samples = [3.2, -4.1, 12.5, -0.6];
  return (
    <Section title={t("money.beRange")} hint={t("money.beRangeHint", { amount })}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-28">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">±$</span>
          <Input
            inputMode="decimal"
            aria-label={t("money.beRangeAria")}
            value={draft}
            placeholder="0"
            onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ""))}
            onBlur={() => commit(Number(draft.replace(",", ".")) || 0)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(Number(draft.replace(",", ".")) || 0); }}
            className="pl-8 tabular-nums"
          />
        </div>
        <Segmented
          ariaLabel={t("money.beRange")}
          size="sm"
          value={BE_QUICK.includes(range as (typeof BE_QUICK)[number]) ? String(range) : ""}
          onChange={(v) => commit(Number(v))}
          options={BE_QUICK.map((v) => ({ value: String(v), label: v === 0 ? t("money.beOff") : `±$${v}` }))}
        />
      </div>
      {range > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("money.beExample", { amount })}</span>
          {samples.map((v) => {
            const c = classifyPnl(v, range);
            return (
              <span key={v} className={cn("rounded-full px-2 py-0.5 font-semibold tabular-nums", c === "be" ? "bg-be/15 text-be" : c === "win" ? "bg-up/12 text-up" : "bg-down/12 text-down")}>
                {fmtUsd(v, { signed: true })} · {c === "be" ? "BE" : c === "win" ? "WIN" : "LOSS"}
              </span>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function GuardSection() {
  const { t } = appearanceI18n.useT();
  const { appearance, update, computed } = useAppearance();
  const g = appearance.guard;
  const state = useGuardState(g.mode);
  const setGuard = (patch: Partial<Appearance["guard"]>) => update((a) => ({ ...a, guard: { ...a.guard, ...patch } }));
  const custom = g.color && !GUARD_PRESETS.includes(g.color as (typeof GUARD_PRESETS)[number]) ? g.color : null;
  return (
    <Section title={t("money.guard")} hint={t("money.guardHint")}>
      <Segmented
        ariaLabel={t("money.guard")}
        className="self-start"
        value={g.mode}
        onChange={(mode) => setGuard({ mode })}
        options={GUARD_MODES.map((m) => ({ value: m, label: t(`money.guardModes.${m}`) }))}
      />
      {g.mode !== "off" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-foreground">{t("money.guardColor")}</span>
            <SwatchGroup label={t("money.guardColor")}>
              <Swatch color="hsl(var(--warn))" label={t("money.byDefault")} selected={!g.color} onSelect={() => setGuard({ color: null })} />
              {GUARD_PRESETS.map((hex) => <Swatch key={hex} color={hex} label={hex} selected={g.color === hex} onSelect={() => setGuard({ color: hex })} />)}
              <CustomSwatch value={custom} selected={!!custom} label={t("colors.customAria", { name: t("money.guardColor") })} onPick={(hex) => setGuard({ color: hex })} />
            </SwatchGroup>
          </div>
          <GuardNote result={computed.report.guard} />
          {state.kind === "nolimit" ? (
            <p className="text-xs text-muted-foreground">{t("money.guardNoLimit")}</p>
          ) : state.kind !== "none" ? (
            <div className="tile flex flex-wrap items-center gap-3 px-3 py-2">
              <GuardMeterView state={state} />
              <span className="text-xs text-muted-foreground">{state.text}</span>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

export function MoneyAdvanced() {
  const { t } = appearanceI18n.useT();
  return (
    <>
      <Section title={t("money.colors")} hint={t("money.colorsHint")}>
        <div className="flex flex-col gap-3">
          <MoneyRow k="win" />
          <MoneyRow k="loss" />
          <MoneyRow k="be" />
        </div>
      </Section>
      <BeRangeSection />
      <GuardSection />
    </>
  );
}
