/**
 * Плейбук — setups in three spaces:
 *   «Офис»  — the office playbook (curators edit, everyone reads);
 *   «Мой»   — the viewer's personal setups (private by default);
 *   «Общие» — personal setups other people (seniors) shared with the viewer; «Команда» — all other personal setups (staff only).
 * Library view: left column (space switcher, search, one filter row, folder tree) + setup card with tabs
 * «Описание / Эталоны / Статистика / История». Other views: «Эталоны» gallery and a card grid.
 * URL: ?id= (setup), ?tab= (setup tab); ?q= and ?highlight= from links / global search are honoured.
 * Example trades can be dragged from the «Эталоны» board onto a setup row in the tree to move them.
 */
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Activity, BookOpen, Building2, ChevronsDownUp, ChevronsUpDown, Columns2, Download, FileArchive, HelpCircle, LayoutGrid,
  Library, MoreHorizontal, Plus, Search, Send, Share2, Tag, Trophy, User, Users, X, ZoomIn, ZoomOut, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToastAction } from "@/components/ui/toast";
import { EmptyState, Kbd, Page, PageHeader, Segmented, Toolbar } from "@/components/ds";
import { IconAction, lsGet, lsSet, plural } from "@/components/playbook-sub/bits";
import { useToast } from "@/hooks/use-toast";
import { localDateString } from "@/lib/local-date";
import { cn } from "@/lib/utils";
import { generatePlaybookMarkdown, downloadMarkdown, generateNotionZip, downloadBlob, type ExportEntry } from "@/lib/playbook-export";
import {
  invalidateExamples, invalidatePlaybook, notLiveMessage, pbRequest, useFolderSettings, usePlaybookEntries, usePlaybookSummary, usePlaybookViewer,
} from "@/components/playbook/api";
import {
  LS, accessOf, matchesQuickFilter, searchHaystack, sortEntries, spaceTabOf, splitTags,
  type PlaybookEntry, type QuickFilter, type SortKey, type SpaceTab,
} from "@/components/playbook/model";
import { FolderTree, type FolderGroup } from "@/components/playbook/folder-tree";
import { SetupView, SETUP_TABS, type SetupTab } from "@/components/playbook/setup-view";
import { Overview, SetupCard } from "@/components/playbook/overview";
import { Gallery } from "@/components/playbook/gallery";
import { SetupFormDialog, type FormMode } from "@/components/playbook/setup-form-dialog";
import { CompareDialog } from "@/components/playbook/compare-dialog";
import { QuickFind } from "@/components/playbook/quick-find";
import { TradePickerDialog } from "@/components/playbook/trade-picker-dialog";
import { ShareDialog } from "@/components/playbook/share-dialog";
import { hasExampleDrag, patchExample, readExampleDrag } from "@/components/playbook/examples-board";
import { ActivitySheet, DeleteFolderDialog, DeleteSetupDialog, RenameFolderDialog } from "@/components/playbook/page-dialogs";

type View = "library" | "gallery" | "grid";
const VIEWS: View[] = ["library", "gallery", "grid"];
const UNFILED = "__unfiled";
const LS_SPACE = "playbook-space";

/** `short` is what the closed select shows (the sidebar is 320px); `label` is the menu item. */
const SORT_OPTIONS: { value: SortKey; label: string; short: string }[] = [
  { value: "folder", label: "По папкам", short: "Папки" },
  { value: "edge", label: "По edge, $ на сделку", short: "Edge $" },
  { value: "used", label: "Недавно в работе", short: "Недавние" },
  { value: "new", label: "Новые сверху", short: "Новые" },
  { value: "name", label: "По алфавиту", short: "А–Я" },
];
const FILTERS: { value: QuickFilter; label: string; short: string }[] = [
  { value: "all", label: "Все сетапы", short: "Все сетапы" },
  { value: "today", label: "В работе сегодня", short: "Сегодня" },
  { value: "edge", label: "С плюсовым edge", short: "С edge" },
  { value: "untested", label: "Без сделок", short: "Без сделок" },
  { value: "noExamples", label: "Без эталонов", short: "Без эталонов" },
  { value: "unreviewed", label: "Не проверены", short: "На проверку" },
];
const SPACES: { value: SpaceTab; label: string; icon: LucideIcon; hint: string }[] = [
  { value: "office", label: "Офис", icon: Building2, hint: "Плейбук офиса — правят кураторы, читают все" },
  { value: "mine", label: "Мой", icon: User, hint: "Ваши сетапы — видите вы и кураторы" },
  { value: "shared", label: "Общие", icon: Share2, hint: "Сетапы, которыми с вами поделились" },
  { value: "team", label: "Команда", icon: Users, hint: "Личные сетапы трейдеров (видно кураторам)" },
];
const HOTKEYS: [string[], string][] = [
  [["Ctrl", "K"], "Быстрый поиск сетапа"],
  [["/"], "Быстрый поиск"],
  [["J", "K"], "Следующий / предыдущий сетап"],
  [["N"], "Новый сетап"],
  [["E"], "Редактировать открытый"],
  [["C"], "Сравнить сетапы"],
  [["Esc"], "Закрыть сетап"],
  [["1", "2", "3"], "Эталон: сменить тир (на карточке)"],
  [["Alt", "↑↓"], "Эталон: переставить"],
  [["M"], "Эталон: перенести в другой сетап"],
  [["Ctrl", "V"], "Вставить скриншот в описание или эталон"],
];

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
function overlayOpen() {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]');
}
const isView = (v: unknown): v is View => VIEWS.includes(v as View);
const isSpace = (v: unknown): v is SpaceTab => SPACES.some((s) => s.value === v);
const isSetupTab = (v: unknown): v is SetupTab => SETUP_TABS.includes(v as SetupTab);

