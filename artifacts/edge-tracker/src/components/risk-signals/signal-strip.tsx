/**
 * The trader's live risk alerts on the dashboard («Сегодня» hero, pages/dashboard.tsx). Polls GET /risk-signals/me
 * every 5 s while the page is visible in desk hours; the server raises an alert at the PropReports sync that brings
 * the fill in (or at the positions tick for the stop on open positions).
 *
 * Shows only unseen alerts — the most important one in full (critical first), the rest as a count; «Понятно» closes
 * it for good (seen_at). Semantic warn / down tone with an icon and one short line of what to do (ARCHITECTURE.md
 * §4a.3): not an ad-like strip, nothing when there is nothing to say.
 */
import { OctagonAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { useToast } from "@/hooks/use-toast";
import { fmtTimeNY, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { riskSignalsI18n } from "@/i18n/ns/riskSignals";
import { ToolHelp } from "@/components/shared/tool-help";
import { useMyAlerts, useSeenAlert } from "./api";
import { alertKey, alertVars, stripAlerts } from "./model";

const usd = (v: number) => fmtUsd(v, { decimals: 0 });

/** `trader`: whose alerts (null = the signed-in user's own). */
export function RiskSignalStrip({ trader, enabled }: { trader: string | null; enabled: boolean }) {
  const { t } = riskSignalsI18n.useT();
  const { toast } = useToast();
  const q = useMyAlerts(trader, enabled);
  const seen = useSeenAlert();
  const own = trader == null;
  const list = q.data ? stripAlerts(q.data.alerts) : [];
  const a = list[0];
  if (!a) return null;

  const vars = alertVars(a, usd);
  const key = alertKey(a);
  const critical = a.severity === "critical";
  const Icon = critical ? OctagonAlert : TriangleAlert;
  const onSeen = () => seen.mutate(a.id, { onError: () => toast({ title: t("strip.seenFailed"), variant: "destructive" }) });

  return (
    <section
      role="status"
      aria-label={t("strip.aria")}
      data-help-anchor="riskSignals"
      className={cn("glass-panel flex items-start gap-2.5 rounded-2xl border p-3", critical ? "border-down/40" : "border-warn/40")}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", critical ? "text-down" : "text-warn")} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {t(`title.${key}`, vars)}
          <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">{fmtTimeNY(a.triggeredAt)}</span>
        </p>
        <p className="text-sm text-foreground">{t(`body.${key}`, vars)}</p>
        {(a.staffNotified || list.length > 1) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {[a.staffNotified ? t("strip.staffTold") : null, list.length > 1 ? t("strip.more", { count: list.length - 1 }) : null].filter(Boolean).join(" ")}
          </p>
        )}
      </div>
      {own && (
        <Button size="sm" variant="ghost" onClick={onSeen} disabled={seen.isPending} aria-busy={seen.isPending}>
          <PendingIcon pending={seen.isPending} />
          {t("strip.seen")}
        </Button>
      )}
      <ToolHelp id="riskSignals" className="mt-1" />
    </section>
  );
}
