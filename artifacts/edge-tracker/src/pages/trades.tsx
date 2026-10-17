// /trades — a REVIEW tool, not a data-entry form. Trades arrive automatically from the broker; the trader's job
// here is to look back: by trading day (default) or through smart presets, tag setup / mistake / emotion with the
// keyboard, and jump to the day report, behaviour patterns or the trade card.
// Manual entry survives only for staff (?new / ?fromIdea deep links) and for editing legacy manual trades.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useCreateTrade, useUpdateTrade, getTrade } from "@workspace/api-client-react";
import type { Trade, CreateTradeBody, UpdateTradeBody } from "@workspace/api-client-react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { BookText, CheckCircle2, Download, Filter, Keyboard, Loader2 } from "lucide-react";
import { EmptyState, Kbd, Page, PageHeader, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QueryError } from "@/components/query-error";
import { UndoToast } from "@/components/undo-toast";
import type { ChecklistResult } from "@/components/pre-trade-checklist";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useHolidaysRange, type HolidayEvent } from "@/lib/market-intel";
import { BASE } from "@/lib/api";
import { invalidateTradeDependents } from "@/lib/query-keys";
import {
  ENTRY_DECISION_FIELDS,
  HORIZONS,
  HORIZON_LABEL,
  RESULT_LABEL,
  advancedFilterCount,
  apiErrorMessage,
  blankForm,
  dayOf,
  downloadCsv,
  formToBody,
  isBrokerTrade,
  isDefaultFilters,
  isTypingTarget,
  plural,
  resultKey,
  tradeToForm,
  type FormData,
  type Outcome,
} from "@/components/trades/trade-utils";
import { useTradeFilters } from "@/components/trades/use-trade-filters";
import { useTradesPage, useTradeDays, dayTradesQuery, patchTradeInPages } from "@/hooks/use-trades-page";
import { TradeFilterBar } from "@/components/trades/TradeFilterBar";
import { TradePagination } from "@/components/trades/TradePagination";
import { TradeDetailSheet, type TradePatch } from "@/components/trades/TradeDetailSheet";
import { TradeFormDialog, ChecklistDialog, formSaveError } from "@/components/trades/TradeFormDialog";
import { useTradesQuality } from "@/components/replay/hooks";
import { useAfterExitMinutes } from "@/components/replay/QualityBlock";
import { BulkActionBar } from "@/components/trades/BulkActionBar";
import { AddTradesToPlaybookDialog } from "@/components/playbook/quick-add";
import { AddToPlaybookDialog } from "@/components/add-to-playbook";
import { tradePlaybookPayload } from "@/components/trades/trade-utils";
import { bulkTrades, type BulkBody } from "@/components/trades/bulk-api";
import { PRESET_META, hasTag, toggleTag, type Preset, type TagKind } from "@/components/trades/review-presets";
import type { PickerTarget, PickState } from "@/components/trades/review-tagging";
import { DayCard, PresetBar, ReviewKpis, ReviewTradeRow, RowsHeader, RowsSkeleton } from "@/components/trades/review-list";

const PERIOD_LABEL = { all: "всё время", today: "сегодня", week: "эта неделя", month: "этот месяц", custom: "диапазон" } as const;

const SHORTCUTS: [string, string][] = [
  ["J / K", "Следующая / предыдущая сделка"],
  ["Enter", "Открыть карточку"],
  ["S", "Сетап"],
  ["M", "Ошибка"],
  ["E", "Эмоция"],
  ["1–9", "Выбрать вариант в списке"],
  ["X", "Выбрать строку (Shift — диапазон)"],
  ["/", "Поиск"],
  ["← / →", "Страница (в режиме списка)"],
  ["Esc", "Снять выделение"],
  ["?", "Эта подсказка"],
];

const EMPTY_OUTCOMES: Record<Outcome, number> = { all: 0, win: 0, loss: 0, breakeven: 0, open: 0 };
const DAYS_PAGE = 30;
/** Min width of the ROW_GRID rows (sum of its fixed tracks + gaps + padding). */
const ROWS_MIN_W = "min-w-[900px]";
const KEY_KIND: Record<string, TagKind> = { s: "setup", "ы": "setup", m: "mistake", "ь": "mistake", e: "emotion", "у": "emotion" };

/** Strip a one-shot param (?highlight, ?new, ?fromIdea) without touching the filter state in the URL. */
function stripParam(name: string) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(name)) return;
  params.delete(name);
  const qs = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

