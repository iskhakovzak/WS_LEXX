/**
 * «Команда» — the team activity feed as a tab of /notifications (design audit wave 2: /activity was a second inbox with
 * its own three rows of filters). One row (design audit wave 3): the shared FeedToolbar (search · «Все / Непрочитанные»
 * · «Фильтры (n)» · refresh · «Прочитать всё»); the sections with 30-day counts, the action type and the trader (staff)
 * sit behind «Фильтры», each active one as a removable chip under the row.
 * The day digest and the feed itself are unchanged. /activity redirects here (App.tsx), keeping ?trader= / ?section=.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { http } from "@/lib/api/http";
import { isNotFound } from "@/lib/api/errors";
import { links } from "@/lib/links";
import { addDays, nyDate } from "@/lib/trading-date";
import { useAuth } from "@/contexts/auth-context";
import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, Pill } from "@/components/ds";
import { FeedToolbar } from "@/components/shared/feed-toolbar";
import { ActiveFilters } from "@/components/shared/filters/filter-toolbar";
import { DEFAULT_FILTERS, TeamFiltersButton, type Filters } from "@/components/team/team-filters";
import { BurstRow, DigestCard, FeedRow } from "@/components/team/activity-feed";
import {
  ACTION_GROUPS,
  SECTION_META,
  actionGroupLabel,
  capFirst,
  groupFeed,
  sectionMeta,
  type ActivitySummary,
  type FeedItem,
  type FeedPage,
} from "@/components/team/activity-model";
import { lsGet, lsSet } from "@/components/team/utils";
import { activityI18n } from "@/i18n/ns/activity";
import { commonI18n } from "@/i18n/ns/common";
import { notificationsI18n } from "@/i18n/ns/notifications";
import { personName, comparePersonNames } from "@/i18n";

const FILTER_KEY = "ws_activity_filters";
const SEEN_KEY = "ws_activity_seen_at";
const PAGE_SIZE = 40;


/** Saved filters; `?trader=` / `?section=` in the URL (cross-links from other pages) win over the saved ones. */
function loadFilters(staff: boolean): Filters {
  const f = lsGet<Partial<Filters>>(FILTER_KEY, {});
  const sp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const urlTrader = sp?.get("trader")?.trim() || null;
  const urlSection = sp?.get("section")?.trim() || null;
  return {
    group: f.group && f.group in ACTION_GROUPS ? f.group : "all",
    sections: urlSection ? [urlSection] : Array.isArray(f.sections) ? f.sections.filter((s) => typeof s === "string").slice(0, 20) : [],
    trader: staff ? urlTrader ?? (typeof f.trader === "string" ? f.trader : null) : null,
  };
}

/** Start of the New York calendar day `ymd` as an instant (DST-safe). */
function nyDayStart(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d, 5, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false, day: "numeric" });
  for (let i = 0; i < 2; i++) {
    const parts = fmt.formatToParts(new Date(t));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const day = Number(parts.find((p) => p.type === "day")?.value ?? d);
    const diff = (day === d ? 0 : day < d ? -24 : 24) + hour;
    if (diff === 0) break;
    t -= diff * 3600_000;
  }
  return new Date(t);
}

/** Fallback for API builds without /activity/feed: plain activity_log, filtered client-side, single page. */
async function legacyFeed(params: string): Promise<FeedPage> {
  const p = new URLSearchParams(params);
  const raw = await http.get<unknown>("/api/activity?limit=500");
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const sections = p.get("sections")?.split(",") ?? null;
  const actions = p.get("actions")?.split(",") ?? null;
  const trader = p.get("trader");
  const q = p.get("q")?.toLowerCase() ?? "";
  const limit = Number(p.get("limit")) || PAGE_SIZE;
  const items: FeedItem[] = rows
    .map((x) => ({
      uid: `log:${x.id}`,
      action: String(x.action ?? ""),
      section: String(x.section ?? ""),
      entityId: (x.entityId as string | null) ?? null,
      entityTitle: (x.entityTitle as string | null) ?? null,
      trader: (x.trader as string | null) ?? null,
      details: (x.details as string | null) ?? null,
      rating: null,
      createdAt: String(x.createdAt ?? ""),
    }))
    .filter(
      (i) =>
        (!sections || sections.includes(i.section)) &&
        (!actions || actions.includes(i.action)) &&
        (!trader || i.trader === trader) &&
        (!q || [i.entityTitle, i.details, i.trader, personName(i.trader)].some((v) => v?.toLowerCase().includes(q))),
    );
  return { items: limit < PAGE_SIZE ? items.slice(0, limit) : items, nextCursor: null };
}

