/**
 * «Признание» — a curator's kudos for one trading day (and, optionally, one trade of it): POST /api/quests/kudos. The
 * day opens on the last finished trading day (prefill); the trade list is that day's trades of the trader.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtNum } from "@/lib/format";
import { addDays, nyDate } from "@/lib/trading-date";
import { personName } from "@/i18n";
import { questsI18n } from "@/i18n/ns/quests";
import { useDayTrades, useGiveKudos } from "./api";
import { useAuth } from "@/contexts/auth-context";

/** The last weekday before `today` (the day a curator usually looks back at). */
export function lastTradingDay(today: string): string {
  let d = addDays(today, -1);
  for (let i = 0; i < 7; i++) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) return d;
    d = addDays(d, -1);
  }
  return d;
}

export function KudosDialog({ open, onOpenChange, trader }: { open: boolean; onOpenChange: (v: boolean) => void; trader: string }) {
  const { t } = questsI18n.useT();
  const { toast } = useToast();
  const today = nyDate();
  const [day, setDay] = React.useState(() => lastTradingDay(today));
  const [tradeId, setTradeId] = React.useState<string>("");
  const [note, setNote] = React.useState("");
  const trades = useDayTrades(open ? trader : null, day, addDays(day, 1));
  const { user } = useAuth();
  const give = useGiveKudos(user?.traderName ?? null);
  React.useEffect(() => { setTradeId(""); }, [day]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Optimistic: close at once (the kudos already shows in the list); a refused one reopens with the note kept.
    give.mutate({ trader, day, tradeId: tradeId ? Number(tradeId) : null, note: note.trim() || undefined }, {
      onSuccess: () => {
        toast({ title: t("kudos.done") });
        setNote("");
      },
      onError: (err) => {
        toast({ title: t("kudos.failed"), description: humanizeApiError(err), variant: "destructive" });
        onOpenChange(true);
      },
    });
    onOpenChange(false);
  };
  const fieldId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("kudos.title", { name: personName(trader) })}</DialogTitle>
            <DialogDescription>{t("kudos.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-day`}>{t("kudos.day")}</Label>
            <Input id={`${fieldId}-day`} type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-trade`}>{t("kudos.trade")}</Label>
            <select
              id={`${fieldId}-trade`}
              value={tradeId}
              onChange={(e) => setTradeId(e.target.value)}
              className="h-9 rounded-full border border-[var(--field-border)] bg-[var(--glass-bg)] px-3 text-sm text-foreground"
            >
              <option value="">{t("kudos.tradeNone")}</option>
              {(trades.data ?? []).map((x) => (
                <option key={x.id} value={String(x.id)}>{`${x.ticker} · ${x.pnl == null ? "—" : fmtNum(x.pnl, { signed: true, decimals: 2 })}`}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-note`}>{t("kudos.note")}</Label>
            <Textarea id={`${fieldId}-note`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t("kudos.notePlaceholder")} rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={give.isPending || !day}>{give.isPending ? t("kudos.saving") : t("kudos.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