export default function Trades() {
  const qc = useQueryClient();
  const { user, dbUsers, canEdit } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const traderNames = dbUsers.filter((u) => u.active).map((u) => u.name);
  const me = user && user.role !== "guest" ? user.traderName : null;
  const isStaff = useMemo(
    () => user?.role === "curator" || user?.role === "admin" || dbUsers.some((u) => u.name === user?.traderName && u.role === "curator"),
    [dbUsers, user?.traderName, user?.role],
  );
  // Mirrors the API: traders may only change their own trades; curators/admins any.
  const canEditTrade = useCallback(
    (t: Trade) => canEdit && (user?.role !== "trader" || !t.trader || t.trader === me),
    [canEdit, user?.role, me],
  );
  /** Broker numbers are read-only for traders: the full form / result / delete stay for manual trades or staff. */
  const canEditForm = useCallback((t: Trade) => canEditTrade(t) && (isStaff || !isBrokerTrade(t)), [canEditTrade, isStaff]);

  const F = useTradeFilters();
  const { filters, sort, page, pageSize, preset, view } = F;
  const listMode = !!preset || view === "list";
  const searchRef = useRef<HTMLInputElement | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────
  const [afterExit] = useAfterExitMinutes();
  const [qualityIds, setQualityIds] = useState<number[]>([]);
  const { quality, pending: qualityPending } = useTradesQuality(qualityIds, { afterExit });
  const pendingSet = useMemo(() => new Set(qualityPending), [qualityPending]);

  // Summary + facets always; rows only in list mode (the day view loads trades per expanded day).
  const P = useTradesPage({
    filters,
    sort: listMode ? sort : { col: "date", dir: "desc" },
    page: listMode ? page : 1,
    pageSize: listMode ? pageSize : 1,
    quality,
    preset,
  });
  const D = useTradeDays(filters, { limit: DAYS_PAGE });
  const summary = P.summary;
  const facets = P.facets;
  const total = summary?.total ?? 0;
  const setupOptions = useMemo(() => (facets?.setups ?? []).map((s) => s.name), [facets?.setups]);
  const distinctTraders = facets?.traders ?? [];
  const showTrader = distinctTraders.length > 1 && !filters.trader;
  const traderForLinks = filters.trader || (distinctTraders.length === 1 ? distinctTraders[0] : null) || me;

  // ── Day view: expanded days and their trades ───────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandKeyRef = useRef<string | null>(null);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    // Newest day open by default (again after the filters change).
    if (!D.days.length || expandKeyRef.current === filtersKey) return;
    expandKeyRef.current = filtersKey;
    setExpanded(new Set([D.days[0].date]));
  }, [D.days, filtersKey]);
  const toggleDay = useCallback((date: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(date)) n.delete(date); else n.add(date); return n; });
  }, []);

  const expandedDates = useMemo(() => D.days.filter((d) => expanded.has(d.date)).map((d) => d.date), [D.days, expanded]);
  const dayQs = useQueries({
    queries: expandedDates.map((date) => dayTradesQuery(filters, date, !listMode && !D.listByDay)),
  });
  const dayRows = useCallback((date: string): Trade[] | undefined => {
    if (D.listByDay) return D.listByDay.get(date) ?? [];
    const i = expandedDates.indexOf(date);
    return i >= 0 ? dayQs[i]?.data : undefined;
  }, [D.listByDay, expandedDates, dayQs]);

  const visibleRows: Trade[] = useMemo(() => {
    if (listMode) return P.items;
    const out: Trade[] = [];
    for (const d of expandedDates) out.push(...(dayRows(d) ?? []));
    return out;
  }, [listMode, P.items, expandedDates, dayRows]);
  const rowsRef = useRef(visibleRows);
  rowsRef.current = visibleRows;

  useEffect(() => {
    const ids = visibleRows.slice(0, 400).map((t) => t.id);
    setQualityIds((prev) => (prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids));
  }, [visibleRows]);

  // A page beyond the end (filters narrowed, rows deleted) snaps back to the last one.
  useEffect(() => {
    if (!listMode || !summary || P.isPlaceholder) return;
    if (page > 1 && P.items.length === 0 && summary.total > 0) F.setPage(Math.max(1, Math.ceil(summary.total / pageSize)));
  }, [summary, P.items.length, page, pageSize, P.isPlaceholder, listMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cumulative net by day, oldest → newest (spark on the net KPI). */
  const dayCurve = useMemo(() => {
    let c = 0;
    return [...D.days].reverse().map((d) => (c += d.net ?? 0));
  }, [D.days]);

  const scopeLabel = useMemo(() => {
    const parts: string[] = [PERIOD_LABEL[filters.period]];
    if (filters.outcome !== "all") parts.push(filters.outcome === "open" ? "открытые позиции" : RESULT_LABEL[filters.outcome].toLowerCase());
    if (filters.horizon) parts.push(HORIZON_LABEL[filters.horizon].toLowerCase());
    if (filters.side) parts.push(filters.side === "Long" ? "лонг" : filters.side === "Short" ? "шорт" : filters.side);
    if (filters.setup) parts.push(filters.setup);
    if (filters.ticker) parts.push(filters.ticker);
    const adv = advancedFilterCount(filters) - (filters.period === "custom" ? 1 : 0) - (filters.ticker ? 1 : 0);
    if (adv > 0) parts.push(`+${adv} ${plural(adv, ["фильтр", "фильтра", "фильтров"])}`);
    if (filters.q.trim()) parts.push(`«${filters.q.trim()}»`);
    return parts.join(" · ");
  }, [filters]);

  // Holidays: only for the badge in the trade card header.
  const { data: holidaysData } = useHolidaysRange(summary?.firstDate ?? "", summary?.lastDate ?? "");
  const holidayByDate = useMemo(() => {
    const m = new Map<string, HolidayEvent[]>();
    for (const e of holidaysData?.events ?? []) {
      const k = e.date.substring(0, 10);
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    return m;
  }, [holidaysData]);

  // ── Selection / focus / sheet ────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // «В плейбук» from a row icon or the bulk bar (one dialog for the page).
  const [pbTradeIds, setPbTradeIds] = useState<number[] | null>(null);
  /** «Новый сетап из сделки» from that dialog (single trade) → the full setup dialog, like the trade sheet. */
  const [newSetupFrom, setNewSetupFrom] = useState<Trade | null>(null);
  const lastToggledRef = useRef<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [picker, setPicker] = useState<PickerTarget>(null);
  /** A trade opened from a deep link / global search that is not among the visible rows. */
  const [detached, setDetached] = useState<Trade | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [scrollReq, setScrollReq] = useState<{ id: number; n: number } | null>(null);
  const openTrade = useMemo(() => {
    if (openId == null) return null;
    return visibleRows.find((t) => t.id === openId) ?? (detached?.id === openId ? detached : null);
  }, [openId, visibleRows, detached]);
  const openIndex = openTrade ? visibleRows.findIndex((t) => t.id === openTrade.id) : -1;

  const scrollTo = useCallback((id: number) => setScrollReq((r) => ({ id, n: (r?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!scrollReq) return;
    const el = document.querySelector(`[data-trade-id="${scrollReq.id}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [scrollReq]);

  // Keep the selection inside the visible rows.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const vis = new Set(visibleRows.map((t) => t.id));
      const next = new Set([...prev].filter((id) => vis.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleRows]);

  const toggle = useCallback((id: number, range: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const list = rowsRef.current;
      const last = lastToggledRef.current;
      if (range && last != null) {
        const a = list.findIndex((t) => t.id === last);
        const b = list.findIndex((t) => t.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(list[i].id);
          lastToggledRef.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      lastToggledRef.current = id;
      return next;
    });
  }, []);

  const openTradeSheet = useCallback((t: Trade) => { setOpenId(t.id); setActiveId(t.id); setPicker(null); }, []);

  // J/K step through the visible rows; in list mode they continue on the neighbouring page.
  const pendingStepRef = useRef<"first" | "last" | null>(null);
  const stepOpen = useCallback((dir: 1 | -1) => {
    const list = rowsRef.current;
    if (!list.length) return;
    const cur = openId ?? activeId;
    const idx = cur != null ? list.findIndex((t) => t.id === cur) : -1;
    const nextIdx = idx + dir;
    if (nextIdx >= list.length) {
      if (listMode && P.hasMore) { pendingStepRef.current = "first"; F.setPage((p) => p + 1); }
      return;
    }
    if (nextIdx < 0) {
      if (listMode && idx === 0 && page > 1) { pendingStepRef.current = "last"; F.setPage((p) => p - 1); return; }
      if (idx !== -1) return;
    }
    const t = list[Math.max(0, nextIdx)];
    if (openId != null) setOpenId(t.id);
    setActiveId(t.id);
    setPicker(null);
    scrollTo(t.id);
  }, [openId, activeId, scrollTo, P.hasMore, page, F, listMode]);

  useEffect(() => {
    const want = pendingStepRef.current;
    if (!want || P.isPlaceholder || !P.items.length) return;
    pendingStepRef.current = null;
    const t = want === "first" ? P.items[0] : P.items[P.items.length - 1];
    if (openId != null) setOpenId(t.id);
    setActiveId(t.id);
    scrollTo(t.id);
  }, [P.items, P.isPlaceholder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deep links: ?highlight=id and global search ──────────────────────────
  const focusTrade = useCallback(async (id: number) => {
    const visible = rowsRef.current.find((x) => x.id === id);
    if (visible) {
      setOpenId(id); setActiveId(id); setHighlightId(id); scrollTo(id);
      window.setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 2800);
      return true;
    }
    try {
      const t = await getTrade(id);
      setDetached(t);
      setOpenId(id);
      setActiveId(id);
      return true;
    } catch {
      toast({ title: "Сделка не найдена", description: `#${id} нет в журнале или нет доступа.`, variant: "destructive" });
      return false;
    }
  }, [scrollTo, toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hid = Number(params.get("highlight"));
    if (!hid || P.isLoading) return;
    stripParam("highlight");
    void focusTrade(hid);
  }, [P.isLoading, location]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onSearchNav(e: Event) {
      const { path, highlightId: hid } = (e as CustomEvent<{ path: string; highlightId: number }>).detail ?? {};
      if (path !== "/trades" || !hid) return;
      void focusTrade(Number(hid));
    }
    window.addEventListener("ws-search-navigate", onSearchNav);
    return () => window.removeEventListener("ws-search-navigate", onSearchNav);
  }, [focusTrade]);

  // ── Mutations ────────────────────────────────────────────────────────────
  // Every screen that derives numbers from the trade book is invalidated in one place (lib/query-keys.ts).
  const invalidateTrades = useCallback((tradeId?: number | null) => { void invalidateTradeDependents(qc, { tradeId }); }, [qc]);
  // Rapid tagging (J, S, 2, J, M, 1 …) would refetch the book after every key: batch it.
  const invalidateTimer = useRef<number | null>(null);
  const invalidateSoon = useCallback(() => {
    if (invalidateTimer.current != null) window.clearTimeout(invalidateTimer.current);
    invalidateTimer.current = window.setTimeout(() => { invalidateTimer.current = null; invalidateTrades(); }, 1200);
  }, [invalidateTrades]);
  useEffect(() => () => { if (invalidateTimer.current != null) window.clearTimeout(invalidateTimer.current); }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [form, setForm] = useState<FormData>(blankForm());
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistResult, setChecklistResult] = useState<ChecklistResult | null>(null);
  const [fromIdeaId, setFromIdeaId] = useState<number | null>(null);
  const [voiceNoteKey, setVoiceNoteKey] = useState(0);

  const createMut = useCreateTrade({
    mutation: {
      onSuccess: async (data: { id: number } | undefined) => {
        invalidateTrades();
        if (fromIdeaId && data?.id) {
          try {
            await fetch(`${BASE}/api/trade-ideas/${fromIdeaId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "converted", convertedTradeId: data.id }),
            });
            qc.invalidateQueries({ queryKey: ["trade-ideas"] });
          } catch {
            // non-blocking: the trade exists; the idea can be re-linked from the ideas page
          }
        }
        setFromIdeaId(null);
        setFormOpen(false);
        setChecklistResult(null);
        toast({ title: "Сделка сохранена" });
        if (data?.id) setActiveId(data.id);
      },
      onError: (e: unknown) => toast({ title: "Ошибка сохранения сделки", description: apiErrorMessage(e), variant: "destructive" }),
    },
  });
  const updateMut = useUpdateTrade({
    mutation: {
      onSuccess: (_d, vars) => { invalidateTrades(vars?.id); setVoiceNoteKey((k) => k + 1); setFormOpen(false); setEditing(null); toast({ title: "Сделка обновлена" }); },
      onError: (e: unknown) => toast({ title: "Ошибка обновления сделки", description: apiErrorMessage(e), variant: "destructive" }),
    },
  });
  const patchMut = useUpdateTrade();

  /** Inline edits (tags / setup / review / result) with an optimistic cache update. */
  const patchTrade = useCallback(async (t: Trade, patch: TradePatch, opts?: { silent?: boolean }) => {
    const rollback = patchTradeInPages(qc, t.id, patch);
    setDetached((d) => (d && d.id === t.id ? { ...d, ...patch } : d));
    try {
      await patchMut.mutateAsync({ id: t.id, data: patch as UpdateTradeBody });
      if (opts?.silent) invalidateSoon();
      else {
        invalidateTrades(t.id);
        toast({ title: patch.result ? `${t.ticker}: ${RESULT_LABEL[resultKey(patch.result)]}` : `${t.ticker}: сохранено` });
      }
      return true;
    } catch (e) {
      rollback();
      setDetached((d) => (d && d.id === t.id ? t : d));
      const msg = apiErrorMessage(e);
      toast({
        title: "Не удалось сохранить",
        // An API build older than this page still gates `setup` on imported trades behind the pre-trade checklist.
        description: /checklist/i.test(msg) ? "Сервер ещё не обновлён: сетап для этой сделки сохранится после обновления API. Ошибки и эмоции сохраняются уже сейчас." : msg,
        variant: "destructive",
      });
      return false;
    }
  }, [qc, patchMut, invalidateTrades, invalidateSoon, toast]);

  /** Quick tagging: setup is one value (PATCH setup), mistakes / emotions toggle inside `tags`. */
  const tagTrade = useCallback((t: Trade, kind: TagKind, value: string | null) => {
    if (!canEditTrade(t)) return;
    if (kind === "setup") {
      const next = value && (t.setup ?? "").trim().toLowerCase() === value.toLowerCase() ? null : value;
      void patchTrade(t, { setup: next }, { silent: true });
      return;
    }
    if (!value) return;
    void patchTrade(t, { tags: toggleTag(t.tags, value) }, { silent: true });
  }, [canEditTrade, patchTrade]);

  // ?fromIdea=id → prefilled full form (staff only: traders' trades come from the broker).
  const prefillHandledRef = useRef(false);
  useEffect(() => {
    if (prefillHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("fromIdea"));
    if (!id) return;
    if (!user || !dbUsers.length) return;
    prefillHandledRef.current = true;
    if (!isStaff) { stripParam("fromIdea"); return; }
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/trade-ideas/${id}`);
        if (!r.ok) {
          toast({ title: "Не удалось загрузить идею", description: `Статус ${r.status}`, variant: "destructive" });
          return;
        }
        const idea = await r.json();
        const f = blankForm();
        f.ticker = idea.ticker ?? "";
        if (idea.side === "Long" || idea.side === "Short") f.side = idea.side;
        f.setup = idea.setup ?? "";
        const entryFirst = idea.entryZone ? String(idea.entryZone).split(/[-/]/)[0]?.trim() : "";
        if (entryFirst) f.entry = entryFirst;
        if (idea.stop) f.stop = String(idea.stop);
        f.result = "open";
        f.notes = idea.thesis ?? "";
        if (idea.tags) f.tags = idea.tags;
        f.trader = idea.trader ?? user?.traderName ?? "";
        setForm(f);
        setEditing(null);
        setChecklistResult(null);
        setFromIdeaId(id);
        setFormOpen(true);
      } catch (err) {
        toast({ title: "Ошибка загрузки идеи", description: String((err as Error)?.message ?? err), variant: "destructive" });
      } finally {
        stripParam("fromIdea");
      }
    })();
  }, [location, user, dbUsers.length, isStaff, toast]);

  const openCreate = useCallback(() => {
    const f = blankForm();
    if (user?.traderName) f.trader = user.traderName;
    setForm(f);
    setEditing(null);
    setChecklistResult(null);
    setFromIdeaId(null);
    setFormOpen(true);
  }, [user?.traderName]);

  // ?new=1 → full form, staff only (hidden route for manual corrections). Traders just get the param stripped.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("new")) return;
    if (!user || !dbUsers.length) return;
    if (isStaff && canEdit) openCreate();
    stripParam("new");
  }, [location, canEdit, user, dbUsers.length, isStaff, openCreate]);

  const openEdit = useCallback((t: Trade) => {
    setForm(tradeToForm(t)); setEditing(t); setChecklistResult(null); setFromIdeaId(null); setFormOpen(true);
  }, []);

  function createWithChecklist(r: ChecklistResult) {
    const payload: CreateTradeBody & Record<string, unknown> = { ...formToBody(form) };
    if (r.responseId > 0) payload.checklistResponseId = r.responseId;
    if (r.responseId === 0) payload.skipChecklist = true;
    createMut.mutate({ data: payload as CreateTradeBody });
  }

  function handleSave() {
    const body = formToBody(form);
    if (!body.ticker || !body.result) return;
    if (!form.conviction || form.conviction < 1 || form.conviction > 5) {
      toast({ title: "Укажите убеждённость (1–5)", variant: "destructive" });
      return;
    }
    if (!["A+", "A", "B", "C"].includes(form.confidenceGrade)) {
      toast({ title: "Укажите грейд уверенности (A+, A, B или C)", variant: "destructive" });
      return;
    }
    if (form.horizon !== "intraday" && form.exitDate && form.exitDate < form.date) {
      toast({ title: "Дата выхода раньше даты входа", variant: "destructive" });
      return;
    }
    const saveErr = formSaveError(form);
    if (saveErr) {
      toast({ title: "Проверьте стоп и вход", description: saveErr, variant: "destructive" });
      return;
    }
    if (editing) {
      // Untouched entry-decision fields are omitted so that editing notes etc. doesn't hit the checklist gate.
      const original: Record<string, unknown> = { ...formToBody(tradeToForm(editing)) };
      const patch: Record<string, unknown> = { ...body };
      for (const f of ENTRY_DECISION_FIELDS) if (patch[f] === original[f]) delete patch[f];
      updateMut.mutate({ id: editing.id, data: patch as UpdateTradeBody });
      return;
    }
    if (!checklistResult) { setChecklistOpen(true); return; }
    createWithChecklist(checklistResult);
  }

  // ── Delete with undo + bulk actions ──────────────────────────────────────
  const [undo, setUndo] = useState<{ ids: number[]; label: string; key: number; restoring?: boolean } | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const runBulk = useCallback(async (body: BulkBody) => {
    setBulkPending(true);
    try {
      const done = await bulkTrades(body, rowsRef.current);
      invalidateTrades();
      return done;
    } catch (e) {
      toast({ title: "Действие не выполнено", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return null;
    } finally {
      setBulkPending(false);
    }
  }, [invalidateTrades, toast]);

  const deleteTrades = useCallback(async (ids: number[]) => {
    if (!ids.length) return;
    const label = ids.length === 1
      ? (rowsRef.current.find((t) => t.id === ids[0]) ?? (detached?.id === ids[0] ? detached : null))?.ticker ?? `#${ids[0]}`
      : `${ids.length} ${plural(ids.length, ["сделка", "сделки", "сделок"])}`;
    const done = await runBulk({ action: "delete", ids });
    if (!done?.length) return;
    setOpenId((cur) => (cur != null && done.includes(cur) ? null : cur));
    setSelected(new Set());
    setUndo({ ids: done, label, key: Date.now() });
    if (done.length < ids.length) toast({ title: `Удалено ${done.length} из ${ids.length}`, description: "Чужие сделки удалить нельзя." });
  }, [runBulk, toast, detached]);

  const restoreUndo = useCallback(async () => {
    if (!undo) return;
    const u = undo;
    if (u.restoring) return;
    setUndo({ ...u, restoring: true });
    const done = await runBulk({ action: "restore", ids: u.ids });
    setUndo((cur) => (cur?.key === u.key ? null : cur));
    if (done) toast({ title: `${u.label}: восстановлено` });
  }, [undo, runBulk, toast]);

  const selectedTrades = useMemo(() => visibleRows.filter((t) => selected.has(t.id)), [visibleRows, selected]);
  const selectedIds = useMemo(() => selectedTrades.map((t) => t.id), [selectedTrades]);
  const bulkStateOf = useCallback((kind: TagKind, value: string): PickState => {
    if (!selectedTrades.length) return "none";
    const n = selectedTrades.filter((t) => (kind === "setup" ? (t.setup ?? "").trim().toLowerCase() === value.toLowerCase() : hasTag(t.tags, value))).length;
    return n === 0 ? "none" : n === selectedTrades.length ? "all" : "some";
  }, [selectedTrades]);
  const canDeleteSelection = selectedTrades.length > 0 && selectedTrades.every((t) => canEditForm(t));
  const nTrades = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, ["сделка", "сделки", "сделок"])}`;

  // ── CSV export of the whole filtered set ────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const exportAll = useCallback(async () => {
    setExporting(true);
    try {
      const all = await P.fetchAll();
      if (!all.length) { toast({ title: "Нечего экспортировать" }); return; }
      downloadCsv(all);
      toast({ title: `CSV: ${nTrades(all.length)}` });
    } catch (e) {
      toast({ title: "Экспорт не удался", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }, [P, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const [helpOpen, setHelpOpen] = useState(false);
  const modalOpen = formOpen || checklistOpen || confirmBulkDelete || !!pbTradeIds;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || modalOpen) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      const k = e.key;
      if (k === "?") { e.preventDefault(); setHelpOpen((v) => !v); return; }
      const lower = k.toLowerCase();
      if (lower === "j" || lower === "k" || lower === "о" || lower === "л") { e.preventDefault(); stepOpen(lower === "j" || lower === "о" ? 1 : -1); return; }
      if (openId != null) return; // the sheet owns the rest of the keyboard
      if (k === "ArrowRight" && listMode && P.hasMore) { e.preventDefault(); F.setPage((p) => p + 1); return; }
      if (k === "ArrowLeft" && listMode && page > 1) { e.preventDefault(); F.setPage((p) => p - 1); return; }
      if (k === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      const active = activeId != null ? rowsRef.current.find((t) => t.id === activeId) : undefined;
      if (k === "Enter" && active) { e.preventDefault(); openTradeSheet(active); return; }
      if ((lower === "x" || lower === "ч") && active) { e.preventDefault(); toggle(active.id, e.shiftKey); return; }
      const kind = KEY_KIND[lower];
      if (kind && !e.shiftKey && active && canEditTrade(active)) { e.preventDefault(); setPicker({ id: active.id, kind }); return; }
      if (k === "Escape" && selected.size) { e.preventDefault(); setSelected(new Set()); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, openId, activeId, selected.size, canEditTrade, stepOpen, openTradeSheet, toggle, P.hasMore, page, F, listMode]);

  // ── Render helpers ───────────────────────────────────────────────────────
  const rowProps = (t: Trade) => ({
    trade: t,
    showTrader,
    quality,
    qualityPending: pendingSet.has(t.id),
    active: activeId === t.id,
    selected: selected.has(t.id),
    highlight: highlightId === t.id,
    canTag: canEditTrade(t),
    picker,
    setPicker,
    onPick: tagTrade,
    setupOptions,
    onOpen: openTradeSheet,
    onToggle: toggle,
    onFocusRow: setActiveId,
    onAddToPlaybook: user?.role !== "guest" ? (t: Trade) => setPbTradeIds([t.id]) : undefined,
  });

  const isPending = createMut.isPending || updateMut.isPending;
  const noFilters = isDefaultFilters(filters);
  const isLoading = P.isLoading;
  const isError = P.isError || (!listMode && D.isError);
  const noTrades = !isLoading && !P.isError && total === 0 && noFilters && !preset;
  const days = summary?.days ?? D.totalDays;
  const headerText = isLoading
    ? "Загрузка…"
    : `${nTrades(total)}${days ? ` · ${days.toLocaleString("ru-RU")} ${plural(days, ["торговый день", "торговых дня", "торговых дней"])}` : ""} · ${scopeLabel}`;
  const presetMeta = preset ? PRESET_META[preset] : null;

  const presetEmpty = (p: Preset) => (
    <EmptyState
      icon={p === "review" ? CheckCircle2 : Filter}
      title={p === "review" ? "Все сделки размечены" : `«${PRESET_META[p].label}»: пусто`}
      description={p === "review" ? "Неразобранных сделок нет в выбранном периоде." : `Сейчас: ${scopeLabel}. Расширьте период или снимите фильтры.`}
      action={<Button variant="outline" onClick={() => F.setPreset(null)}>К дням</Button>}
    />
  );

  return (
    <Page className="pb-24">
      <PageHeader
        title="Сделки"
        icon={BookText}
        description={headerText}
        actions={
          <>
            <Popover open={helpOpen} onOpenChange={setHelpOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Горячие клавиши (?)" title="Горячие клавиши (?)"><Keyboard /></Button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" collisionPadding={12} className="w-72 p-3">
                <p className="pb-2 text-sm font-semibold">Горячие клавиши</p>
                <ul className="space-y-1.5">
                  {SHORTCUTS.map(([key, label]) => (
                    <li key={key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <Kbd>{key}</Kbd>
                    </li>
                  ))}
                </ul>
                <p className="pt-2 text-xs text-muted-foreground">Разбор без мыши: J, затем S / M / E и цифра.</p>
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!total || exporting} onClick={() => void exportAll()} aria-label={`Экспорт ${total} сделок в CSV`}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} CSV
            </Button>
          </>
        }
      />

      {!noTrades && (
        <TradeFilterBar
          filters={filters}
          patch={F.patch}
          reset={F.reset}
          outcomeCounts={facets?.outcomes ?? EMPTY_OUTCOMES}
          horizonCounts={facets?.horizons ?? {}}
          setups={facets?.setups ?? []}
          traders={distinctTraders}
          sectors={facets?.sectors ?? []}
          views={F.views}
          onSaveView={(n) => { F.saveView(n); toast({ title: `Вид «${n}» сохранён` }); }}
          onApplyView={F.applyView}
          onRemoveView={F.removeView}
          searchRef={searchRef}
          showSource={isStaff}
        />
      )}

      {!noTrades && !P.isError && (
        <ReviewKpis summary={summary} loading={isLoading} dayCurve={preset ? [] : dayCurve} onPreset={(p) => F.setPreset(p)} />
      )}

      {!noTrades && (
        <PresetBar
          view={view}
          onView={(v) => { if (v === "days") F.setPreset(null); F.setView(v); }}
          preset={preset}
          onPreset={F.setPreset}
          counts={facets?.presets ?? null}
          sort={sort}
          onSort={F.setSort}
          trader={traderForLinks}
        />
      )}

      {isError ? (
        <Panel><QueryError error={P.error ?? D.error} onRetry={() => { void P.refetch(); void D.refetch(); }} /></Panel>
      ) : noTrades ? (
        <Panel>
          <EmptyState
            icon={BookText}
            title="Сделок пока нет"
            description="Сделки появятся здесь автоматически после торговой сессии. Тогда их можно будет разобрать по дням."
          />
        </Panel>
      ) : listMode ? (
        <Panel padded={false} className="overflow-hidden" aria-label={presetMeta ? presetMeta.label : "Все сделки"}>
          {isLoading ? (
            <RowsSkeleton rows={8} />
          ) : total === 0 ? (
            preset ? presetEmpty(preset) : (
              <EmptyState icon={Filter} title="Нет сделок по фильтрам" description={`Сейчас: ${scopeLabel}. Попробуйте расширить период или снять часть фильтров.`} action={<Button variant="outline" onClick={F.reset}>Сбросить фильтры</Button>} />
            )
          ) : (
            <div role="table" aria-label="Сделки" className={P.isPlaceholder ? "opacity-70 transition-opacity" : "transition-opacity"} aria-busy={P.isPlaceholder || undefined}>
              {/* Fixed-width grid columns (~900px): scroll sideways on narrow screens instead of clipping Нетто/Захват. */}
              <div className="overflow-x-auto">
                <div className={ROWS_MIN_W}>
                  <RowsHeader showDate sort={sort} onSort={F.toggleSort} />
                  {P.items.map((t) => <ReviewTradeRow key={t.id} {...rowProps(t)} showDate />)}
                </div>
              </div>
              <TradePagination
                page={page}
                pageSize={pageSize}
                total={total}
                returned={P.items.length}
                hasMore={P.hasMore}
                fetching={P.isFetching}
                onPage={F.setPage}
                onPageSize={F.setPageSize}
              />
            </div>
          )}
        </Panel>
      ) : D.isLoading ? (
        <Panel padded={false}><RowsSkeleton rows={6} /></Panel>
      ) : !D.days.length ? (
        <Panel>
          <EmptyState icon={Filter} title="Нет сделок по фильтрам" description={`Сейчас: ${scopeLabel}. Попробуйте расширить период или снять часть фильтров.`} action={<Button variant="outline" onClick={F.reset}>Сбросить фильтры</Button>} />
        </Panel>
      ) : (
        <div className="space-y-[var(--grid-gap)]" aria-busy={D.isFetching || undefined}>
          {D.days.map((d) => {
            const isOpen = expanded.has(d.date);
            const rows = isOpen ? dayRows(d.date) : undefined;
            return (
              <DayCard key={d.date} day={d} expanded={isOpen} onToggle={() => toggleDay(d.date)} trader={traderForLinks}>
                {rows == null ? <RowsSkeleton rows={Math.min(6, d.count)} /> : (
                  <div role="table" aria-label={`Сделки за ${d.date}`}>
                    <div className="overflow-x-auto">
                      <div className={ROWS_MIN_W}>
                        <RowsHeader showDate={false} />
                        {rows.map((t) => <ReviewTradeRow key={t.id} {...rowProps(t)} showDate={false} />)}
                      </div>
                    </div>
                    {rows.length >= 500 && d.count > rows.length && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Показаны первые 500 из {d.count}. Остальные — в режиме «Списком» с фильтром по дате.</p>
                    )}
                  </div>
                )}
              </DayCard>
            );
          })}
          {D.hasMore && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" onClick={D.loadMore} disabled={D.isFetching} className="gap-1.5">
                {D.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Показать ещё дни
                <span className="text-muted-foreground">· {D.days.length} из {D.totalDays}</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <BulkActionBar
          count={selectedIds.length}
          canTag={selectedTrades.every((t) => canEditTrade(t))}
          pending={bulkPending}
          setupOptions={setupOptions}
          stateOf={bulkStateOf}
          onSetSetup={async (setup) => {
            const done = await runBulk({ action: "setSetup", ids: selectedIds, setup });
            if (done) toast({ title: setup ? `Сетап «${setup}»: ${nTrades(done.length)}` : `Сетап убран: ${nTrades(done.length)}` });
          }}
          onToggleTag={async (tag, mode) => {
            const done = await runBulk({ action: mode === "add" ? "addTags" : "removeTags", ids: selectedIds, tags: [tag] });
            if (done) toast({ title: mode === "add" ? `«${tag}» добавлено` : `«${tag}» убрано`, description: nTrades(done.length) });
          }}
          onExport={() => downloadCsv(selectedTrades, `trades-selected-${selectedIds.length}.csv`)}
          onSetResult={isStaff ? async (r) => {
            const done = await runBulk({ action: "setResult", ids: selectedIds, result: r });
            if (done) toast({ title: `${RESULT_LABEL[r]}: ${nTrades(done.length)}` });
          } : undefined}
          onDelete={canDeleteSelection ? () => (selectedIds.length === 1 ? deleteTrades(selectedIds) : setConfirmBulkDelete(true)) : undefined}
          onClear={() => setSelected(new Set())}
          onAddToPlaybook={user?.role !== "guest" ? () => setPbTradeIds(selectedIds) : undefined}
        />
      )}
      <AddTradesToPlaybookDialog
        open={!!pbTradeIds}
        onOpenChange={(v) => { if (!v) setPbTradeIds(null); }}
        tradeIds={pbTradeIds ?? []}
        onNewSetup={() => {
          const id = pbTradeIds?.[0];
          const t = visibleRows.find((x) => x.id === id) ?? (detached?.id === id ? detached : null);
          if (t) setNewSetupFrom(t);
        }}
      />
      {newSetupFrom && (
        <AddToPlaybookDialog
          open
          onOpenChange={(v) => { if (!v) setNewSetupFrom(null); }}
          payload={tradePlaybookPayload(newSetupFrom)}
        />
      )}

      <TradeDetailSheet
        trade={openTrade}
        onClose={() => setOpenId(null)}
        allTrades={visibleRows}
        onOpenTrade={(t) => { setDetached(t); setOpenId(t.id); setActiveId(t.id); }}
        onPrev={openIndex > 0 || (listMode && openIndex === 0 && page > 1) ? () => stepOpen(-1) : undefined}
        onNext={openIndex >= 0 && (openIndex < visibleRows.length - 1 || (listMode && P.hasMore)) ? () => stepOpen(1) : undefined}
        position={openIndex >= 0 ? (listMode ? { index: (page - 1) * pageSize + openIndex, total } : { index: openIndex, total: visibleRows.length }) : undefined}
        canEdit={openTrade ? canEditTrade(openTrade) : false}
        canEditForm={openTrade ? canEditForm(openTrade) : false}
        canEditResult={openTrade ? canEditForm(openTrade) : false}
        canDelete={openTrade ? canEditForm(openTrade) : false}
        onEdit={openEdit}
        onDelete={(t) => deleteTrades([t.id])}
        onPatch={patchTrade}
        onTag={tagTrade}
        setupOptions={setupOptions}
        traderName={me}
        isCurator={isStaff}
        voiceNoteKey={voiceNoteKey}
        holidayEvents={openTrade ? holidayByDate.get(dayOf(openTrade)) ?? [] : []}
      />

      <TradeFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); setFromIdeaId(null); setChecklistResult(null); }}
        form={form}
        setForm={setForm}
        editing={editing}
        traderNames={traderNames}
        checklistResult={checklistResult}
        onResetChecklist={() => setChecklistResult(null)}
        onSave={handleSave}
        isPending={isPending}
        onVoiceUploaded={() => setVoiceNoteKey((k) => k + 1)}
      />

      <ChecklistDialog
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        ticker={form.ticker}
        date={form.date}
        trader={form.trader}
        onConfirm={(r) => { setChecklistResult(r); setChecklistOpen(false); createWithChecklist(r); }}
      />

      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {selectedIds.length} {plural(selectedIds.length, ["сделку", "сделки", "сделок"])}?</AlertDialogTitle>
            <AlertDialogDescription>Отменить удаление можно будет в течение 8 секунд.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmBulkDelete(false); void deleteTrades(selectedIds); }}
              className="border border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/25"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {undo && (
        <UndoToast key={undo.key} label={undo.label} onUndo={restoreUndo} restoring={undo.restoring} onDismiss={() => setUndo((cur) => (cur?.restoring ? cur : null))} />
      )}

      {/* Used by tests / other pages to know which horizons exist. */}
      <span hidden data-horizons={HORIZONS.join(",")} />
    </Page>
  );
}