export function TeamActivity() {
  const { user, isCurator } = useAuth();
  const { t } = activityI18n.useT();
  const tc = commonI18n.useT().t;
  const tn = notificationsI18n.useT().t;
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  const staff = isCurator;
  const seenKey = `${SEEN_KEY}:${user?.role ?? "guest"}:${me ?? ""}`;

  const [filters, setFilters] = useState<Filters>(() => loadFilters(staff));
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => lsSet(FILTER_KEY, filters), [filters]);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Unread: the dots compare against the timestamp of the previous visit (snapshot on mount); the current
  // visit is persisted right away and refreshed while the page stays open, so a reload never loses it.
  const [seenAt, setSeenAt] = useState<number>(() => lsGet<number>(seenKey, Date.now() - 24 * 3600_000));
  useEffect(() => {
    const touch = () => lsSet(seenKey, Date.now());
    touch();
    const id = window.setInterval(touch, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") touch(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      touch();
    };
  }, [seenKey]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (filters.sections.length) p.set("sections", filters.sections.join(","));
    const acts = ACTION_GROUPS[filters.group].actions;
    if (acts.length) p.set("actions", acts.join(","));
    if (staff && filters.trader) p.set("trader", filters.trader);
    if (q) p.set("q", q);
    return p.toString();
  }, [filters, q, staff]);

  const feed = useInfiniteQuery<FeedPage>({
    queryKey: ["activity-feed", params],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const url = `/api/activity/feed?${params}${pageParam ? `&before=${encodeURIComponent(String(pageParam))}` : ""}`;
      let data: { items?: FeedItem[]; nextCursor?: string | null } | null;
      try {
        data = await http.get<{ items?: FeedItem[]; nextCursor?: string | null } | null>(url, { signal });
      } catch (e) {
        if (isNotFound(e)) return legacyFeed(params);
        throw e;
      }
      return { items: Array.isArray(data?.items) ? data.items : [], nextCursor: data?.nextCursor ?? null };
    },
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) <= 1 ? 60_000 : false),
    staleTime: 20_000,
  });

  const isUnread = useCallback(
    (it: FeedItem) => new Date(it.createdAt).getTime() > seenAt && (!me || it.trader !== me),
    [seenAt, me],
  );
  const allItems = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const unreadCount = useMemo(() => allItems.filter(isUnread).length, [allItems, isUnread]);
  const items = useMemo(() => (unreadOnly ? allItems.filter(isUnread) : allItems), [allItems, unreadOnly, isUnread]);
  const groups = useMemo(() => groupFeed(items), [items]);

  // Digest day (NY trading date): defaults to the latest day with real (non-system) team activity.
  const [digestDay, setDigestDay] = useState<string | null>(null);
  const firstUnfiltered = useQuery<FeedPage>({
    queryKey: ["activity-feed", "digest-anchor"],
    queryFn: async () => {
      try {
        return await http.get<FeedPage>("/api/activity/feed?limit=20");
      } catch (e) {
        if (isNotFound(e)) return legacyFeed("limit=20");
        throw e;
      }
    },
    enabled: digestDay == null,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (digestDay || !firstUnfiltered.data) return;
    const real = firstUnfiltered.data.items.find((i) => i.trader && i.trader !== "system");
    // Never a future day (rows with a future created_at would otherwise anchor the digest past «today»).
    const today = nyDate();
    const day = real ? nyDate(new Date(real.createdAt)) : today;
    setDigestDay(day > today ? today : day);
  }, [firstUnfiltered.data, digestDay]);
  useEffect(() => {
    if (firstUnfiltered.isError && !digestDay) setDigestDay(nyDate());
  }, [firstUnfiltered.isError, digestDay]);

  const summary = useQuery<ActivitySummary>({
    queryKey: ["activity-summary", digestDay, staff ? filters.trader : null],
    enabled: !!digestDay,
    queryFn: async () => {
      const day = digestDay!;
      const p = new URLSearchParams({ from: nyDayStart(day).toISOString(), to: nyDayStart(addDays(day, 1)).toISOString(), date: day });
      if (staff && filters.trader) p.set("trader", filters.trader);
      return http.get<ActivitySummary>(`/api/activity/summary?${p}`);
    },
    staleTime: 60_000,
  });


  // Infinite scroll sentinel.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleSection = (s: string) =>
    setFilters((f) => ({ ...f, sections: f.sections.includes(s) ? f.sections.filter((x) => x !== s) : [...f.sections, s] }));
  const pickSection = (s: string) => setFilters((f) => ({ ...f, sections: [s] }));
  const pickTrader = (t: string | null) => { if (staff) setFilters((f) => ({ ...f, trader: t })); };
  const markRead = () => {
    const now = Date.now();
    setSeenAt(now);
    lsSet(seenKey, now);
  };

  const facets = summary.data?.facets;
  const sectionCounts = new Map((facets?.sections30d ?? []).map((s) => [s.section, s.count]));
  const sectionKeys = Object.keys(SECTION_META).filter(
    (s) => sectionCounts.has(s) || filters.sections.includes(s) || ["trades", "trade-ideas", "playbook", "discussions", "journal", "risk"].includes(s),
  );
  const traderOptions = useMemo(() => {
    const set = new Set((facets?.traders ?? []).filter((t) => t && t !== "system"));
    if (filters.trader) set.add(filters.trader);
    if (me) set.add(me);
    return [...set].sort(comparePersonNames);
  }, [facets, filters.trader, me]);

  // «Фильтры (n)»: what sits inside the popover (sections, action type, trader).
  const popoverCount = filters.sections.length + (filters.group !== "all" ? 1 : 0) + (staff && filters.trader ? 1 : 0);
  const activeFilterCount = popoverCount + (q ? 1 : 0) + (unreadOnly ? 1 : 0);
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch("");
    setUnreadOnly(false);
  };

  return (
    <>
      <FeedToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t("searchPlaceholder")}
        searchAria={t("searchAria")}
        unreadOnly={unreadOnly}
        onUnreadOnly={setUnreadOnly}
        allLabel={tn("page.allFilter")}
        unreadLabel={tn("page.unreadFilter")}
        modeAria={tn("page.modeAria")}
        unreadCount={unreadCount}
        filters={
          <TeamFiltersButton
            filters={filters}
            setFilters={setFilters}
            count={popoverCount}
            sectionKeys={sectionKeys}
            sectionCounts={sectionCounts}
            countsHint={!!facets}
            staff={staff}
            me={me}
            traderOptions={traderOptions}
          />
        }
        end={
          <>
            {!staff && me && <Pill tone="neutral" dot>{t("onlyMine")}</Pill>}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("refresh")}
              title={t("refresh")}
              onClick={() => { feed.refetch(); summary.refetch(); }}
              disabled={feed.isFetching && !feed.isFetchingNextPage}
            >
              <RefreshCw className={feed.isRefetching && !feed.isFetchingNextPage ? "animate-spin motion-reduce:animate-none" : undefined} />
            </Button>
          </>
        }
        onReadAll={unreadCount > 0 ? markRead : undefined}
        readAllLabel={tn("bell.readAll")}
      />
      <ActiveFilters
        onReset={resetFilters}
        items={[
          ...filters.sections.map((s) => ({ key: `section:${s}`, label: sectionMeta(s).label, onRemove: () => toggleSection(s) })),
          filters.group !== "all" && { key: "group", label: actionGroupLabel(filters.group), onRemove: () => setFilters((f) => ({ ...f, group: "all" })) },
          staff && !!filters.trader && {
            key: "trader",
            label: filters.trader === me ? t("onlyMineFilter") : personName(filters.trader),
            onRemove: () => pickTrader(null),
          },
        ]}
      />

      <DigestCard
        summary={summary.data}
        loading={!digestDay || summary.isLoading}
        unavailable={summary.isError}
        day={digestDay}
        onDay={setDigestDay}
        onPickSection={pickSection}
        onPickTrader={(t) => pickTrader(t)}
        tradesHref={digestDay ? `${links.trades({ from: digestDay, to: digestDay })}${staff && filters.trader ? `&trader=${encodeURIComponent(filters.trader)}` : ""}` : undefined}
        journalHref={digestDay ? links.journalDay(digestDay, staff ? filters.trader ?? undefined : me ?? undefined) : undefined}
      />

      {feed.isError && <QueryError error={feed.error} onRetry={() => feed.refetch()} />}

      <Panel padded={false} bodyClassName="p-2 sm:p-3" aria-label={t("feedAria")}>
        {feed.isLoading ? (
          <div className="flex flex-col gap-2 p-2" aria-busy="true">
            <Skeleton className="h-6 w-24 rounded-full" />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-2 py-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 && !feed.isError ? (
          <EmptyState
            icon={Activity}
            title={activeFilterCount ? tc("states.nothingFound") : t("emptyTitle")}
            description={activeFilterCount ? t("emptyFiltered") : t("emptyHint")}
            action={activeFilterCount ? <Button variant="outline" onClick={resetFilters}>{tc("actions.resetFilters")}</Button> : undefined}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="sticky-top mb-1 ml-1 inline-flex rounded-full">
                  <span className="glass rounded-full px-3 py-1 text-xs font-semibold">{capFirst(g.label)}</span>
                </h3>
                <ul className="flex flex-col">
                  {g.bursts.map((b) =>
                    b.items.length >= 3 ? (
                      <BurstRow key={b.key} burst={b} isUnread={isUnread} />
                    ) : (
                      b.items.map((it) => <FeedRow key={it.uid} item={it} unread={isUnread(it)} />)
                    ),
                  )}
                </ul>
              </section>
            ))}
            <div ref={sentinel} className="flex min-h-14 items-center justify-center py-3">
              {hasNextPage ? (
                <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
                  {isFetchingNextPage ? tc("states.loading") : t("loadMore")}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t("end")}</span>
              )}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
