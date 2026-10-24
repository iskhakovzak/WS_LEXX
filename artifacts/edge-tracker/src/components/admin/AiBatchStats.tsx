/**
 * Admin → desk settings → «Overnight AI reviews»: the recent Message Batches (GET /api/ai/batches, settings.manage) —
 * status, stored / submitted reviews, tokens, budget units and the cost at the batch price (−50%), plus tonight's use
 * of the desk's nightly cap. A technical view: model names are shown here only.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { fmtCount, fmtDate, fmtUsd } from "@/lib/format";
import { Pill, type Tone } from "@/components/ds";
import { deskSettingsI18n } from "@/i18n/ns/deskSettings";

type Status = "submitting" | "in_progress" | "ended" | "failed" | "expired" | "canceled";
type Batch = {
  id: number; night: string; status: Status; model: string; advisor: string | null; kinds: string[];
  requests: number; succeeded: number; invalid: number; errored: number; expired: number; canceled: number; skippedBudget: number;
  estUnits: number; units: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; costUsd: number;
  error: string | null; createdAt: string; endedAt: string | null;
};
type View = { configured: boolean; enabled: boolean; model: string; tonight: { night: string; usedUnits: number; capUnits: number }; batches: Batch[] };

const TONE: Record<Status, Tone> = { submitting: "neutral", in_progress: "accent", ended: "up", failed: "down", expired: "warn", canceled: "neutral" };
const open = (s: Status) => s === "submitting" || s === "in_progress";

export function AiBatchStats() {
  const { t } = deskSettingsI18n.useT();
  const q = useQuery({
    queryKey: ["ai", "batches"],
    queryFn: () => http.get<View>("/api/ai/batches", { query: { limit: 20 } }),
    staleTime: STALE.short,
  });
  const v = q.data;
  return (
    <section className="space-y-3 py-4" aria-label={t("aiBatchStats.title")} data-testid="ai-batch-stats">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{t("aiBatchStats.title")}</h4>
        <p className="text-xs text-muted-foreground">{t("aiBatchStats.hint")}</p>
      </div>
      {q.isError ? <p className="text-xs text-down">{t("aiBatchStats.loadFailed")}</p> : null}
      {v ? (
        <>
          <p className="text-xs tabular-nums text-foreground">
            {t("aiBatchStats.tonight", { night: fmtDate(v.tonight.night, "short"), used: fmtCount(Math.round(v.tonight.usedUnits)), cap: fmtCount(v.tonight.capUnits) })}
          </p>
          {!v.configured ? <p className="text-xs text-muted-foreground">{t("aiBatchStats.noKey")}</p> : !v.enabled ? <p className="text-xs text-muted-foreground">{t("aiBatchStats.off")}</p> : null}
          {!v.batches.length ? <p className="text-xs text-muted-foreground">{t("aiBatchStats.empty")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-xs tabular-nums">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-medium">{t("aiBatchStats.night")}</th>
                    <th className="py-1 pr-3 font-medium">{t("aiBatchStats.state")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("aiBatchStats.reviews")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("aiBatchStats.tokens")}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t("aiBatchStats.units")}</th>
                    <th className="py-1 text-right font-medium">{t("aiBatchStats.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.batches.map((b) => {
                    const tokens = b.tokens.input + b.tokens.output + b.tokens.cacheRead + b.tokens.cacheWrite;
                    const hint = t("aiBatchStats.countsHint", { ok: b.succeeded, n: b.requests, invalid: b.invalid, errored: b.errored, expired: b.expired, skipped: b.skippedBudget });
                    return (
                      <tr key={b.id} className="border-t border-border/50 align-top">
                        <td className="py-1.5 pr-3">
                          <div className="font-medium text-foreground">{fmtDate(b.night, "short")}</div>
                          <div className="text-2xs text-muted-foreground">
                            {b.kinds.map((k) => deskSettingsI18n.tryT(`aiBatchStats.kinds.${k}`) ?? k).join(" · ")} · {b.model}{b.advisor ? ` + ${b.advisor}` : ""}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3">
                          <Pill tone={TONE[b.status] ?? "neutral"} dot>{deskSettingsI18n.tryT(`aiBatchStats.status.${b.status}`) ?? b.status}</Pill>
                          {b.error ? <div className="mt-0.5 max-w-[14rem] truncate text-2xs text-muted-foreground" title={b.error}>{b.error}</div> : null}
                        </td>
                        <td className="py-1.5 pr-3 text-right" title={hint}>{t("aiBatchStats.counts", { ok: b.succeeded, n: b.requests })}</td>
                        <td className="py-1.5 pr-3 text-right">{tokens ? fmtCount(tokens) : "—"}</td>
                        <td className="py-1.5 pr-3 text-right" title={open(b.status) ? t("aiBatchStats.estimateHint") : undefined}>
                          {open(b.status) ? t("aiBatchStats.estimate", { units: fmtCount(b.estUnits) }) : fmtCount(b.units)}
                        </td>
                        <td className="py-1.5 text-right">
                          <div>{b.costUsd ? fmtUsd(b.costUsd, { decimals: 3 }) : "—"}</div>
                          {b.costUsd ? <div className="text-2xs text-muted-foreground">{t("aiBatchStats.fullPrice", { usd: fmtUsd(b.costUsd * 2, { decimals: 3 }) })}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