export default function Playbook() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const viewer = usePlaybookViewer();
  const trader = user?.traderName ?? "system";
  const [, navigate] = useLocation();
  const searchStr = useSearch();

  /* ---------- data ---------- */
  const { data: entries = [], isLoading, isError, error, refetch } = usePlaybookEntries();
  const summaryQ = usePlaybookSummary();
  const summary = summaryQ.map;
  const { data: folderSettings } = useFolderSettings();
  /** New API is running (spaces / examples / stats). Older API: client-side fallbacks and friendly «после обновления сервера» states. */
  const live = viewer.live || entries.some((e) => !!e.access);

  /* ---------- persisted UI state ---------- */
  const [view, setViewState] = useState<View>(() => { const v = lsGet<string>(LS.view, "library"); return isView(v) ? v : "library"; });
  const [space, setSpaceState] = useState<SpaceTab>(() => { const v = lsGet<string>(LS_SPACE, "office"); return isSpace(v) ? v : "office"; });
  const [sort, setSortState] = useState<SortKey>(() => lsGet<SortKey>(LS.sort, "folder"));
  const [quick, setQuickState] = useState<QuickFilter>(() => { const v = lsGet<string>(LS.filter, "all"); return FILTERS.some((f) => f.value === v) ? (v as QuickFilter) : "all"; });
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(lsGet<string[]>(LS.openFolders, [])));
  const [folderOrder, setFolderOrder] = useState<string[]>(() => lsGet<string[]>(LS.folderOrder, []));
  const [folderColors, setFolderColors] = useState<Record<string, number>>(() => lsGet<Record<string, number>>(LS.folderColors, {}));
  const [zoom, setZoom] = useState<number>(() => {
    const z = Number(lsGet<number | string>(LS.zoom, 1));
    return Number.isFinite(z) && z > 0 ? z : 1;
  });
  const [recentIds, setRecentIds] = useState<number[]>(() => lsGet<number[]>(LS.recent, []));
  const setView = (v: View) => { setViewState(v); lsSet(LS.view, v); };
  const setSpace = (v: SpaceTab) => { setSpaceState(v); lsSet(LS_SPACE, v); };
  const setSort = (v: SortKey) => { setSortState(v); lsSet(LS.sort, v); };
  const setQuick = (v: QuickFilter) => { setQuickState(v); lsSet(LS.filter, v); };

  /* ---------- transient UI state ---------- */
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [deleting, setDeleting] = useState<PlaybookEntry | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [renameFolder, setRenameFolder] = useState<string | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<string | null>(null);
  const [deleteFolderPending, setDeleteFolderPending] = useState(false);
  const [compareFor, setCompareFor] = useState<PlaybookEntry | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [pickerFor, setPickerFor] = useState<PlaybookEntry | null>(null);
  const [shareFor, setShareFor] = useState<PlaybookEntry | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  /* ---------- server folder settings → local (colors + order) ---------- */
  useEffect(() => {
    if (!folderSettings?.length) return;
    const colors: Record<string, number> = {};
    for (const s of folderSettings) if (s.colorIndex != null) colors[s.folderName] = s.colorIndex;
    if (Object.keys(colors).length) { setFolderColors(colors); lsSet(LS.folderColors, colors); }
    const fromServer = [...folderSettings].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.folderName);
    setFolderOrder((prev) => {
      const merged = [...fromServer, ...prev.filter((n) => !fromServer.includes(n))];
      lsSet(LS.folderOrder, merged);
      return merged;
    });
  }, [folderSettings]);

  /* ---------- spaces ---------- */
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const tabOf = useMemo(() => new Map(entries.map((e) => [e.id, spaceTabOf(e, viewer)])), [entries, viewer]);
  const spaceCounts = useMemo(() => {
    const c: Record<SpaceTab, number> = { office: 0, mine: 0, shared: 0, team: 0 };
    for (const e of entries) if (!e.parentId || !byId.has(e.parentId)) c[tabOf.get(e.id) ?? "office"]++;
    return c;
  }, [entries, byId, tabOf]);
  const visibleSpaces = SPACES.filter((s) => s.value !== "team" || (viewer.isCurator && spaceCounts.team > 0));
  // A remembered «Команда» tab that is no longer available falls back to «Офис».
  const activeSpace: SpaceTab = visibleSpaces.some((s) => s.value === space) ? space : "office";
  const proposed = useMemo(
    () => (viewer.isCurator ? entries.filter((e) => e.officeProposedAt && tabOf.get(e.id) !== "office") : []),
    [entries, tabOf, viewer.isCurator],
  );

  /** Setups of the active space (variants follow their parent). */
  const spaceEntries = useMemo(
    () => entries.filter((e) => {
      const root = e.parentId ? byId.get(e.parentId) ?? e : e;
      return (tabOf.get(root.id) ?? "office") === activeSpace;
    }),
    [entries, byId, tabOf, activeSpace],
  );

  /* ---------- derived (within the active space) ---------- */
  // Children whose parent was deleted are treated as top-level.
  const topLevel = useMemo(() => spaceEntries.filter((e) => !e.parentId || !byId.has(e.parentId)), [spaceEntries, byId]);

  const allFolders = useMemo(() => {
    const present = new Set(topLevel.map((e) => e.folder).filter(Boolean) as string[]);
    return [...folderOrder.filter((f) => present.has(f)), ...[...present].filter((f) => !folderOrder.includes(f)).sort((a, b) => a.localeCompare(b, "ru"))];
  }, [topLevel, folderOrder]);
  /** Every folder name (all spaces) — for the setup form's folder picker. */
  const everyFolder = useMemo(() => [...new Set(entries.map((e) => e.folder).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ru")), [entries]);

  const folderTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of topLevel) { const k = e.folder ?? UNFILED; m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [topLevel]);

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of spaceEntries) for (const t of splitTags(e.tags)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  }, [spaceEntries]);

  const q = query.trim().toLowerCase();
  const passes = useCallback(
    (e: PlaybookEntry) => {
      if (!matchesQuickFilter(e, quick, summary)) return false;
      if (tagFilter.length) {
        const t = splitTags(e.tags);
        if (!tagFilter.every((x) => t.includes(x))) return false;
      }
      if (q && !q.split(/\s+/).every((term) => searchHaystack(e).includes(term))) return false;
      return true;
    },
    [quick, summary, tagFilter, q],
  );

  const quickCounts = useMemo(() => {
    const c = {} as Record<QuickFilter, number>;
    for (const f of FILTERS) c[f.value] = 0;
    for (const e of topLevel) for (const f of FILTERS) if (matchesQuickFilter(e, f.value, summary)) c[f.value]++;
    return c;
  }, [topLevel, summary]);

  const filtering = !!q || quick !== "all" || tagFilter.length > 0;

  const childrenOf = useMemo(() => {
    const m = new Map<number, PlaybookEntry[]>();
    for (const e of spaceEntries) {
      if (!e.parentId || !byId.has(e.parentId)) continue;
      if (filtering && !passes(e)) continue;
      const arr = m.get(e.parentId) ?? [];
      arr.push(e);
      m.set(e.parentId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return m;
  }, [spaceEntries, byId, filtering, passes]);

  const flat = useMemo(() => {
    if (!q && sort === "folder") return null;
    return sortEntries(spaceEntries.filter(passes), sort === "folder" ? "name" : sort, summary);
  }, [q, sort, spaceEntries, passes, summary]);

  const groups: FolderGroup[] = useMemo(() => {
    if (flat) return [];
    const keys = [...allFolders, UNFILED];
    const out: FolderGroup[] = [];
    for (const k of keys) {
      const inFolder = topLevel.filter((e) => (e.folder ?? UNFILED) === k);
      const shown = inFolder
        .filter((e) => !filtering || passes(e) || (childrenOf.get(e.id)?.length ?? 0) > 0)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      if (filtering && shown.length === 0) continue;
      if (inFolder.length === 0) continue;
      out.push({ folder: k === UNFILED ? null : k, entries: shown, total: folderTotals.get(k) ?? 0 });
    }
    return out;
  }, [flat, allFolders, topLevel, filtering, passes, childrenOf, folderTotals]);

  /** Visible order for J/K navigation. */
  const navOrder = useMemo(() => {
    if (flat) return flat.map((e) => e.id);
    const ids: number[] = [];
    for (const g of groups) for (const e of g.entries) { ids.push(e.id); for (const c of childrenOf.get(e.id) ?? []) ids.push(c.id); }
    return ids;
  }, [flat, groups, childrenOf]);

  /* ---------- selection via URL (?id=, ?tab=, ?q=) ---------- */
  const params = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const selectedId = Number(params.get("id")) || null;
  const tabParam = params.get("tab");
  const setupTab: SetupTab = isSetupTab(tabParam) ? tabParam : "about";
  const urlQuery = params.get("q") ?? "";
  useEffect(() => {
    if (!urlQuery) return;
    setQuery(urlQuery);
    setViewState("library");
    // Consume the param so clearing the box doesn't re-apply it on the next render.
    const next = new URLSearchParams(params);
    next.delete("q");
    const s = next.toString();
    navigate(`/playbook${s ? `?${s}` : ""}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  // Opening a setup from another space (link, search, «В Офис» result) switches the sidebar to its space.
  useEffect(() => {
    if (!selected) return;
    const root = selected.parentId ? byId.get(selected.parentId) ?? selected : selected;
    const t = tabOf.get(root.id);
    if (t && t !== activeSpace && (t !== "team" || viewer.isCurator)) setSpace(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, tabOf]);

  const rememberRecent = useCallback((id: number) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 12);
      lsSet(LS.recent, next);
      return next;
    });
  }, []);

  const openSetup = useCallback(
    (id: number | null, opts?: { replace?: boolean; tab?: SetupTab }) => {
      if (id == null) { navigate("/playbook", { replace: opts?.replace }); return; }
      const e = byId.get(id);
      if (e) {
        const root = e.parentId ? byId.get(e.parentId) ?? e : e;
        const key = root.folder ?? UNFILED;
        setOpenFolders((prev) => {
          if (prev.has(key)) return prev;
          const next = new Set(prev); next.add(key); lsSet(LS.openFolders, [...next]); return next;
        });
      }
      rememberRecent(id);
      const tab = opts?.tab && opts.tab !== "about" ? `&tab=${opts.tab}` : "";
      navigate(`/playbook?id=${id}${tab}`, { replace: opts?.replace });
    },
    [navigate, byId, rememberRecent],
  );
  const openFromElsewhere = useCallback((id: number, tab?: SetupTab) => { setView("library"); openSetup(id, { tab }); }, [openSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?highlight= (global search, other sections) → ?id=
  useEffect(() => {
    const h = Number(params.get("highlight"));
    if (!h || !entries.length) return;
    if (byId.has(h)) { setView("library"); openSetup(h, { replace: true }); }
    else { navigate("/playbook", { replace: true }); toast({ title: "Сетап не найден", description: "Возможно, он был удалён или к нему нет доступа." }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, entries.length]);

  // Same-page navigation from the global search.
  useEffect(() => {
    function onNav(e: Event) {
      const d = (e as CustomEvent<{ path?: string; highlightId?: number }>).detail ?? {};
      if (!d.highlightId || (d.path && d.path !== "/playbook")) return;
      if (byId.has(Number(d.highlightId))) { setView("library"); openSetup(Number(d.highlightId), { replace: true }); }
    }
    window.addEventListener("ws-search-navigate", onNav);
    return () => window.removeEventListener("ws-search-navigate", onNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, openSetup]);

  // Keep the selected row visible in the tree.
  useEffect(() => {
    if (!selectedId) return;
    const t = window.setTimeout(() => {
      document.querySelector(`[data-setup-row="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [selectedId, view, activeSpace]);

  /* ---------- folder ops ---------- */
  const toggleFolder = (key: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      lsSet(LS.openFolders, [...next]);
      return next;
    });
  };
  const allOpen = groups.length > 0 && groups.every((g) => openFolders.has(g.folder ?? UNFILED));
  const toggleAll = () => {
    const next = allOpen ? new Set<string>() : new Set(groups.map((g) => g.folder ?? UNFILED));
    setOpenFolders(next);
    lsSet(LS.openFolders, [...next]);
  };
  /** Folder actions: office folders — curators; «Мой» — the owner. Shared / team folders are read-only here. */
  const canManageFolders = activeSpace === "office" ? viewer.isCurator : activeSpace === "mine" ? viewer.canEdit : false;

  async function saveFolderSettings(body: { folderName: string; colorIndex?: number; sortOrder?: number }[], errTitle: string) {
    try {
      await pbRequest("/api/playbook/folder-settings", { method: "PATCH", json: body });
      qc.invalidateQueries({ queryKey: ["playbook-folder-settings"] });
    } catch {
      toast({ title: errTitle, variant: "destructive" });
    }
  }
  function setFolderColor(folder: string, idx: number) {
    setFolderColors((prev) => { const next = { ...prev, [folder]: idx }; lsSet(LS.folderColors, next); return next; });
    saveFolderSettings([{ folderName: folder, colorIndex: idx }], "Не удалось сохранить цвет папки");
  }
  function moveFolder(folder: string, delta: -1 | 1) {
    const order = [...allFolders];
    const from = order.indexOf(folder);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    const rest = folderOrder.filter((f) => !order.includes(f));
    const merged = [...order, ...rest];
    setFolderOrder(merged);
    lsSet(LS.folderOrder, merged);
    saveFolderSettings(merged.map((f, i) => ({ folderName: f, sortOrder: i })), "Не удалось сохранить порядок папок");
  }
  function onFolderRenamed(from: string, to: string, merged: boolean) {
    setFolderOrder((prev) => {
      const next = merged ? prev.filter((f) => f !== from) : prev.map((f) => (f === from ? to : f));
      lsSet(LS.folderOrder, next);
      return next;
    });
    setFolderColors((prev) => {
      if (prev[from] === undefined) return prev;
      const next = { ...prev };
      if (!merged || next[to] === undefined) next[to] = prev[from];
      delete next[from];
      lsSet(LS.folderColors, next);
      return next;
    });
    setOpenFolders((prev) => {
      if (!prev.has(from)) return prev;
      const next = new Set(prev); next.delete(from); next.add(to); lsSet(LS.openFolders, [...next]); return next;
    });
    invalidatePlaybook(qc);
    toast({ title: merged ? `Папки объединены в «${to}»` : `Папка переименована в «${to}»` });
  }
  async function confirmDeleteFolder(password: string) {
    if (!deleteFolder) return;
    setDeleteFolderPending(true);
    try {
      const r = await pbRequest<{ deleted?: number }>("/api/playbook/delete-folder", {
        method: "DELETE",
        json: { folder: deleteFolder, password, trader },
      });
      invalidatePlaybook(qc);
      if (selected && selected.folder === deleteFolder) openSetup(null, { replace: true });
      toast({ title: `Папка «${deleteFolder}» удалена`, description: r?.deleted != null ? `${r.deleted} ${plural(r.deleted, "сетап", "сетапа", "сетапов")} в корзине` : undefined });
      setDeleteFolder(null);
    } catch (e: any) {
      toast({ title: "Не удалось удалить папку", description: e?.message, variant: "destructive" });
    } finally {
      setDeleteFolderPending(false);
    }
  }

  /* ---------- setup ops ---------- */
  async function restore(id: number) {
    try {
      await pbRequest(`/api/playbook/${id}/restore`, { method: "POST", json: { trader } });
      invalidatePlaybook(qc, id);
      toast({ title: "Сетап восстановлен" });
    } catch (e: any) {
      toast({ title: "Не удалось восстановить", description: e?.message, variant: "destructive" });
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    const { id, name } = deleting;
    setDeletePending(true);
    try {
      await pbRequest(`/api/playbook/${id}`, { method: "DELETE", json: { trader } });
      invalidatePlaybook(qc, id);
      if (selectedId === id) openSetup(null, { replace: true });
      setDeleting(null);
      toast({ title: `«${name}» удалён`, action: <ToastAction altText="Отменить удаление" onClick={() => restore(id)}>Отменить</ToastAction> });
    } catch (e: any) {
      toast({ title: "Не удалось удалить", description: e?.message, variant: "destructive" });
    } finally {
      setDeletePending(false);
    }
  }

  /* ---------- drag an example onto a setup row → move it there ---------- */
  const rowFromEvent = (e: DragEvent): number | null => {
    const el = (e.target as HTMLElement | null)?.closest?.("[data-setup-row]") as HTMLElement | null;
    const id = el ? Number(el.dataset.setupRow) : NaN;
    return Number.isInteger(id) ? id : null;
  };
  const canDropOn = (id: number | null) => {
    const t = id != null ? byId.get(id) : null;
    return !!t && accessOf(t, viewer).canAddExamples;
  };
  function onTreeDragOver(e: DragEvent) {
    if (!hasExampleDrag(e.dataTransfer)) return;
    const id = rowFromEvent(e);
    if (!canDropOn(id)) { if (dropTarget != null) setDropTarget(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== id) setDropTarget(id);
  }
  function onTreeDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropTarget(null);
  }
  async function onTreeDrop(e: DragEvent) {
    const target = rowFromEvent(e);
    setDropTarget(null);
    const p = readExampleDrag(e.dataTransfer);
    if (!p || target == null || target === p.fromSetupId || !canDropOn(target)) return;
    e.preventDefault();
    const name = byId.get(target)?.name ?? `#${target}`;
    try {
      const r = await patchExample(p.fromSetupId, p.exampleId, { playbookId: target });
      invalidateExamples(qc, p.fromSetupId, target);
      toast({
        title: r?.merged ? `Сделка уже была в «${name}» — объединено` : `Эталон перенесён в «${name}»`,
        action: r?.merged ? undefined : (
          <ToastAction
            altText="Вернуть"
            onClick={async () => {
              try { await patchExample(target, p.exampleId, { playbookId: p.fromSetupId }); invalidateExamples(qc, p.fromSetupId, target); }
              catch (err) { toast({ title: "Не удалось вернуть", description: (err as Error)?.message, variant: "destructive" }); }
            }}
          >
            Вернуть
          </ToastAction>
        ),
      });
    } catch (err) {
      toast({ title: "Не удалось перенести", description: notLiveMessage(err) ?? (err as Error)?.message, variant: "destructive" });
    }
  }

  /* ---------- export / zoom ---------- */
  function exportMd() {
    if (!spaceEntries.length) return;
    try {
      downloadMarkdown(generatePlaybookMarkdown(spaceEntries as unknown as ExportEntry[], allFolders), `playbook-${localDateString()}.md`);
      toast({ title: "Плейбук экспортирован", description: `${topLevel.length} ${plural(topLevel.length, "сетап", "сетапа", "сетапов")} в .md` });
    } catch (e: any) {
      toast({ title: "Не удалось экспортировать", description: e?.message, variant: "destructive" });
    }
  }
  async function exportNotion() {
    if (!spaceEntries.length || notionBusy) return;
    setNotionBusy(true);
    try {
      downloadBlob(await generateNotionZip(spaceEntries as unknown as ExportEntry[], allFolders), `playbook-notion-${localDateString()}.zip`);
      toast({ title: "ZIP для Notion готов", description: "Notion → Import → Markdown & CSV" });
    } catch (e: any) {
      toast({ title: "Не удалось экспортировать в Notion", description: e?.message, variant: "destructive" });
    } finally {
      setNotionBusy(false);
    }
  }
  const changeZoom = (delta: number) => {
    setZoom((prev) => {
      const next = delta === 0 ? 1 : Math.min(1.5, Math.max(0.65, Math.round((prev + delta) * 20) / 20));
      lsSet(LS.zoom, next);
      return next;
    });
  };

  /** New setups go to «Офис» only from the office tab and only for curators; otherwise to «Мой». */
  const newSpace = activeSpace === "office" && viewer.isCurator ? "office" : "personal";
  const canCreate = viewer.canEdit;
  const newSetup = useCallback(
    (folder?: string | null) => { if (canCreate) setFormMode({ kind: "create", folder: folder ?? null, space: newSpace }); },
    [canCreate, newSpace],
  );
  const newLabel = newSpace === "office" ? "Новый сетап" : "Новый в «Мой»";

  /* ---------- keyboard ---------- */
  // Ctrl/⌘+K inside the section opens the playbook's own quick find (capture phase, before the global palette).
  useEffect(() => {
    function onCapture(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "k" && e.key !== "K" && e.key !== "л" && e.key !== "Л") return;
      if (overlayOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // the global palette listens on window (bubble) — the section's own search wins here
      setFindOpen(true);
    }
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || overlayOpen()) return;
      const k = e.key;
      if (k === "/") { e.preventDefault(); setFindOpen(true); return; }
      if (k === "?") { e.preventDefault(); setHelpOpen((v) => !v); return; }
      if (k === "n" || k === "т") { if (canCreate) { e.preventDefault(); newSetup(selected?.folder ?? null); } return; }
      if (k === "Escape" && selected) { e.preventDefault(); openSetup(null); return; }
      if ((k === "e" || k === "у") && selected && accessOf(selected, viewer).canEdit) { e.preventDefault(); setFormMode({ kind: "edit", entry: selected }); return; }
      if ((k === "c" || k === "с") && selected) { e.preventDefault(); setCompareFor(selected); return; }
      if (k === "j" || k === "k" || k === "о" || k === "л") {
        if (!navOrder.length) return;
        e.preventDefault();
        const down = k === "j" || k === "о";
        const i = selectedId ? navOrder.indexOf(selectedId) : -1;
        const next = i < 0 ? (down ? 0 : navOrder.length - 1) : Math.min(navOrder.length - 1, Math.max(0, i + (down ? 1 : -1)));
        if (view !== "library") setView("library");
        openSetup(navOrder[next], { replace: true, tab: setupTab });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, selected, selectedId, navOrder, openSetup, newSetup, view, viewer, setupTab]);

  /* ---------- render pieces ---------- */
  const helpPopover = (
    <Popover open={helpOpen} onOpenChange={setHelpOpen}>
      <PopoverTrigger asChild>
        <IconAction aria-label="Горячие клавиши" aria-keyshortcuts="?" className="h-10 w-10"><HelpCircle /></IconAction>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="mb-2 text-sm font-semibold text-foreground">Горячие клавиши</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-sm">
          {HOTKEYS.map(([keys, label]) => (
            <div key={label} className="contents">
              <dt><Kbd keys={keys} className="[&_kbd]:text-xs" /></dt>
              <dd className="text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Эталон можно перетащить мышью между тирами или на сетап в списке слева.</p>
      </PopoverContent>
    </Popover>
  );

  const header = (
    <PageHeader
      title="Плейбук"
      icon={BookOpen}
      description="Сетапы офиса, личные и общие — с эталонными сделками"
      actions={
        <>
          <Button variant="outline" onClick={() => setFindOpen(true)} className="gap-2" aria-keyshortcuts="Control+K /" title="Ctrl+K или /">
            <Search className="h-4 w-4" aria-hidden="true" />
            <span>Найти</span>
          </Button>
          <Segmented<View>
            ariaLabel="Вид"
            value={view}
            onChange={setView}
            options={[
              { value: "library", label: <><Library className="h-4 w-4" aria-hidden="true" />Библиотека</> },
              { value: "gallery", label: <><Trophy className="h-4 w-4" aria-hidden="true" />Эталоны</> },
              { value: "grid", label: <><LayoutGrid className="h-4 w-4" aria-hidden="true" />Сетка</> },
            ]}
          />
          {helpPopover}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconAction aria-label="Ещё" className="h-10 w-10"><MoreHorizontal /></IconAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => setCompareFor(selected ?? topLevel[0] ?? entries[0] ?? null)} disabled={!entries.length}>
                <Columns2 className="h-4 w-4" aria-hidden="true" /> Сравнить сетапы
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActivityOpen(true)}><Activity className="h-4 w-4" aria-hidden="true" /> Журнал изменений</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Экспорт · {SPACES.find((s) => s.value === activeSpace)?.label}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={exportMd} disabled={!spaceEntries.length}><Download className="h-4 w-4" aria-hidden="true" /> В Markdown (.md)</DropdownMenuItem>
              <DropdownMenuItem onSelect={exportNotion} disabled={!spaceEntries.length || notionBusy}>
                <FileArchive className="h-4 w-4" aria-hidden="true" /> {notionBusy ? "Готовим ZIP…" : "Для Notion (ZIP)"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Масштаб · {Math.round(zoom * 100)}%</DropdownMenuLabel>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); changeZoom(0.05); }} disabled={zoom >= 1.5}><ZoomIn className="h-4 w-4" aria-hidden="true" /> Крупнее</DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); changeZoom(-0.05); }} disabled={zoom <= 0.65}><ZoomOut className="h-4 w-4" aria-hidden="true" /> Мельче</DropdownMenuItem>
              {zoom !== 1 && <DropdownMenuItem onSelect={(e) => { e.preventDefault(); changeZoom(0); }}>Сбросить до 100%</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          {canCreate && (
            <Button className="bg-primary-solid" onClick={() => newSetup(selected?.folder ?? null)} aria-keyshortcuts="n" title={newSpace === "office" ? "Сетап в плейбук офиса" : "Личный сетап — виден вам и кураторам"}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {newLabel}
            </Button>
          )}
        </>
      }
    />
  );

  const spaceSwitcher = (
    <div role="tablist" aria-label="Пространство плейбука" className={cn("grid gap-1 rounded-xl bg-[var(--glass-bg)] p-1", visibleSpaces.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
      {visibleSpaces.map((s) => {
        const active = activeSpace === s.value;
        return (
          <button
            key={s.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={s.hint}
            onClick={() => { setSpace(s.value); if (selected && tabOf.get(selected.id) !== s.value) openSetup(null, { replace: true }); }}
            className={cn(
              "flex min-h-9 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-sm transition-colors duration-[var(--dur-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="truncate">{s.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{spaceCounts[s.value]}</span>
          </button>
        );
      })}
    </div>
  );

  const tagPopover = (
    <Popover>
      <PopoverTrigger asChild>
        <IconAction aria-label={tagFilter.length ? `Теги: выбрано ${tagFilter.length}` : "Фильтр по тегам"} aria-pressed={tagFilter.length > 0} disabled={!allTags.length} className={cn("relative h-9 w-9", tagFilter.length > 0 && "text-primary")}>
          <Tag />
          {tagFilter.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-none text-primary-foreground tabular-nums">{tagFilter.length}</span>}
        </IconAction>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Фильтр по тегам</span>
          {tagFilter.length > 0 && <button type="button" onClick={() => setTagFilter([])} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Сбросить</button>}
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Показываются сетапы со всеми выбранными тегами.</p>
        <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
          {allTags.map(([t, n]) => (
            <button
              key={t}
              type="button"
              aria-pressed={tagFilter.includes(t)}
              onClick={() => setTagFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
              className="chip min-h-7 px-2.5 text-xs"
            >
              {t} <span className="tabular-nums text-muted-foreground">{n}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );

  /** One filter row: «Вид» (sort) + filter. Tags and «collapse all» sit next to the search box. */
  const filterRow = (
    <div className="grid min-w-0 grid-cols-2 items-center gap-1.5">
      <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
        <SelectTrigger className="h-9 min-w-0" aria-label="Вид списка" title="Вид списка"><SelectValue>{SORT_OPTIONS.find((o) => o.value === sort)?.short}</SelectValue></SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={quick} onValueChange={(v) => setQuick(v as QuickFilter)}>
        <SelectTrigger className={cn("h-9 min-w-0", quick !== "all" && "border-primary/60")} aria-label="Фильтр" title="Фильтр"><SelectValue>{FILTERS.find((f) => f.value === quick)?.short}</SelectValue></SelectTrigger>
        <SelectContent>
          {FILTERS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.value === "all" ? f.label : `${f.label} · ${quickCounts[f.value]}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const searchRow = (withCollapse: boolean) => (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="min-w-0 flex-1">{searchBox}</div>
      {tagPopover}
      {withCollapse && !flat && (
        <IconAction aria-label={allOpen ? "Свернуть все папки" : "Развернуть все папки"} title={allOpen ? "Свернуть все папки" : "Развернуть все папки"} onClick={toggleAll} className="h-9 w-9">
          {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
        </IconAction>
      )}
    </div>
  );

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); setQuery(""); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Enter" && flat?.[0]) { setView("library"); openSetup(flat[0].id); }
        }}
        placeholder="Поиск по сетапам"
        aria-label="Поиск по сетапам"
        className="h-9 pl-9 pr-9"
      />
      {query && (
        <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")} className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const activeFilterNote = filtering && (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {tagFilter.map((t) => (
        <button key={t} type="button" onClick={() => setTagFilter((p) => p.filter((x) => x !== t))} className="chip min-h-6 px-2 text-xs" aria-label={`Убрать тег ${t}`}>
          #{t} <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ))}
      <button type="button" onClick={() => { setQuery(""); setQuick("all"); setTagFilter([]); }} className="underline underline-offset-2 hover:text-foreground">
        Сбросить фильтры
      </button>
    </div>
  );

  const proposedBlock = activeSpace === "office" && proposed.length > 0 && (
    <section aria-label="Предложено в Офис" className="rounded-xl border border-primary/30 bg-primary/5 p-2">
      <h3 className="flex items-center gap-1.5 px-1 pb-1 text-xs font-semibold text-foreground">
        <Send className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Предложено в Офис <span className="tabular-nums text-muted-foreground">{proposed.length}</span>
      </h3>
      <ul className="space-y-0.5">
        {proposed.slice(0, 6).map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => openSetup(e.id)}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={e.officeProposedNote ?? undefined}
            >
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{e.officeProposedBy ?? e.trader}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  const spaceEmpty = (
    <div className="glass-panel rounded-2xl">
      {activeSpace === "office" ? (
        <EmptyState
          icon={Building2}
          title="В плейбуке офиса пока нет сетапов"
          description={viewer.isCurator ? "Опишите сетапы, которые торгует офис: контекст, триггер, вход, стоп, цели и эталонные сделки." : "Кураторы ещё не добавили сетапы. Пока можно вести свои в «Мой»."}
          action={viewer.isCurator ? <Button className="bg-primary-solid" onClick={() => newSetup()}><Plus className="h-4 w-4" aria-hidden="true" /> Первый сетап офиса</Button> : undefined}
        />
      ) : activeSpace === "mine" ? (
        <EmptyState
          icon={User}
          title="Ваш личный плейбук пуст"
          description="Заведите свой сетап или скопируйте сетап из «Офис» / «Общие» кнопкой «В „Мой“» — и добавляйте к нему свои эталонные сделки."
          action={canCreate ? <Button className="bg-primary-solid" onClick={() => newSetup()}><Plus className="h-4 w-4" aria-hidden="true" /> Новый личный сетап</Button> : undefined}
        />
      ) : activeSpace === "shared" ? (
        <EmptyState
          icon={Share2}
          title="С вами пока не поделились сетапами"
          description="Когда сеньор откроет доступ к своему сетапу — всему офису, вам или вашему потоку — он появится здесь с указанием автора."
        />
      ) : (
        <EmptyState icon={Users} title="Личных сетапов трейдеров нет" />
      )}
    </div>
  );

  const showOwner = activeSpace === "shared" || activeSpace === "team";

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="grid min-h-[640px] gap-[var(--grid-gap)] lg:grid-cols-[320px_minmax(0,1fr)]" aria-busy="true">
        <div className="glass-panel space-y-2 rounded-2xl p-3">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-xl" />)}</div>
        <div className="space-y-[var(--grid-gap)]"><Skeleton className="h-9 w-2/3 rounded-xl" /><div className="grid grid-cols-2 gap-[var(--grid-gap)]"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div></div>
      </div>
    );
  } else if (isError) {
    body = (
      <div className="glass-panel rounded-2xl">
        <EmptyState
          icon={BookOpen}
          title="Не удалось загрузить плейбук"
          description={(error as Error)?.message}
          action={<Button variant="outline" onClick={() => refetch()}>Повторить</Button>}
        />
      </div>
    );
  } else if (view === "gallery") {
    body = <Gallery entries={entries} onOpenSetup={(id) => openFromElsewhere(id, "examples")} />;
  } else if (view === "grid") {
    const list = flat ?? sortEntries(topLevel.filter(passes), "name", summary);
    const sections: { title: string | null; items: PlaybookEntry[] }[] = flat
      ? [{ title: null, items: list }]
      : [...allFolders, null].map((f) => ({ title: f ?? "Без папки", items: list.filter((e) => (e.folder ?? null) === f) })).filter((s) => s.items.length);
    body = (
      <div className="flex flex-col gap-[var(--grid-gap)]">
        <Toolbar className="gap-3">
          <div className="w-[420px] shrink-0">{spaceSwitcher}</div>
          {topLevel.length > 0 && (
            <>
              <div className="w-72">{searchRow(false)}</div>
              <div className="w-[300px]">{filterRow}</div>
            </>
          )}
        </Toolbar>
        {activeFilterNote}
        {topLevel.length === 0 ? spaceEmpty : list.length === 0 ? (
          <div className="glass-panel rounded-2xl"><EmptyState icon={Search} title="Ничего не найдено" description="Измените фильтры или поиск." /></div>
        ) : (
          sections.map((sec) => (
            <section key={sec.title ?? "all"} aria-label={sec.title ?? "Сетапы"}>
              {sec.title && <h2 className="mb-2 px-1 text-sm font-semibold text-foreground">{sec.title} <span className="font-normal text-muted-foreground">{sec.items.length}</span></h2>}
              <div className="grid grid-cols-2 gap-[var(--grid-gap)] xl:grid-cols-3 2xl:grid-cols-4">
                {sec.items.map((e) => (
                  <SetupCard key={e.id} e={e} s={summary.get(e.id)} folderColors={folderColors} selected={selectedId === e.id} onOpen={(id) => openFromElsewhere(id)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    );
  } else {
    body = (
      <div className="grid items-start gap-[var(--grid-gap)] grid-cols-[320px_minmax(0,1fr)]">
        <aside
          aria-label="Сетапы"
          className="glass-panel sticky-top flex max-h-[calc(100dvh-7rem)] min-w-0 flex-col gap-3 rounded-2xl p-3"
          onDragOver={onTreeDragOver}
          onDragLeave={onTreeDragLeave}
          onDrop={onTreeDrop}
        >
          {spaceSwitcher}
          {topLevel.length > 0 ? (
            <>
              {searchRow(true)}
              {filterRow}
              {activeFilterNote}
              {proposedBlock}
              <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                <FolderTree
                  groups={groups}
                  flat={flat}
                  selectedId={selectedId}
                  onSelect={(id) => openSetup(id, { tab: setupTab })}
                  openFolders={filtering ? new Set(groups.map((g) => g.folder ?? UNFILED)) : openFolders}
                  onToggleFolder={toggleFolder}
                  summary={summary}
                  folderColors={folderColors}
                  childrenOf={childrenOf}
                  query={query}
                  canEdit={canManageFolders}
                  folderOrder={allFolders}
                  showOwner={showOwner}
                  dropTargetId={dropTarget}
                  actions={{
                    onNewIn: (f) => newSetup(f),
                    onRename: setRenameFolder,
                    onColor: setFolderColor,
                    onMove: moveFolder,
                    onDelete: activeSpace === "office" ? setDeleteFolder : undefined,
                  }}
                />
              </div>
            </>
          ) : (
            <>
              {proposedBlock}
              <p className="px-1 py-2 text-sm text-muted-foreground">{SPACES.find((s) => s.value === activeSpace)?.hint}.</p>
            </>
          )}
        </aside>

        <div className="min-w-0">
          {selected ? (
            <SetupView
              key={selected.id}
              entry={selected}
              allEntries={entries}
              summary={summary}
              folders={everyFolder}
              folderColors={folderColors}
              viewer={viewer}
              live={live}
              tab={setupTab}
              onTab={(t) => openSetup(selected.id, { replace: true, tab: t })}
              onOpen={(id) => openSetup(id)}
              onClose={() => openSetup(null)}
              onEdit={(e) => setFormMode({ kind: "edit", entry: e })}
              onDuplicate={(e) => setFormMode({ kind: "duplicate", source: e, space: accessOf(e, viewer).canEdit && accessOf(e, viewer).space === "office" ? "office" : "personal" })}
              onCreateChild={(p) => setFormMode({ kind: "child", parent: p })}
              onDelete={setDeleting}
              onCompare={setCompareFor}
              onFolderClick={(f) => {
                const key = f ?? UNFILED;
                setOpenFolders((prev) => { const next = new Set(prev); next.add(key); lsSet(LS.openFolders, [...next]); return next; });
                if (sort !== "folder") setSort("folder");
                openSetup(null);
              }}
              onAddExamples={setPickerFor}
              onShare={setShareFor}
            />
          ) : selectedId ? (
            <div className="glass-panel rounded-2xl">
              <EmptyState icon={BookOpen} title="Сетап не найден" description="Возможно, он удалён, доступ к нему закрыт или ссылка устарела." action={<Button variant="outline" onClick={() => openSetup(null)}>К обзору</Button>} />
            </div>
          ) : topLevel.length === 0 ? (
            spaceEmpty
          ) : (
            <Overview
              entries={topLevel}
              summary={summary}
              summaryLoaded={summaryQ.isSuccess}
              onOpen={(id) => openSetup(id)}
              onQuickFilter={(f) => { setQuick(f); if (sort === "folder" && f !== "all") setSort("name"); }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <Page className={cn(zoom !== 1 && "origin-top-left")}>
      <div className="flex flex-col gap-[var(--page-gap)]" style={zoom !== 1 ? { zoom } : undefined}>
        {header}
        {body}
      </div>

      <SetupFormDialog
        mode={formMode}
        onClose={() => setFormMode(null)}
        folders={everyFolder}
        onSaved={(id) => { if (id && formMode?.kind !== "edit") openSetup(id); }}
      />
      <DeleteSetupDialog name={deleting?.name ?? null} open={!!deleting} onClose={() => setDeleting(null)} onConfirm={confirmDelete} pending={deletePending} />
      <RenameFolderDialog
        folder={renameFolder}
        onClose={() => setRenameFolder(null)}
        trader={trader}
        space={activeSpace === "mine" ? "personal" : activeSpace === "office" ? "office" : undefined}
        onRenamed={onFolderRenamed}
      />
      <DeleteFolderDialog
        folder={deleteFolder}
        count={deleteFolder ? folderTotals.get(deleteFolder) ?? 0 : 0}
        onClose={() => setDeleteFolder(null)}
        onConfirm={confirmDeleteFolder}
        pending={deleteFolderPending}
      />
      <CompareDialog
        open={!!compareFor}
        onOpenChange={(v) => { if (!v) setCompareFor(null); }}
        initial={compareFor}
        entries={entries}
        summary={summary}
        onOpen={(id) => openFromElsewhere(id)}
      />
      <QuickFind
        open={findOpen}
        onOpenChange={setFindOpen}
        entries={entries}
        summary={summary}
        folderColors={folderColors}
        recentIds={recentIds}
        onPick={(id) => openFromElsewhere(id)}
        actions={[
          ...(canCreate ? [{ id: "new", label: newLabel, icon: Plus, hint: "N", run: () => newSetup(selected?.folder ?? null) }] : []),
          { id: "gallery", label: "Галерея эталонов", icon: Trophy, run: () => setView("gallery") },
          { id: "compare", label: "Сравнить сетапы", icon: Columns2, hint: "C", run: () => setCompareFor(selected ?? topLevel[0] ?? entries[0] ?? null) },
          ...visibleSpaces.map((s) => ({ id: `space-${s.value}`, label: `Пространство: ${s.label}`, icon: s.icon, run: () => { setView("library"); setSpace(s.value); openSetup(null); } })),
          { id: "grid", label: view === "grid" ? "Вид: библиотека" : "Вид: сетка", icon: view === "grid" ? Library : LayoutGrid, run: () => setView(view === "grid" ? "library" : "grid") },
          { id: "activity", label: "Журнал изменений", icon: Activity, run: () => setActivityOpen(true) },
          { id: "export", label: "Экспорт в .md", icon: Download, run: exportMd },
        ]}
      />
      <ActivitySheet open={activityOpen} onOpenChange={setActivityOpen} />
      {pickerFor && <TradePickerDialog open={!!pickerFor} onOpenChange={(v) => { if (!v) setPickerFor(null); }} entry={pickerFor} />}
      {shareFor && <ShareDialog open={!!shareFor} onOpenChange={(v) => { if (!v) setShareFor(null); }} entry={shareFor} />}
    </Page>
  );
}
