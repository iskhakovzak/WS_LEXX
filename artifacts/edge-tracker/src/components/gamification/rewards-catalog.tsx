import { Check, Clock, Gift, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, Pill, type Tone } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { fmtDayMonth } from "@/lib/format";
import type { GamificationMe } from "@/lib/gamification/types";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { useRequestReward } from "./api";
import { conditionText, outOfStock, rewardRows, type RewardRow } from "./model";

const STATE_TONE: Record<Exclude<RewardRow["state"], "eligible" | "locked">, Tone> = { requested: "warn", granted: "up", declined: "neutral" };

function StateBadge({ row }: { row: RewardRow }) {
  const { t } = gamificationI18n.useT();
  const at = row.grant ? fmtDayMonth(row.grant.at) : "";
  if (row.state === "requested") return <Pill tone={STATE_TONE.requested}><Clock className="h-3 w-3" aria-hidden="true" /> {t("rewards.requestedOn", { date: at })}</Pill>;
  if (row.state === "granted") return <Pill tone={STATE_TONE.granted}><Check className="h-3 w-3" aria-hidden="true" /> {t("rewards.grantedOn", { date: at })}</Pill>;
  if (row.state === "declined") return <Pill tone={STATE_TONE.declined} title={row.grant?.note ?? undefined}><X className="h-3 w-3" aria-hidden="true" /> {t("rewards.declinedOn", { date: at })}</Pill>;
  return null;
}

function RewardLine({ row }: { row: RewardRow }) {
  const { t } = gamificationI18n.useT();
  const { toast } = useToast();
  const request = useRequestReward();
  const { item } = row;
  const empty = outOfStock(item);
  const eligible = row.state === "eligible";
  return (
    <li className={cn("tile flex min-w-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3", eligible && "ring-1 ring-primary/50")}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center self-start rounded-xl sm:self-center", eligible || row.state === "granted" ? "bg-primary/15 text-primary" : "bg-foreground/[0.06] text-muted-foreground")} aria-hidden="true">
        {row.state === "locked" ? <Lock className="h-4 w-4" /> : <Gift className="h-4 w-4" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold leading-snug text-foreground">{item.title}</span>
        {item.description && <span className="text-xs leading-snug text-muted-foreground">{item.description}</span>}
        <span className="text-xs text-muted-foreground">
          {conditionText(item.condition)}
          {item.stock != null && <> · {empty ? t("rewards.outOfStock") : t("rewards.stock", { count: item.stock })}</>}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
        {eligible ? (
          <Button
            size="sm"
            disabled={request.isPending || empty}
            onClick={() =>
              request.mutate(item.id, {
                onSuccess: () => toast({ title: t("rewards.requestDone") }),
                onError: (e) => toast({ title: t("rewards.requestFailed"), description: humanizeApiError(e), variant: "destructive" }),
              })}
          >
            <Gift aria-hidden="true" />
            {request.isPending ? t("rewards.requesting") : t("rewards.request")}
          </Button>
        ) : row.state === "locked" ? (
          <span className="text-xs text-muted-foreground">{t("rewards.locked")}</span>
        ) : (
          <StateBadge row={row} />
        )}
      </div>
    </li>
  );
}

/**
 * «Награды» (trader): what the desk offers, what the trader can already request, and the requested / granted history —
 * one list, eligible first. Real prizes from the desk, never bought with points.
 */
export function RewardsCatalog({ rewards, highlight = false }: { rewards: GamificationMe["rewards"]; highlight?: boolean }) {
  const { t } = gamificationI18n.useT();
  const rows = rewardRows(rewards);
  const eligible = rows.filter((r) => r.state === "eligible").length;
  return (
    <section id="gm-rewards" className={cn("scroll-mt-20 rounded-2xl", highlight && "ring-2 ring-primary/60")}>
      <Panel
        title={t("rewards.title")}
        icon={Gift}
        description={t("rewards.description")}
        actions={eligible > 0 ? <Pill tone="accent">{t("rewards.eligible")} · {eligible}</Pill> : undefined}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("rewards.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => <RewardLine key={r.item.id} row={r} />)}
          </ul>
        )}
      </Panel>
    </section>
  );
}
