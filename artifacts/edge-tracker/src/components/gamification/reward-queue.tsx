import { useEffect } from "react";
import { Check, Gift, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { fmtDayMonth } from "@/lib/format";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { personName } from "@/i18n";
import { useDecideReward, useRewardQueue, type QueueGrant } from "./api";

/** Where staff decide reward requests (the reward_requested notification link; the admin «Награды» block links here). */
export const STAFF_QUEUE_HREF = "/curator?rewards=1";

/** One requested reward: who / what / when, «Вручить» / «Отклонить» right in the row. */
function QueueRow({ g, onOpenTrader, focus }: { g: QueueGrant; onOpenTrader: (trader: string) => void; focus: boolean }) {
  const { t } = gamificationI18n.useT();
  const { toast } = useToast();
  const decide = useDecideReward();
  const title = g.title ?? `#${g.itemId}`;
  const run = (decision: "grant" | "decline") =>
    decide.mutate({ id: g.id, decision }, {
      onSuccess: () => toast({ title: t(decision === "grant" ? "queue.granted" : "queue.declined") }),
      onError: (e) => toast({ title: t("queue.failed"), description: humanizeApiError(e), variant: "destructive" }),
    });
  return (
    <li className={cn("tile flex min-w-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3", focus && "ring-2 ring-primary/60")}>
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 text-sm">
          <button type="button" onClick={() => onOpenTrader(g.trader)} className="font-medium text-foreground hover:text-primary" title={t("queue.open")}>
            {personName(g.trader)}
          </button>
          <span className="text-muted-foreground"> {t("queue.item", { title })}</span>
          <span className="ml-1 text-xs tabular-nums text-muted-foreground">{fmtDayMonth(g.at)}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1.5">
        <Button type="button" size="sm" onClick={() => run("grant")} disabled={decide.isPending}>
          <Check aria-hidden="true" /> {t("queue.grant")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => run("decline")} disabled={decide.isPending}>
          <X aria-hidden="true" /> {t("queue.decline")}
        </Button>
      </span>
    </li>
  );
}

/**
 * Reward requests as a small item type at the top of the curator «Сегодня» attention list (no separate list). The
 * reward_requested notification links to /curator?rewards=1 → `focus` scrolls here and outlines the rows.
 */
export function RewardQueueItems({ onOpenTrader, focus = false }: { onOpenTrader: (trader: string) => void; focus?: boolean }) {
  const { t } = gamificationI18n.useT();
  const q = useRewardQueue(true);
  const list = (q.data ?? []).filter((g) => g.status === "requested");
  useEffect(() => {
    if (!focus || list.length === 0) return;
    const timer = window.setTimeout(() => document.getElementById("gm-reward-queue")?.scrollIntoView({ block: "center" }), 400);
    return () => window.clearTimeout(timer);
  }, [focus, list.length]);
  if (list.length === 0) return null;
  return (
    <ul id="gm-reward-queue" className="flex flex-col gap-1.5" aria-label={t("queue.aria")}>
      {list.map((g) => <QueueRow key={g.id} g={g} onOpenTrader={onOpenTrader} focus={focus} />)}
    </ul>
  );
}
