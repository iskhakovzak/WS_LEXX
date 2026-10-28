/**
 * The trader's live leak guard banner (mounted once in components/layout.tsx). Polls GET /leak-guard/me/active; the
 * server raises an event at the PropReports sync that shows the trigger (a closed loss, a broken rule, the day near
 * the stop, the session start for a costly first trade).
 *
 *   soft  a card under the header: what happened, the trader's own $ figure, the countdown; «hide» until it ends
 *   firm  a dialog first (dims the page: the decision is the figure), then the card; «Беру паузу» logs the time,
 *         without it the curator is told after a few minutes
 *   hard  as firm, plus «you are on pause: the risk manager was told»
 * Semantic warn / down tone with an icon and short text (ARCHITECTURE.md §4a.3): not an ad-like gradient strip.
 */
import * as React from "react";
import { Hourglass, OctagonPause, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { fmtTimeNY, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { leakGuardI18n } from "@/i18n/ns/leakGuard";
import { useAckGuard, useActiveGuard } from "./api";
import { fmtCountdown, needsAck, pickBannerEvent, remainingMs, type GuardEvent } from "./model";

function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function GuardText({ e, left }: { e: GuardEvent; left: number | null }) {
  const { t } = leakGuardI18n.useT();
  const usd = fmtUsd(e.costPerTrade, { decimals: 0 });
  return (
    <>
      <p className="text-sm text-foreground">{t(`banner.body.${e.pattern}`, { usd })}</p>
      {left != null && e.pauseUntil && (
        <p className="mt-1 text-xs tabular-nums text-muted-foreground" aria-live="off">
          {t("banner.left", { time: fmtCountdown(left) })} · {t("banner.until", { time: fmtTimeNY(e.pauseUntil) })}
        </p>
      )}
      {e.level === "hard" && <p className="mt-1 text-xs text-down">{t("banner.hardNote")}</p>}
      {e.level === "firm" && needsAck(e) && <p className="mt-1 text-xs text-muted-foreground">{t("banner.firmNote")}</p>}
    </>
  );
}

export function GuardBanner() {
  const { user } = useAuth();
  const signedIn = !!user && user.role !== "guest" && !!user.traderName;
  const { t } = leakGuardI18n.useT();
  const { toast } = useToast();
  const q = useActiveGuard(signedIn);
  const ack = useAckGuard();
  const [hidden, setHidden] = React.useState<ReadonlySet<number>>(() => new Set());
  const [dialogClosed, setDialogClosed] = React.useState<ReadonlySet<number>>(() => new Set());
  const e = q.data ? pickBannerEvent(q.data.events, hidden) : null;
  const offset = q.data ? Date.parse(q.data.now) - q.dataUpdatedAt : 0;
  const now = useNow(!!e?.pauseUntil);
  const left = e ? remainingMs(e.pauseUntil, now, offset) : null;

  if (!e || left === 0) return null;

  const title = t(`banner.title.${e.pattern}`, { minutes: e.minutes ?? 0 });
  const onAck = () =>
    ack.mutate(e.id, {
      onSuccess: () => toast({ title: t("banner.acked") }),
      onError: () => toast({ title: t("banner.ackFailed"), variant: "destructive" }),
    });
  const ackButton = (
    <Button size="sm" onClick={onAck} disabled={ack.isPending} aria-busy={ack.isPending}>
      <PendingIcon pending={ack.isPending} />
      {t("banner.ack")}
    </Button>
  );
  const Icon = e.level === "hard" ? OctagonPause : e.pauseUntil ? Hourglass : ShieldAlert;

  return (
    <>
      <Dialog open={needsAck(e) && !dialogClosed.has(e.id)} onOpenChange={(open) => { if (!open) setDialogClosed((s) => new Set(s).add(e.id)); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className={cn("h-5 w-5 shrink-0", e.level === "hard" ? "text-down" : "text-warn")} aria-hidden="true" />
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{t("banner.aria")}</DialogDescription>
          </DialogHeader>
          <div><GuardText e={e} left={left} /></div>
          <DialogFooter>{ackButton}</DialogFooter>
        </DialogContent>
      </Dialog>
      <aside
        role="status"
        aria-label={t("banner.aria")}
        className={cn(
          "glass-thick fixed right-3 top-16 z-toast w-[min(26rem,calc(100vw-1.5rem))] rounded-2xl border p-3 shadow-lg",
          e.level === "hard" ? "border-down/40" : "border-warn/40",
        )}
      >
        <div className="flex items-start gap-2.5">
          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", e.level === "hard" ? "text-down" : "text-warn")} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <GuardText e={e} left={left} />
            <div className="mt-2 flex flex-wrap gap-2">
              {needsAck(e) ? ackButton : (
                <Button size="sm" variant="ghost" onClick={() => setHidden((s) => new Set(s).add(e.id))}>
                  {t("banner.hide")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
