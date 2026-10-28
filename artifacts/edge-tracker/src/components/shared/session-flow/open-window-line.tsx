/**
 * The opening window 09:30–10:00 as its own risk zone, one row beside the limits it belongs to (owner UX law 3: next to
 * the action, not a banner): the window's loss limit and where it comes from, or «lifted» with the proof, plus how far
 * the trader is from lifting it. Numbers from the api (lib/sessionFlow/openWindow).
 */
import { useQuery } from "@tanstack/react-query";
import { Sunrise } from "lucide-react";
import { Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtRate, fmtUsd } from "@/lib/format";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import { openWindowQuery } from "./api";

export function OpenWindowLine({ trader, className }: { trader: string | null; className?: string }) {
  const { t } = sessionFlowI18n.useT();
  const q = useQuery(openWindowQuery(trader));
  const s = q.data;
  if (!s || (s.limitUsd == null && !s.lifted)) return null;
  const usd = (v: number | null) => fmtUsd(v, { decimals: 0 });
  const proof = t("openWindow.proof", { trades: s.edge.n, net: fmtUsd(s.edge.netExTop3, { signed: true, decimals: 0 }) });
  return (
    <div className={cn("flex flex-col gap-1 text-sm", className)}>
      <p className="flex flex-wrap items-center gap-1.5">
        <Sunrise className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">{t("openWindow.label")}</span>
        {s.lifted ? (
          <Pill tone="up" title={proof}>{t("openWindow.lifted")}</Pill>
        ) : (
          <span className="font-medium tabular-nums text-foreground">{usd(s.limitUsd)}</span>
        )}
        {!s.lifted && s.source === "stage" && s.share != null && <span className="text-xs text-muted-foreground">{t("openWindow.stageShare", { share: fmtRate(s.share) })}</span>}
        {!s.lifted && s.source === "own" && <span className="text-xs text-muted-foreground">{t("openWindow.own")}</span>}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {s.lifted ? proof : t("openWindow.toLift", { trades: Math.min(s.edge.n, s.liftMinTrades), need: s.liftMinTrades, net: fmtUsd(s.edge.netExTop3, { signed: true, decimals: 0 }) })}
      </p>
    </div>
  );
}
