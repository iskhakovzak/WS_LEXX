/**
 * «Сила катализатора» on /analyst-actions: tickers where analysts agree (a cluster of same-direction calls) or one firm
 * moves the price target a lot — a STRONG catalyst for the plan day. Each line shows the release times, whether the
 * ticker is in my watchlist / plan, and one tap: «Сильный бычий» writes the catalyst mark (the same one the plan and
 * watchlist taps write), «В план» adds the ticker. The same suggestion pre-fills those taps (dashed «Сильный»).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, Check, Flame } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton, Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { fmtDate, fmtPct } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useSaveMark } from "@/components/shared/strategy/api";
import { analystSignalsI18n } from "@/i18n/ns/analystSignals";
import { nyTime } from "./lib";
import { useAddToPlan } from "./api";
import { isConfirmed, signalsQuery, type StrengthSignal } from "./signals-api";

const SHOWN = 4;

export function StrengthSignals({ day, canEdit, onOpen, className }: {
  /** The plan day (the analyst page's session day). */
  day: string;
  canEdit: boolean;
  onOpen?: (ticker: string) => void;
  className?: string;
}) {
  const { t } = analystSignalsI18n.useT();
  const q = useQuery(signalsQuery(day, canEdit));
  const [all, setAll] = React.useState(false);
  if (!canEdit) return null;
  const list = q.data?.signals ?? [];
  // Unconfirmed first (what is left to do), then the confirmed ones — closure: the list empties as you confirm.
  const sorted = [...list].sort((a, b) => Number(isConfirmed(a)) - Number(isConfirmed(b)));
  const shown = all ? sorted : sorted.slice(0, SHOWN);
  const opts = q.data?.opts;

  return (
    <Panel
      icon={Flame}
      title={t("title")}
      description={opts ? `${t("description")} ${t("rule", { count: opts.clusterMin, hours: opts.windowHours, pct: fmtPct(opts.targetPct, 0) })}` : t("description")}
      className={className}
    >
      {q.isLoading ? (
        <ListSkeleton rows={3} dense />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={q.refetch} title={t("loadFailed")} />
      ) : !list.length ? (
        <EmptyState compact icon={Flame} title={t("empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((s) => <SignalRow key={`${s.ticker}-${s.day}`} s={s} planDay={day} onOpen={onOpen} />)}
          {sorted.length > SHOWN && (
            <li>
              <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
                {all ? t("less") : t("more", { count: sorted.length - SHOWN })}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

function SignalRow({ s, planDay, onOpen }: { s: StrengthSignal; planDay: string; onOpen?: (ticker: string) => void }) {
  const { t } = analystSignalsI18n.useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  // The mark belongs to the session that trades the signal (a call after today's close → tomorrow's plan).
  const save = useSaveMark(s.day);
  const addPlan = useAddToPlan();
  const done = isConfirmed(s);
  const Icon = s.direction === "bull" ? ArrowUp : ArrowDown;
  const dir = t(`direction.${s.direction}`);
  const reason = s.reason === "cluster" ? t("reason.cluster", { count: s.count }) : t("reason.target", { pct: fmtPct(s.targetPct ?? 0, 0) });

  const confirm = () => save.mutate(
    { date: s.day, ticker: s.ticker, direction: s.direction, strength: "strong", kind: "news", source: "plan", suggested: true },
    {
      onSuccess: () => {
        toast({ title: t("saved", { ticker: s.ticker, dir: dir.toLowerCase() }) });
        void qc.invalidateQueries({ queryKey: ["catalysts", "analyst-signals"] });
      },
    },
  );
  const toPlan = () => addPlan.mutate(
    { date: s.day, ticker: s.ticker, catalyst: reason, bias: s.direction },
    { onSuccess: () => void qc.invalidateQueries({ queryKey: ["catalysts", "analyst-signals"] }) },
  );

  return (
    <li className={cn("rounded-xl border border-[var(--glass-border)] p-2.5 transition-opacity duration-[var(--dur-2)]", done && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={() => onOpen?.(s.ticker)} className="font-semibold text-foreground hover:underline">{s.ticker}</button>
        <Pill tone={s.direction === "bull" ? "up" : "down"}><Icon className="h-3 w-3" aria-hidden="true" />{dir}</Pill>
        <span className="text-xs text-muted-foreground">{reason}</span>
        {s.day !== planDay && <span className="text-xs text-muted-foreground">· {s.day < planDay ? t("day.prev") : t("day.next", { date: fmtDate(s.day, "dayMonth") })}</span>}
        {s.inWatchlist && <Pill tone="neutral">{t("inWatchlist")}</Pill>}
        {s.inPlan && <Pill tone="accent">{t("inPlan")}</Pill>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {s.acts.slice(0, 4).map((a) => `${a.firm} · ${t(`kind.${a.kind}`)}${a.targetPct != null && (a.kind === "ptUp" || a.kind === "ptDown") ? ` ${fmtPct(a.targetPct, 0)}` : ""} · ${nyTime(a.at)}`).join("  ·  ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {done ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />{t("marked", { mark: t("markStrong", { dir: dir.toLowerCase() }) })}</span>
        ) : (
          <Button size="sm" variant="outline" className="border-dashed" disabled={save.isPending} onClick={confirm} aria-label={t("markStrongAria", { ticker: s.ticker, dir: dir.toLowerCase() })}>
            <Icon aria-hidden="true" />{t("markStrong", { dir: dir.toLowerCase() })}
          </Button>
        )}
        {!s.inPlan && <Button size="sm" variant="ghost" disabled={addPlan.isPending} onClick={toPlan}>{t("addPlan")}</Button>}
        <Button size="sm" variant="ghost" asChild><Link href={s.inPlan ? links.myPlan(s.day) : links.watchlist(s.ticker)}>{s.inPlan ? t("inPlan") : t("openWatchlist")}</Link></Button>
      </div>
    </li>
  );
}
