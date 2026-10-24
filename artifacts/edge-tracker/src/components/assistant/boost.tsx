/**
 * The power-up controls of the panel — no model names anywhere:
 *   BoostSwitch      «⚡ ×5»: the next answer uses the stronger model and costs about ×5 of today's budget
 *   BudgetMeter      «72% left today» (one shared daily budget; the bar shrinks as it is spent)
 *   BudgetExhausted  the friendly end-of-day note when the budget is used up
 *   TierMark         the tiny ⚡ on an answer: boost («×5») or deep analysis (the advisor / the stronger model)
 */
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/assistant/model";
import { BoltMark } from "@/components/shared/ws-mark";

export function BoostSwitch({ on, onChange, multiplier, disabled }: { on: boolean; onChange: (v: boolean) => void; multiplier: number; disabled?: boolean }) {
  const { t } = assistantI18n.useT();
  const x = Math.max(1, Math.round(multiplier));
  return (
    <button
      type="button"
      className="ws-boost disabled:opacity-50"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={t("boost.hint", { x })}
      aria-label={t("boost.aria", { x })}
      data-testid="assistant-boost"
    >
      <BoltMark className="ws-boost-bolt h-3.5 w-3.5" />
      <span>{t("boost.label")}</span>
      <span className="ws-boost-x">×{x}</span>
    </button>
  );
}

export function BudgetMeter({ pct }: { pct: number | null }) {
  const { t } = assistantI18n.useT();
  if (pct == null) return null;
  const tone = pct <= 10 ? "bg-down" : pct <= 30 ? "bg-[hsl(var(--chart-3))]" : "bg-foreground/70";
  return (
    <span className="inline-flex items-center gap-2 text-2xs text-muted-foreground tabular-nums" title={t("budget.hint")} data-testid="assistant-budget">
      <span className="relative inline-block h-1.5 w-14 overflow-hidden rounded-full bg-muted-foreground/20" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--dur-3)] motion-reduce:transition-none", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("budget.aria")}>{t("budget.left", { pct })}</span>
    </span>
  );
}

export function BudgetExhausted() {
  const { t } = assistantI18n.useT();
  return (
    <div role="status" className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{t("budget.exhaustedTitle")}</p>
      <p className="mt-0.5">{t("budget.exhaustedBody")}</p>
    </div>
  );
}

export function TierMark({ tier }: { tier: Tier | null }) {
  const { t } = assistantI18n.useT();
  if (tier !== "boost" && tier !== "deep") return null;
  const label = tier === "boost" ? t("tier.boost") : t("tier.deep");
  return (
    <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-muted-foreground" title={label} aria-label={label}>
      <BoltMark className={cn("h-3 w-3", tier === "boost" ? "text-foreground" : "text-muted-foreground")} />
    </span>
  );
}
