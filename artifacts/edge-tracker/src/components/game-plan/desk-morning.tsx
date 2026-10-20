/**
 * The one morning summary (Волна 1, item 1.20): the desk plan carries «Сегодня важно» (the day's manual posts of the
 * daily feed — curators' / traders' theme, what works, tickers, notes) and «Новости деска» (the auto feed of the
 * previous session and of the plan's day: results, achievements, reviews, ideas). The daily feed and the activity pages
 * stay (the full lists are one link away); nothing new is stored. Read-only: GET /api/dailyfeed and
 * GET /api/dailyfeed/stream.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Megaphone, Newspaper } from "lucide-react";
import { Panel } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { StreamRow } from "@/components/shared/stream/StreamCard";
import { useFeedStreamDay } from "@/components/shared/stream/stream-api";
import { personName } from "@/i18n";
import { gpI18n } from "@/i18n/ns/gamePlan";
import { shiftTradingDay } from "./types";
import { dayPosts, deskNews, type DayPost } from "./plan-defaults";

type FeedEntry = Parameters<typeof dayPosts>[0][number];

function FullLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary hover:underline">
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function PostCard({ p }: { p: DayPost }) {
  const { t } = gpI18n.useT();
  const rows: [string, string | null][] = [
    [t("morning.theme"), p.theme],
    [t("morning.works"), p.works],
    [t("morning.doesntWork"), p.doesntWork],
  ];
  return (
    <li className="tile flex flex-col gap-1.5 rounded-xl p-3 text-sm">
      {rows.filter(([, v]) => v).map(([label, v]) => (
        <p key={label} className="leading-snug [overflow-wrap:anywhere]">
          <span className="text-xs text-muted-foreground">{label}: </span>
          {v}
        </p>
      ))}
      {p.tickers.length > 0 && (
        <p className="text-xs">
          <span className="text-muted-foreground">{t("morning.tickers")}: </span>
          <span className="font-medium tabular-nums">{p.tickers.slice(0, 8).join(", ")}</span>
        </p>
      )}
      {p.notes && <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{p.notes}</p>}
      {p.author && <p className="text-2xs text-muted-foreground">{t("morning.by", { name: personName(p.author) })}</p>}
    </li>
  );
}

/** «Сегодня важно» — the day's manual posts. */
export function TodayImportant({ date }: { date: string }) {
  const { t } = gpI18n.useT();
  const q = useQuery({
    queryKey: ["game-plan", "day-posts", date],
    queryFn: ({ signal }) => http.get<FeedEntry[]>("/api/dailyfeed", { query: { from: date, to: date, limit: 20 }, signal }),
    staleTime: STALE.long,
    retry: false,
  });
  const posts = useMemo(() => dayPosts(Array.isArray(q.data) ? q.data : [], date), [q.data, date]);
  return (
    <Panel title={t("morning.importantTitle")} description={t("morning.importantHint")} icon={Megaphone}
      footer={<FullLink href={`/dailyfeed?date=${date}`} label={t("morning.allPosts")} />}>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : q.isError ? (
        <p className="text-xs text-muted-foreground">{t("morning.loadFailed")}</p>
      ) : posts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("morning.importantEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">{posts.slice(0, 3).map((p) => <PostCard key={p.id} p={p} />)}</ul>
      )}
    </Panel>
  );
}

/** «Новости деска» — the auto feed since the previous session. */
export function DeskNews({ date }: { date: string }) {
  const { t } = gpI18n.useT();
  const prev = shiftTradingDay(date, -1);
  const dayQ = useFeedStreamDay(date);
  const prevQ = useFeedStreamDay(prev);
  const items = useMemo(
    () => deskNews([...(dayQ.data?.items ?? []), ...(prevQ.data?.items ?? [])], prev, date),
    [dayQ.data, prevQ.data, prev, date],
  );
  const loading = dayQ.isLoading || prevQ.isLoading;
  const failed = dayQ.isError && prevQ.isError;
  return (
    <Panel title={t("morning.newsTitle")} description={t("morning.newsHint")} icon={Newspaper}
      footer={<FullLink href="/dailyfeed" label={t("morning.allNews")} />}>
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ) : failed ? (
        <p className="text-xs text-muted-foreground">{t("morning.loadFailed")}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("morning.newsEmpty")}</p>
      ) : (
        <div className="-mx-2 flex flex-col">{items.map((it) => <StreamRow key={it.id} item={it} baseline={null} />)}</div>
      )}
    </Panel>
  );
}

/** Both sections, in the order a morning reads them. */
export function DeskMorning({ date }: { date: string }) {
  return (
    <>
      <TodayImportant date={date} />
      <DeskNews date={date} />
    </>
  );
}
