/**
 * «Ограждения»: a small meter in the header from the trader's own risk-desk data (GET /api/risk/me — the same query
 * the dashboard uses, so it is usually already cached). Two modes, both existing data only, no new limits:
 *   streak — losing days in a row (risk metrics `drawdown.redDayStreak`), five segments;
 *   daily  — today's loss against the daily loss limit the curator set (`limits.dailyLossLimit`).
 * Colour: «Вид» → Деньги → meter colour (--guard, ≥ 3:1), red once the limit is used up or trading is halted.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { riskMeQuery } from "@/lib/api/queries";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import type { GuardMode } from "@/lib/appearance/model";
import { appearanceI18n } from "@/i18n/ns/appearance";

/** The fields of /api/risk/me this meter reads (the full type lives in components/risk). */
type RiskMeLite = {
  trader: string;
  halted: boolean;
  stop: { label: string; message: string };
  limits: { dailyLossLimit: number | null } | null;
  today: { pnlNet: number | null };
  drawdown: { redDayStreak: number };
};

const SEGMENTS = 5;

export type GuardState =
  | { kind: "streak"; count: number; text: string; breach: boolean }
  | { kind: "daily"; used: number; limit: number; share: number; text: string; breach: boolean }
  | { kind: "nolimit" }
  | { kind: "none" };

export function useGuardState(mode: GuardMode): GuardState {
  const { t } = appearanceI18n.useT();
  const q = useQuery({ ...riskMeQuery<RiskMeLite>(), enabled: mode !== "off", retry: false });
  const r = q.data;
  if (mode === "off" || !r) return { kind: "none" };
  if (mode === "streak") {
    const count = Math.max(0, r.drawdown?.redDayStreak ?? 0);
    return { kind: "streak", count, text: t("meter.streak", { count }), breach: r.halted };
  }
  const limit = r.limits?.dailyLossLimit ?? null;
  if (limit == null || limit <= 0) return { kind: "nolimit" };
  const used = Math.max(0, -(r.today?.pnlNet ?? 0));
  const share = Math.min(1, used / limit);
  const text = r.halted
    ? t("meter.halted", { label: r.stop.label })
    : t("meter.daily", { used: fmtUsd(used, { decimals: 0 }), limit: fmtUsd(limit, { decimals: 0 }) });
  return { kind: "daily", used, limit, share, text, breach: r.halted || share >= 1 };
}

/** The meter itself (header and the «Вид» preview). Renders nothing without data. */
export function GuardMeterView({ state, className }: { state: GuardState; className?: string }) {
  if (state.kind !== "streak" && state.kind !== "daily") return null;
  const fill = state.breach ? "bg-down" : "bg-guard";
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {state.kind === "streak" ? (
        <span className="flex items-center gap-[3px]" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} className={cn("h-3 w-1.5 rounded-full", i < state.count ? fill : "bg-foreground/15")} />
          ))}
        </span>
      ) : (
        <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-foreground/15" aria-hidden="true">
          <span className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${Math.round(state.share * 100)}%` }} />
        </span>
      )}
      <span className="text-xs font-medium tabular-nums text-foreground">
        {state.kind === "streak" ? state.count : `${Math.round(state.share * 100)}%`}
      </span>
    </span>
  );
}

/** Header chip: links to the risk desk, the full sentence in the accessible name and tooltip. */
export function GuardMeter({ mode, className }: { mode: GuardMode; className?: string }) {
  const { t } = appearanceI18n.useT();
  const state = useGuardState(mode);
  if (state.kind !== "streak" && state.kind !== "daily") return null;
  return (
    <Link
      href={links.risk()}
      aria-label={`${state.text}. ${t("meter.open")}`}
      title={state.text}
      className={cn("chip inline-flex h-10 shrink-0 items-center px-3 focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <GuardMeterView state={state} />
    </Link>
  );
}
