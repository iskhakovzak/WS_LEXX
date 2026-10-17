import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpRight, BookOpen, CalendarClock, Lightbulb, LineChart, Lock, NotebookPen } from "lucide-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { http } from "@/lib/api/http";
import { nullIfMissing } from "@/lib/api/errors";
import { STALE } from "@/lib/api/keys";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { fmtPct, fmtPrice, fmtR, fmtUsd } from "@/lib/format";
import type { Thread } from "./lib";

/* `GET /api/discussions/:id/entity` — the thing a contextual thread is about.
 * Numbers come from the shared API math (net = gross − |fees|, signed R). */

type EntityTrade =
  | { id: number; restricted: true }
  | {
      id: number; ticker: string; date: string; exitDate: string | null; closeDate: string; side: string | null; setup: string | null;
      result: string | null; res: string | null; horizon: string | null; entry: number | null; exit: number | null; stop: number | null; qty: number | null;
      pnl: number | null; fees: number | null; netPnl: number | null; signedR: number | null; trader: string | null; source: string | null;
      brokerAccount: string | null; playbookId: number | null; restricted?: false;
    };
type EntityPayload = {
  id: number; tradeId: number | null; eventId: number | null; ideaId: number | null; playbookId: number | null; journalDate: string | null; ticker: string | null;
  trade?: EntityTrade | null;
  event?: { id: number; ticker: string; date: string; eventType: string; headline: string; reaction: string | null; percentMove: number | null; session: string | null } | null;
  idea?: { id: number; ticker: string; side: string | null; setup: string | null; status: string | null; trader: string | null; score: number | null; ideaDate: string | null } | null;
  playbook?: { id: number; name?: string } | null;
};

export function hasContext(t: Thread): boolean {
  return !!(t.tradeId || t.eventId || t.ideaId || t.playbookId || t.journalDate);
}

function Row({ icon: Icon, label, href, children }: { icon: React.ElementType; label: string; href: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="micro-label">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
      <Link href={href} className="inline-flex items-center gap-0.5 text-primary hover:underline">Открыть<ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
    </div>
  );
}

export function EntityCard({ thread }: { thread: Thread }) {
  const enabled = hasContext(thread);
  const q = useQuery({
    queryKey: ["discussion-entity", thread.id, thread.tradeId ?? 0, thread.eventId ?? 0, thread.ideaId ?? 0, thread.playbookId ?? 0, thread.journalDate ?? ""],
    queryFn: ({ signal }): Promise<EntityPayload | null> =>
      http.get<EntityPayload>(`/api/discussions/${thread.id}/entity`, { signal }).catch(nullIfMissing),
    enabled,
    staleTime: STALE.short,
    retry: false,
  });
  if (!enabled) return null;
  if (q.isLoading) return <Skeleton className="h-10 rounded-xl" />;
  const d = q.data;
  if (!d) return null;
  const t = d.trade;
  return (
    <div className="space-y-1.5" aria-label="Контекст темы">
      {t && ("restricted" in t && t.restricted ? (
        <div className="flex items-center gap-2 rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />Сделка #{t.id} — доступна только автору и кураторам
        </div>
      ) : (
        <Row icon={LineChart} label="Сделка" href={links.trade(t.id)}>
          <span className="font-semibold text-foreground">{t.ticker}</span>
          {t.side && <span className="text-muted-foreground">{t.side}</span>}
          <span className="tabular-nums text-muted-foreground">{t.date}{t.exitDate && t.exitDate !== t.date ? ` → ${t.exitDate}` : ""}</span>
          {t.setup && <span className="truncate text-muted-foreground">{t.setup}</span>}
          {t.horizon && <Pill tone="neutral" className="py-0 text-2xs">{t.horizon}</Pill>}
          {t.trader && <span className="text-muted-foreground">{t.trader}</span>}
          {t.entry != null && <span className="tabular-nums text-muted-foreground">вход {fmtPrice(t.entry)}{t.stop != null ? ` · стоп ${fmtPrice(t.stop)}` : ""}{t.exit != null ? ` · выход ${fmtPrice(t.exit)}` : ""}</span>}
          {t.signedR != null && <span className={cn("font-semibold tabular-nums", toneText(toneOf(t.signedR)))}>{fmtR(t.signedR, 1)}</span>}
          {t.netPnl != null && <span className={cn("tabular-nums", toneText(toneOf(t.netPnl)))} title={`брутто ${fmtUsd(t.pnl, { decimals: 0 })} · комиссии ${fmtUsd(t.fees, { decimals: 0 })}`}>{fmtUsd(t.netPnl, { decimals: 0 })} нетто</span>}
          <Pill tone={t.res === "win" ? "up" : t.res === "loss" ? "down" : "neutral"} className="py-0 text-2xs">{t.res ?? "open"}</Pill>
          {t.playbookId != null && <Link href={links.setup(t.playbookId)} className="text-primary hover:underline">сетап</Link>}
        </Row>
      ))}
      {d.event && (
        <Row icon={CalendarClock} label="Событие" href={`/events?id=${d.event.id}`}>
          <span className="font-semibold text-foreground">{d.event.ticker}</span>
          <span className="tabular-nums text-muted-foreground">{d.event.date}{d.event.session ? ` ${d.event.session}` : ""}</span>
          <span className="truncate">{d.event.headline}</span>
          {d.event.percentMove != null && <span className={cn("tabular-nums", toneText(toneOf(d.event.percentMove)))}>{fmtPct(d.event.percentMove, 1)}</span>}
        </Row>
      )}
      {d.idea && (
        <Row icon={Lightbulb} label="Идея" href={links.idea(d.idea.id)}>
          <span className="font-semibold text-foreground">{d.idea.ticker}</span>
          {d.idea.side && <Pill tone={/short|шорт/i.test(d.idea.side) ? "down" : "up"} className="py-0 text-2xs">{d.idea.side}</Pill>}
          {d.idea.setup && <span className="truncate text-muted-foreground">{d.idea.setup}</span>}
          {d.idea.status && <span className="text-muted-foreground">{d.idea.status}</span>}
          {d.idea.trader && <span className="text-muted-foreground">{d.idea.trader}</span>}
        </Row>
      )}
      {d.playbook && (
        <Row icon={BookOpen} label="Сетап" href={links.setup(d.playbook.id)}>
          <span className="font-semibold text-foreground">{d.playbook.name ?? `#${d.playbook.id}`}</span>
        </Row>
      )}
      {d.journalDate && (
        <Row icon={NotebookPen} label="День" href={links.journalDay(d.journalDate)}>
          <span className="tabular-nums text-foreground">{d.journalDate}</span>
          <Link href={links.trades({ from: d.journalDate, to: d.journalDate })} className="text-primary hover:underline">сделки дня</Link>
        </Row>
      )}
    </div>
  );
}
