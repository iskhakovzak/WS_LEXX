/**
 * «Задача дня» reveal: the real ticker and date, the viewer's R and place, the desk ranking by R (the top and the
 * viewer's own row only — no public shaming; traders see day aliases «Трейдер N» when names are hidden, staff see
 * names, exactly as the server labels them) and where to go next: the desk on this ticker-day and a discussion.
 * The viewer's trades are already on the game chart above (the sim reveal).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarCheck, Flame, MessageSquare, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, ListSkeleton, toneOf, toneText } from "@/components/ds";
import { fmtDate, fmtR } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { personName } from "@/i18n";
import { trainerI18n } from "@/i18n/ns/trainer";
import type { DailyChallengeState } from "@/lib/trainer/types";
import { aliasOf, dailyQuery } from "./trainer-api";
import type { GameView } from "./use-sim-game";

/** Ranking rows with their places; a «…» gap before the viewer's row when it sits below the top. */
export function rankRows(d: DailyChallengeState): { key: string; place: number | null; label: string; me: boolean; r: number | null; trades: number; gap: boolean }[] {
  let prev = 0;
  return d.ranking.map((row, i) => {
    const place = row.me && d.my?.rank != null ? d.my.rank : i + 1;
    const gap = place > prev + 1;
    prev = place;
    return { key: `${row.label}-${i}`, place, label: row.label, me: row.me, r: row.r, trades: row.trades, gap };
  });
}

export function rankLabel(label: string, me: boolean): string {
  const t = trainerI18n.t;
  if (me) return t("ranking.me");
  const n = aliasOf(label);
  return n != null ? t("ranking.alias", { n }) : personName(label);
}

export function DailyRanking({ d, max }: { d: DailyChallengeState; max?: number }) {
  const { t } = trainerI18n.useT();
  const rows = rankRows(d);
  const shown = max != null ? rows.filter((r, i) => i < max || r.me) : rows;
  if (!shown.length) return <p className="text-xs text-muted-foreground">{t("ranking.empty")}</p>;
  return (
    <ol className="flex flex-col gap-1" aria-label={t("ranking.title")}>
      {shown.map((r) => (
        <li key={r.key} className="flex flex-col">
          {r.gap && <span className="pl-2 text-2xs text-muted-foreground" aria-hidden="true">…</span>}
          <span className={cn("flex items-center gap-2 rounded-lg px-2 py-1 text-sm", r.me && "bg-primary/[0.08] font-medium")}>
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{r.place}</span>
            {r.place === 1 && <Trophy className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{rankLabel(r.label, r.me)}</span>
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{t("ranking.trades", { count: r.trades })}</span>
            <span className={cn("w-14 shrink-0 text-right font-semibold tabular-nums", toneText(toneOf(r.r)))}>{r.r != null ? fmtR(r.r) : "—"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DailyReveal({ game }: { game: GameView }) {
  const { t } = trainerI18n.useT();
  const q = useQuery(dailyQuery());
  const d = q.data;
  const ticker = d?.revealed?.ticker ?? game.reveal?.ticker ?? null;
  const date = d?.revealed?.barsDate ?? game.reveal?.day ?? null;
  return (
    <section className="glass-panel rounded-2xl p-[var(--panel-p)]" aria-labelledby="daily-reveal-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="daily-reveal-title" className="flex items-center gap-2 text-sm font-semibold">
            <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" />{t("daily.revealTitle", { date: fmtDate(game.meta.trainer?.date ?? d?.date ?? "", "dayMonth") })}
          </h2>
          {ticker && date && <p className="mt-0.5 text-lg font-semibold tracking-tight">{t("daily.revealed", { ticker, date: fmtDate(date, "medium") })}</p>}
          {d?.my && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {d.my.rank != null ? t("daily.myPlace", { rank: d.my.rank, of: d.my.of }) : t("daily.myNoRank")}
              {d.my.r != null && <span className={cn("ml-2 font-semibold tabular-nums", toneText(toneOf(d.my.r)))}>{fmtR(d.my.r)}</span>}
            </p>
          )}
        </div>
        {d && d.streak > 0 && (
          <p className="flex items-center gap-1.5 text-sm font-medium"><Flame className="h-4 w-4 text-warn" aria-hidden="true" />{t("daily.streak", { count: d.streak })}</p>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("ranking.title")}</p>
          {q.isLoading ? <ListSkeleton rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} inset /> : d ? <DailyRanking d={d} max={10} /> : null}
        </div>
        {ticker && date && (
          <div className="flex flex-row flex-wrap gap-2 md:flex-col">
            <Button asChild variant="outline" size="sm"><Link href={links.deskDay(ticker, date)}><Users aria-hidden="true" /> {t("daily.deskDay")}</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={links.newThread({ ticker })}><MessageSquare aria-hidden="true" /> {t("daily.discuss")}</Link></Button>
          </div>
        )}
      </div>
    </section>
  );
}
