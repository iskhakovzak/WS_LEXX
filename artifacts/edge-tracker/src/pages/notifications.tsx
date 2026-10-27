/**
 * /notifications — the one place for feeds (design audit wave 2): tabs «Входящие» · «Команда» (the team activity feed,
 * formerly /activity) · «Архив», the notification settings behind the gear in the header. Every feed tab starts with the
 * same one-row toolbar (components/shared/feed-toolbar: search · «Все / Непрочитанные» · «Фильтры (n)» · «Прочитать
 * всё»); the inbox filters (severity, group/type) sit behind «Фильтры», active ones as chips under the row. Bulk read/archive, keyboard navigation (↑/↓ or J/K, Enter, R,
 * E, X, Esc). Reads ?tab=inbox|team|archive|prefs, ?unread=1, ?q=, ?type=a,b, ?severity=warn,critical from the URL.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Archive, ArrowLeft, Bell, CheckCheck, Inbox, Loader2, RefreshCw, Settings2, SquareCheckBig, SquareDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, Page, PageHeader, Panel, SectionTabs } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { FeedToolbar } from "@/components/shared/feed-toolbar";
import { TeamActivity } from "@/components/team/team-activity";
import { blockedSectionOf } from "@/components/shell/nav-model";
import { useAuth } from "@/contexts/auth-context";
import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationItem } from "@/components/notifications/notification-item";
import { NotificationPrefsPanel } from "@/components/notifications/notification-prefs";
import { ALL_GROUPS, InboxFiltersButton, InboxKeysHint, inboxActiveFilters, type GroupPick } from "@/components/notifications/inbox-filters";
import { ActiveFilters } from "@/components/shared/filters/filter-toolbar";
import {
  TYPES, groupByDay, type ListFilters, type Notification, type Severity,
} from "@/components/notifications/model";
import { useMe, useNotificationActions, useNotificationList, useOpenNotification, useUnreadCount } from "@/components/notifications/use-notifications";
import { UndoToast } from "@/components/undo-toast";
import { notificationsI18n } from "@/i18n/ns/notifications";
import { commonI18n } from "@/i18n/ns/common";

type Tab = "inbox" | "team" | "archive" | "prefs";

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || el.getAttribute("role") === "combobox";
}

function readUrl(): { tab: Tab; unread: boolean; q: string; types: string[]; severities: Severity[] } {
  const p = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const tab = p.get("tab");
  const sev = (p.get("severity") ?? "").split(",").filter((s): s is Severity => s === "info" || s === "warn" || s === "critical");
  return {
    tab: tab === "archive" || tab === "prefs" || tab === "team" ? tab : "inbox",
    unread: p.get("unread") === "1",
    q: (p.get("q") ?? "").slice(0, 100),
    types: (p.get("type") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    severities: sev,
  };
}

export default function NotificationsPage() {
  const { t } = notificationsI18n.useT();
  const { t: tc } = commonI18n.useT();
  const me = useMe();
  const initial = useMemo(readUrl, []);
  const { permissions } = useAuth();
  // The team feed is the old /activity section: closed for the viewer's stage → no «Команда» tab.
  const teamOpen = !blockedSectionOf("/activity", permissions.nav);
  const [tabPick, setTab] = useState<Tab>(initial.tab);
  const tab: Tab = tabPick === "team" && !teamOpen ? "inbox" : tabPick;
  const [unreadOnly, setUnreadOnly] = useState(initial.unread);
  const [search, setSearch] = useState(initial.q);
  const [q, setQ] = useState(initial.q.trim());
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const [group, setGroup] = useState<GroupPick>(ALL_GROUPS);
  const [types, setTypes] = useState<string[]>(initial.types);
  const [severities, setSeverities] = useState<Severity[]>(initial.severities);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const lastClickRef = useRef<number | null>(null);
  // «Отменить» for anything sent to the archive from the inbox (E, bulk, «Архивировать прочитанные»).
  const [undo, setUndo] = useState<{ ids: number[]; label: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the URL in sync (shareable filters, back/forward friendly).
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "inbox") p.set("tab", tab);
    if (unreadOnly && tab !== "team") p.set("unread", "1");
    if (q && tab !== "team") p.set("q", q);
    if (types.length) p.set("type", types.join(","));
    if (severities.length) p.set("severity", severities.join(","));
    const qs = p.toString();
    const next = `/notifications${qs ? `?${qs}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [tab, unreadOnly, q, types, severities]);

  const effectiveTypes = useMemo(() => {
    if (types.length) return types;
    if (group !== ALL_GROUPS) return TYPES.filter((t) => t.group === group).map((t) => t.type);
    return [];
  }, [types, group]);

  const filters: ListFilters = useMemo(
    () => ({ unread: tab === "inbox" && unreadOnly, q, types: effectiveTypes, severities, archived: tab === "archive" ? "1" : "0", limit: 40 }),
    [tab, unreadOnly, q, effectiveTypes, severities],
  );

  const list = useNotificationList(filters, tab === "inbox" || tab === "archive");
  const { data: count } = useUnreadCount();
  const actions = useNotificationActions();
  const open = useOpenNotification();
  const items = list.items;
  const groups = useMemo(() => groupByDay(items), [items]);

  // Reset selection/focus when the result set changes shape.
  useEffect(() => { setSelected(new Set()); setFocusIdx(-1); }, [list.params]);
  useEffect(() => {
    if (focusIdx >= 0 && focusIdx >= items.length) setFocusIdx(items.length - 1);
  }, [items.length, focusIdx]);

  const selectedIds = useMemo(() => items.filter((n) => selected.has(n.id)).map((n) => n.id), [items, selected]);
  const unreadSelected = useMemo(() => items.filter((n) => selected.has(n.id) && !n.isRead).length, [items, selected]);

  const toggleSelect = useCallback((n: Notification, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const idx = items.findIndex((x) => x.id === n.id);
      if (shift && lastClickRef.current != null) {
        const from = items.findIndex((x) => x.id === lastClickRef.current);
        if (from >= 0 && idx >= 0) {
          const [a, b] = from < idx ? [from, idx] : [idx, from];
          const add = !prev.has(n.id);
          for (let i = a; i <= b; i++) { if (add) next.add(items[i].id); else next.delete(items[i].id); }
          lastClickRef.current = n.id;
          return next;
        }
      }
      if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
      lastClickRef.current = n.id;
      return next;
    });
  }, [items]);

  const selectAll = () => setSelected(new Set(items.map((n) => n.id)));
  const clearSelection = () => setSelected(new Set());

  const onRead = useCallback((n: Notification, read: boolean) => (read ? actions.readMany.mutate([n.id]) : actions.unreadMany.mutate([n.id])), [actions.readMany, actions.unreadMany]);
  const onArchive = useCallback((n: Notification, archive: boolean) => {
    if (archive) {
      actions.archive.mutate([n.id]);
      setUndo({ ids: [n.id], label: notificationsI18n.t("page.one") });
    } else {
      actions.unarchive.mutate([n.id]);
    }
  }, [actions.archive, actions.unarchive]);
  const archiveSelected = () => {
    if (!selectedIds.length) return;
    actions.archive.mutate(selectedIds);
    setUndo({ ids: selectedIds, label: notificationsI18n.t("page.count", { count: selectedIds.length }) });
    clearSelection();
  };
  const archiveAllRead = () => {
    actions.archiveRead.mutate(undefined, {
      onSuccess: (r) => {
        const ids = (r as { ids?: number[] } | undefined)?.ids ?? [];
        if (ids.length) setUndo({ ids, label: notificationsI18n.t("page.count", { count: ids.length }) });
      },
    });
  };

  // Keyboard navigation.
  useEffect(() => {
    if (tab === "prefs" || tab === "team") return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const move = (d: number) => {
        e.preventDefault();
        setFocusIdx((i) => {
          const next = Math.max(0, Math.min(items.length - 1, (i < 0 ? (d > 0 ? -1 : items.length) : i) + d));
          const el = listRef.current?.querySelector<HTMLElement>(`[data-notification-id="${items[next]?.id}"]`);
          el?.scrollIntoView({ block: "nearest" });
          return next;
        });
      };
      const cur = focusIdx >= 0 ? items[focusIdx] : null;
      switch (e.key) {
        case "ArrowDown": case "j": move(1); break;
        case "ArrowUp": case "k": move(-1); break;
        case "Home": e.preventDefault(); setFocusIdx(items.length ? 0 : -1); break;
        case "End": e.preventDefault(); setFocusIdx(items.length - 1); break;
        case "Enter": if (cur) { e.preventDefault(); open(cur); } break;
        case "r": if (cur) onRead(cur, !cur.isRead); break;
        case "e": if (cur) onArchive(cur, !cur.archivedAt); break;
        case "x": if (cur) { e.preventDefault(); toggleSelect(cur, e.shiftKey); } break;
        case "a": if (e.shiftKey) { e.preventDefault(); selectAll(); } break;
        case "Escape": if (selected.size) clearSelection(); else setFocusIdx(-1); break;
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, items, focusIdx, selected.size, open, onRead, onArchive, toggleSelect]);

  const unread = count?.unread ?? 0;

  if (!me) {
    return (
      <Page>
        <PageHeader title={t("title")} icon={Bell} />
        <Panel><EmptyState icon={Bell} title={t("page.guestTitle")} description={t("page.guestDescription")} /></Panel>
      </Page>
    );
  }

  const filtersOn = !!(unreadOnly || q || severities.length || group !== ALL_GROUPS || types.length);
  const resetAll = () => { setUnreadOnly(false); setSearch(""); setSeverities([]); setGroup(ALL_GROUPS); setTypes([]); };
  const inboxFilterProps = { severities, setSeverities, group, setGroup, types, setTypes };

  return (
    <Page>
      <PageHeader
        title={t("title")}
        icon={Bell}
        description={tab === "team" ? undefined : unread > 0 ? `${t("page.unread", { count: unread })}${count?.critical ? ` · ${t("page.critical", { count: count.critical })}` : ""}` : t("page.allRead")}
        actions={tab === "prefs" ? (
          <Button variant="outline" size="sm" onClick={() => setTab("inbox")}><ArrowLeft aria-hidden="true" /> {t("page.inbox")}</Button>
        ) : (
          <>
            {tab !== "team" && (
              <button type="button" onClick={() => list.refetch()} className="chip grid h-9 w-9 place-items-center" title={tc("actions.refresh")} aria-label={tc("actions.refresh")}>
                <RefreshCw className={cn("h-4 w-4", list.isFetching && "motion-safe:animate-spin")} aria-hidden="true" />
              </button>
            )}
            {tab === "inbox" && (
              <button type="button" onClick={archiveAllRead} disabled={actions.archiveRead.isPending} className="chip inline-flex h-9 min-w-9 items-center justify-center gap-1.5 px-2.5 text-sm font-medium disabled:opacity-50 sm:px-3" title={t("page.archiveReadTitle")} aria-label={t("page.archiveRead")}>
                {/* Phones: icon only, so the header actions stay on one line. */}
                <Archive className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">{t("page.archiveRead")}</span>
              </button>
            )}
            {/* Settings are configuration, not a feed: the gear, not a tab next to the inbox (design audit). */}
            <button type="button" onClick={() => setTab("prefs")} className="chip grid h-9 w-9 place-items-center" title={t("page.settings")} aria-label={t("page.settings")}>
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      >
        {tab !== "prefs" && (
          <SectionTabs
            ariaLabel={t("page.section")}
            value={tab}
            onChange={(v) => { setTab(v); clearSelection(); }}
            tabs={[
              { value: "inbox", label: t("page.inbox"), icon: Inbox, count: unread || undefined },
              ...(teamOpen ? [{ value: "team" as const, label: t("page.team"), icon: Activity }] : []),
              { value: "archive", label: t("page.archive"), icon: Archive },
            ]}
          />
        )}
      </PageHeader>

      {tab === "prefs" ? (
        <NotificationPrefsPanel />
      ) : tab === "team" ? (
        <TeamActivity />
      ) : (
        <>
          <FeedToolbar
            search={search}
            onSearch={setSearch}
            placeholder={t("page.searchPlaceholder")}
            searchAria={t("page.searchAria")}
            unreadOnly={tab === "inbox" ? unreadOnly : null}
            onUnreadOnly={setUnreadOnly}
            allLabel={t("page.allFilter")}
            unreadLabel={t("page.unreadFilter")}
            modeAria={t("page.modeAria")}
            unreadCount={unread}
            filters={<InboxFiltersButton {...inboxFilterProps} />}
            end={<InboxKeysHint />}
            onReadAll={tab === "inbox" && unread > 0 ? () => actions.readAll.mutate(undefined) : undefined}
            readAllLabel={t("bell.readAll")}
            readAllPending={actions.readAll.isPending}
          />
          <ActiveFilters items={inboxActiveFilters(inboxFilterProps)} onReset={resetAll} />

          {selected.size > 0 && (
            <div className="glass-panel sticky-top flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
              <span className="text-sm font-medium text-foreground">{tc("states.selected", { count: selectedIds.length })}</span>
              {tab === "inbox" && unreadSelected > 0 && (
                <button type="button" onClick={() => actions.readMany.mutate(selectedIds)} disabled={actions.readMany.isPending} className="chip inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium disabled:opacity-50">
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.readSelected", { count: unreadSelected })}
                </button>
              )}
              {tab === "inbox" && unreadSelected < selectedIds.length && (
                <button type="button" onClick={() => actions.unreadMany.mutate(selectedIds)} disabled={actions.unreadMany.isPending} className="chip inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium disabled:opacity-50">
                  {t("page.markUnread")}
                </button>
              )}
              {tab === "inbox" ? (
                <button type="button" onClick={archiveSelected} className="chip inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium">
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.toArchive")}
                </button>
              ) : (
                <button type="button" onClick={() => { actions.unarchive.mutate(selectedIds); clearSelection(); }} disabled={actions.unarchive.isPending} className="chip inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium disabled:opacity-50">
                  {t("page.toInbox")}
                </button>
              )}
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={selectAll} className="chip inline-flex h-8 items-center gap-1.5 px-2.5 text-xs" title={t("page.selectAllTitle")}>
                  <SquareCheckBig className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.selectAll")}
                </button>
                <button type="button" onClick={clearSelection} className="chip inline-flex h-8 items-center gap-1.5 px-2.5 text-xs" title={t("page.clearTitle")}>
                  <SquareDashed className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.clear")}
                </button>
              </span>
            </div>
          )}

          <Panel padded={false} bodyClassName="p-1.5 sm:p-2" className="min-h-[50vh]">
            {list.isLoading ? (
              <div className="space-y-2 p-2" aria-busy="true">
                {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            ) : list.isError ? (
              <QueryError error={list.error} onRetry={() => list.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={tab === "archive" ? Archive : Inbox}
                title={q ? tc("states.nothingFound") : tab === "archive" ? t("page.archiveEmpty") : unreadOnly ? t("page.noUnread") : t("page.empty")}
                description={tab === "archive" ? t("page.archiveEmptyHint") : t("page.emptyHint")}
                action={filtersOn ? (
                  <button type="button" onClick={resetAll} className="chip h-8 px-3 text-xs font-medium">{tc("actions.resetFilters")}</button>
                ) : undefined}
              />
            ) : (
              <div ref={listRef} role="list" aria-label={t("page.listAria")}>
                {groups.map((g) => (
                  <section key={g.key} aria-label={g.label} className="pb-1">
                    <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
                      <h3 className="micro-label">{g.label}</h3>
                      <span className="text-2xs tabular-nums text-muted-foreground">{g.items.length}</span>
                    </div>
                    <ul className="space-y-0.5">
                      {g.items.map((n) => {
                        const idx = items.indexOf(n);
                        return (
                          <li key={n.id} role="listitem">
                            <NotificationItem
                              n={n}
                              variant="full"
                              selected={selected.has(n.id)}
                              focused={idx === focusIdx}
                              onOpen={(x) => { setFocusIdx(idx); open(x); }}
                              onToggleSelect={toggleSelect}
                              onRead={onRead}
                              onArchive={onArchive}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
                {list.hasNextPage && (
                  <div className="flex justify-center py-3">
                    <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="chip inline-flex h-9 items-center gap-2 px-4 text-sm font-medium disabled:opacity-50">
                      {list.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      {tc("actions.showMore")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </>
      )}
      {undo && (
        <UndoToast
          key={undo.ids.join(",")}
          label={undo.label}
          actionText={tc("undo.archived")}
          restoring={actions.unarchive.isPending}
          onUndo={() => actions.unarchive.mutate(undo.ids, { onSettled: () => setUndo(null) })}
          onDismiss={() => setUndo(null)}
        />
      )}
      <p className="sr-only" aria-live="polite">{unread > 0 ? t("page.srUnread", { count: unread }) : t("page.srNone")}</p>
    </Page>
  );
}
