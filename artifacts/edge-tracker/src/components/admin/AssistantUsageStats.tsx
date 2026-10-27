/**
 * Admin → desk settings → the assistant group: desk-wide usage of the last 14 days (GET /api/ai/assistant/usage-stats,
 * settings.manage): people, requests, cost, budget units and the cache hit ratio (cache reads / all input tokens — how
 * much of the prompt the cache served), per day and per model. A technical view: model names are shown here only.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { fmtCount, fmtDate, fmtUsd } from "@/lib/format";
import { deskSettingsI18n } from "@/i18n/ns/deskSettings";
import { cn } from "@/lib/utils";

type Totals = { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; units: number; cacheHitRatio: number | null };
type Stats = { from: string; to: string; users: number; total: Totals; days: (Totals & { day: string })[]; byModel: (Totals & { model: string })[] };

const DAYS = 14;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl px-3 py-2 ring-1 ring-[var(--glass-border)]" title={hint}>
      <div className="micro-label truncate">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function AssistantUsageStats() {
  const { t } = deskSettingsI18n.useT();
  const q = useQuery({
    queryKey: ["assistant", "usage-stats", DAYS],
    queryFn: () => http.get<Stats>("/api/ai/assistant/usage-stats", { query: { days: DAYS } }),
    staleTime: STALE.short,
  });
  const s = q.data;
  return (
    <section className="space-y-3 py-4" aria-label={t("assistantUsage.title", { days: DAYS })} data-testid="assistant-usage-stats">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{t("assistantUsage.title", { days: DAYS })}</h4>
        <p className="text-xs text-muted-foreground">{t("assistantUsage.hint")}</p>
      </div>
      {q.isError ? <p className="text-xs text-down">{t("assistantUsage.loadFailed")}</p> : null}
      {s && !s.total.requests ? <p className="text-xs text-muted-foreground">{t("assistantUsage.empty")}</p> : null}
      {s && s.total.requests ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label={t("assistantUsage.users")} value={fmtCount(s.users)} />
            <Stat label={t("assistantUsage.turns")} value={fmtCount(s.total.requests)} />
            <Stat label={t("assistantUsage.cost")} value={fmtUsd(s.total.costUsd, { decimals: 2 })} />
            <Stat label={t("assistantUsage.units")} value={fmtCount(Math.round(s.total.units))} />
            <Stat label={t("assistantUsage.cacheHit")} value={pct(s.total.cacheHitRatio)} hint={t("assistantUsage.cacheHitHint")} />
          </div>
          <p className="text-2xs text-muted-foreground tabular-nums">
            {t("assistantUsage.tokens", { input: fmtCount(s.total.input), read: fmtCount(s.total.cacheRead), write: fmtCount(s.total.cacheWrite), output: fmtCount(s.total.output) })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3 font-medium">{t("assistantUsage.day")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("assistantUsage.turns")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("assistantUsage.units")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("assistantUsage.cost")}</th>
                  <th className="py-1 text-right font-medium" title={t("assistantUsage.cacheHitHint")}>{t("assistantUsage.cacheHit")}</th>
                </tr>
              </thead>
              <tbody>
                {[...s.days].reverse().map((d) => (
                  <tr key={d.day} className="border-t border-border/50">
                    <td className="py-1 pr-3">{fmtDate(d.day, "short")}</td>
                    <td className="py-1 pr-3 text-right">{fmtCount(d.requests)}</td>
                    <td className="py-1 pr-3 text-right">{fmtCount(Math.round(d.units))}</td>
                    <td className="py-1 pr-3 text-right">{fmtUsd(d.costUsd, { decimals: 3 })}</td>
                    <td className={cn("py-1 text-right", (d.cacheHitRatio ?? 0) >= 0.5 && "text-up")}>{pct(d.cacheHitRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            <div className="micro-label">{t("assistantUsage.byModel")}</div>
            <ul className="space-y-0.5 text-2xs text-muted-foreground tabular-nums">
              {s.byModel.map((m) => (
                <li key={m.model}>
                  <span className="font-medium text-foreground">{m.model}</span>{" · "}
                  {fmtUsd(m.costUsd, { decimals: 3 })}{" · "}{fmtCount(Math.round(m.units))} {t("assistantUsage.units").toLowerCase()}{" · "}{t("assistantUsage.cacheHit")} {pct(m.cacheHitRatio)}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
