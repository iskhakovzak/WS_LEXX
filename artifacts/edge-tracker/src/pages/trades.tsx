import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListTrades,
  useCreateTrade,
  useUpdateTrade,
  useDeleteTrade,
  getListTradesQueryKey,
} from "@workspace/api-client-react";
import type { Trade, CreateTradeBody, UpdateTradeBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, ChevronDown, ChevronUp, Tag, ThumbsUp, Star, Send, Shield, Search, X, Calendar } from "lucide-react";
import { AddToPlaybookButton } from "@/components/add-to-playbook";
import { useUndoDelete } from "@/hooks/use-undo-delete";
import { UndoToast } from "@/components/undo-toast";
import { TagSelector } from "@/components/tag-selector";
import { useAuth, WriteOnly } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls, screenshotNotesToString, stringToScreenshotNotes } from "@/components/screenshot-fields";

const EVENT_TYPES = ["earnings", "momentum", "news", "ipo", "fed", "macro", "other"];
const RESULTS = ["win", "loss", "breakeven"];
const SESSIONS = ["premarket", "regular", "afterhours"];
const SIDES = ["Long", "Short"];

type FormData = {
  ticker: string; date: string; setup: string; side: string; eventType: string; entry: string; exit: string;
  stop: string; result: string; pnl: string; rMultiple: string; holdTime: string; slippage: string;
  marketCap: string; float: string; relativeVolume: string; session: string; screenshotUrls: string[];
  screenshotNotes: string[]; notes: string; whatWorked: string; whatFailed: string; conclusion: string; trader: string; tags: string;
};

const blank = (): FormData => ({
  ticker: "", date: new Date().toISOString().split("T")[0], setup: "", side: "Long", eventType: "", entry: "",
  exit: "", stop: "", result: "win", pnl: "", rMultiple: "", holdTime: "", slippage: "",
  marketCap: "", float: "", relativeVolume: "", session: "regular", screenshotUrls: [""], screenshotNotes: [""], notes: "",
  whatWorked: "", whatFailed: "", conclusion: "", trader: "", tags: "",
});

function tradeToForm(t: Trade & { tags?: string | null; side?: string | null }): FormData {
  const urls = stringToScreenshotUrls(t.screenshotUrl);
  return {
    ticker: t.ticker, date: t.date.substring(0, 10), setup: (t as any).setup ?? "", side: (t as any).side ?? "Long",
    eventType: t.eventType ?? "",
    entry: t.entry != null ? String(t.entry) : "", exit: t.exit != null ? String(t.exit) : "",
    stop: t.stop != null ? String(t.stop) : "", result: t.result,
    pnl: t.pnl != null ? String(t.pnl) : "", rMultiple: t.rMultiple != null ? String(t.rMultiple) : "",
    holdTime: t.holdTime ?? "", slippage: t.slippage != null ? String(t.slippage) : "",
    marketCap: t.marketCap ?? "", float: t.float ?? "",
    relativeVolume: t.relativeVolume != null ? String(t.relativeVolume) : "",
    session: t.session ?? "regular", screenshotUrls: urls, screenshotNotes: stringToScreenshotNotes(t.screenshotNotes, urls.length), notes: t.notes ?? "",
    whatWorked: t.whatWorked ?? "", whatFailed: t.whatFailed ?? "",
    conclusion: t.conclusion ?? "", trader: t.trader ?? "", tags: t.tags ?? "",
  };
}

function formToBody(f: FormData): CreateTradeBody & { tags?: string | null; side?: string | null } {
  return {
    ticker: f.ticker.toUpperCase(), date: f.date, setup: f.setup || null, side: f.side || null, result: f.result,
    eventType: f.eventType || null, entry: f.entry ? Number(f.entry) : null,
    exit: f.exit ? Number(f.exit) : null, stop: f.stop ? Number(f.stop) : null,
    pnl: f.pnl ? Number(f.pnl) : null, rMultiple: f.rMultiple ? Number(f.rMultiple) : null,
    holdTime: f.holdTime || null, slippage: f.slippage ? Number(f.slippage) : null,
    marketCap: f.marketCap || null, float: f.float || null,
    relativeVolume: f.relativeVolume ? Number(f.relativeVolume) : null,
    session: f.session || null, screenshotUrl: screenshotUrlsToString(f.screenshotUrls) || null,
    screenshotNotes: screenshotNotesToString(f.screenshotNotes) || null,
    notes: f.notes || null, whatWorked: f.whatWorked || null,
    whatFailed: f.whatFailed || null, conclusion: f.conclusion || null,
    trader: f.trader || null, tags: f.tags || null,
  };
}

const FILTER_TABS = [
  { key: "all", label: "Все" },
  { key: "win", label: "Прибыльные" },
  { key: "loss", label: "Убыточные" },
  { key: "long", label: "Long" },
  { key: "short", label: "Short" },
  { key: "earnings", label: "Отчётность" },
  { key: "premarket", label: "Предмаркет" },
];

function TagChips({ tags }: { tags?: string | null }) {
  if (!tags) return null;
  const chips = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {chips.map((tag, i) => (
        <span key={i} className="px-1.5 py-0 text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 leading-4">{tag}</span>
      ))}
    </div>
  );
}

function SideBadge({ side }: { side?: string | null }) {
  if (!side) return null;
  const isLong = side === "Long";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold border ${isLong ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`}>
      <span className={isLong ? "text-emerald-400" : "text-red-400"}>{isLong ? "▲" : "▼"}</span>
      {side}
    </span>
  );
}

type Reaction = { id: number; tradeId: number; trader: string; reactionType: string };
type Review = { id: number; tradeId: number; curator: string; comment: string; rating?: string; createdAt: string };

function TradeActions({ tradeId, traderName, isCurator }: { tradeId: number; traderName: string; isCurator: boolean }) {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState("good");

  useEffect(() => {
    fetch(`${BASE}/api/trades/${tradeId}/reactions`).then((r) => r.json()).then(setReactions).catch(() => {});
    fetch(`${BASE}/api/trades/${tradeId}/reviews`).then((r) => r.json()).then(setReviews).catch(() => {});
  }, [tradeId]);

  const hasLiked = reactions.some((r) => r.trader === traderName);
  const likeCount = reactions.length;

  async function toggleLike() {
    await fetch(`${BASE}/api/trades/${tradeId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trader: traderName, reactionType: "like" }),
    });
    const updated = await fetch(`${BASE}/api/trades/${tradeId}/reactions`).then((r) => r.json());
    setReactions(updated);
  }

  async function submitReview() {
    if (!reviewText.trim()) return;
    await fetch(`${BASE}/api/trades/${tradeId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curator: traderName, comment: reviewText, rating: reviewRating }),
    });
    setReviewText("");
    const updated = await fetch(`${BASE}/api/trades/${tradeId}/reviews`).then((r) => r.json());
    setReviews(updated);
  }

  async function deleteReview(reviewId: number) {
    await fetch(`${BASE}/api/trades/${tradeId}/reviews/${reviewId}?curator=${encodeURIComponent(traderName)}`, { method: "DELETE" });
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
  }

  const ratingLabels: Record<string, { label: string; color: string }> = {
    excellent: { label: "Отлично", color: "text-emerald-400" },
    good: { label: "Хорошо", color: "text-primary" },
    needs_work: { label: "Нужно доработать", color: "text-yellow-400" },
    poor: { label: "Плохо", color: "text-red-400" },
  };

  return (
    <div className="space-y-3 mt-3 pt-3 border-t border-border/50">
      <div className="flex items-center gap-4">
        <button onClick={toggleLike} className={`flex items-center gap-1.5 px-2 py-1 text-xs font-mono transition-colors border ${hasLiked ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" : "border-border text-muted-foreground hover:text-yellow-400 hover:border-yellow-500/30"}`}>
          <ThumbsUp className="h-3 w-3" />
          <span>{likeCount > 0 ? likeCount : ""} {hasLiked ? "Liked" : "Like"}</span>
        </button>
        {reactions.length > 0 && (
          <span className="text-xs text-muted-foreground font-mono">
            {reactions.map((r) => r.trader).join(", ")}
          </span>
        )}
      </div>

      {reviews.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-mono text-muted-foreground uppercase flex items-center gap-1">
            <Shield className="h-3 w-3" /> Curator Reviews
          </div>
          {reviews.map((r) => (
            <div key={r.id} className="flex gap-3 py-2 px-3 bg-violet-500/5 border border-violet-500/20">
              <div className="w-1 bg-violet-500/50 shrink-0 self-stretch" />
              <div className="flex-1 min-w-0">
                <div className="flex gap-2 items-center mb-0.5 text-xs font-mono">
                  <span className="text-violet-400 font-bold flex items-center gap-1"><Shield className="h-3 w-3" />{r.curator}</span>
                  {r.rating && <span className={ratingLabels[r.rating]?.color ?? "text-muted-foreground"}>{ratingLabels[r.rating]?.label ?? r.rating}</span>}
                  <span className="text-muted-foreground">{r.createdAt.substring(0, 10)}</span>
                  {r.curator === traderName && (
                    <button onClick={() => deleteReview(r.id)} className="ml-auto p-0.5 text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                  )}
                </div>
                <div className="text-xs text-foreground font-mono">{r.comment}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isCurator && (
        <div className="space-y-2">
          <div className="text-xs font-mono text-violet-400 uppercase flex items-center gap-1">
            <Star className="h-3 w-3" /> Оставить Review (куратор)
          </div>
          <div className="flex gap-2 items-start">
            <select value={reviewRating} onChange={(e) => setReviewRating(e.target.value)}
              className="bg-background border border-border text-xs font-mono px-2 py-1.5 text-foreground">
              <option value="excellent">Отлично</option>
              <option value="good">Хорошо</option>
              <option value="needs_work">Доработать</option>
              <option value="poor">Плохо</option>
            </select>
            <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} rows={2} placeholder="Комментарий куратора..."
              className="flex-1 bg-background border border-border text-xs font-mono px-2 py-1.5 resize-none text-foreground"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitReview(); } }}
            />
            <button onClick={submitReview} className="px-3 py-1.5 bg-violet-500/20 text-violet-400 border border-violet-500/30 text-xs font-mono hover:bg-violet-500/30 transition-colors flex items-center gap-1">
              <Send className="h-3 w-3" /> Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type SortConfig = { col: string; dir: "asc" | "desc" };

function SortIcon({ col, sort }: { col: string; sort: SortConfig | null }) {
  if (!sort || sort.col !== col) return <span className="text-muted-foreground/30 ml-0.5">⇅</span>;
  return <span className="text-primary ml-0.5">{sort.dir === "asc" ? "↑" : "↓"}</span>;
}

export default function Trades() {
  const qc = useQueryClient();
  const { user, dbUsers } = useAuth();
  const traderNames = dbUsers.filter((u) => u.active).map((u) => u.name);
  const [location, setLocation] = useLocation();
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [deleting, setDeleting] = useState<Trade | null>(null);
  const [form, setForm] = useState<FormData>(blank());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sort, setSort] = useState<SortConfig | null>({ col: "date", dir: "desc" });
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  function toggleSort(col: string) {
    setSort((prev) => prev?.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" });
  }

  const { data: trades = [], isLoading } = useListTrades();

  useEffect(() => {
    function tryHighlight() {
      const params = new URLSearchParams(window.location.search);
      const hid = params.get("highlight");
      if (!hid || !trades.length) return false;
      const id = Number(hid);
      if (!id) return false;
      const trade = trades.find((t) => t.id === id);
      if (!trade) return false;
      setExpanded(id);
      setHighlightId(id);
      setTab("all");
      setSearch("");
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      setTimeout(() => setHighlightId(null), 2800);
      window.history.replaceState({}, "", window.location.pathname);
      return true;
    }
    tryHighlight();
  }, [trades, location]);

  const createMut = useCreateTrade({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListTradesQueryKey() }); setOpen(false); } } });
  const updateMut = useUpdateTrade({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListTradesQueryKey() }); setOpen(false); setEditing(null); } } });
  const invalidateTrades = useCallback(() => { qc.invalidateQueries({ queryKey: getListTradesQueryKey() }); }, [qc]);
  const undo = useUndoDelete(invalidateTrades);
  const deleteMut = useDeleteTrade({ mutation: { onSuccess: (_data, variables) => { invalidateTrades(); const t = deleting; setDeleting(null); if (t) undo.scheduleUndo(t.id, "trades", t.ticker); } } });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = trades.filter((t) => {
      const tabOk = (() => {
        if (tab === "all") return true;
        if (tab === "win") return t.result === "win";
        if (tab === "loss") return t.result === "loss";
        if (tab === "long") return (t as any).side === "Long";
        if (tab === "short") return (t as any).side === "Short";
        if (tab === "earnings") return t.eventType === "earnings";
        if (tab === "premarket") return t.session === "premarket";
        return true;
      })();
      if (!tabOk) return false;
      if (dateFilter && t.date?.substring(0, 10) !== dateFilter) return false;
      if (!q) return true;
      const fields = [
        t.ticker,
        t.date,
        (t as any).setup,
        (t as any).side,
        t.eventType,
        t.session,
        t.trader,
        (t as any).tags,
        t.notes,
        t.whatWorked,
        t.whatFailed,
        t.conclusion,
        t.pnl != null ? String(t.pnl) : "",
        t.rMultiple != null ? String(t.rMultiple) : "",
        t.float,
        t.marketCap,
      ].filter(Boolean).join(" ").toLowerCase();
      return fields.includes(q);
    });
    if (!sort) return base;
    return [...base].sort((a, b) => {
      let av: any, bv: any;
      if (sort.col === "ticker") { av = a.ticker; bv = b.ticker; }
      else if (sort.col === "date") { av = a.date; bv = b.date; }
      else if (sort.col === "pnl") { av = a.pnl ?? -Infinity; bv = b.pnl ?? -Infinity; }
      else if (sort.col === "r") { av = a.rMultiple ?? -Infinity; bv = b.rMultiple ?? -Infinity; }
      else if (sort.col === "result") { av = a.result; bv = b.result; }
      else if (sort.col === "trader") { av = (a as any).trader ?? ""; bv = (b as any).trader ?? ""; }
      else if (sort.col === "entry") { av = a.entry ?? 0; bv = b.entry ?? 0; }
      else { av = a.date; bv = b.date; }
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [trades, tab, sort, search, dateFilter]);

  function openCreate() {
    const f = blank();
    if (user?.traderName) f.trader = user.traderName;
    setForm(f);
    setEditing(null);
    setOpen(true);
  }
  function openEdit(t: Trade) { setForm(tradeToForm(t)); setEditing(t); setOpen(true); }
  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  function handleSave() {
    const body = formToBody(form);
    if (!body.ticker || !body.result) return;
    if (editing) {
      updateMut.mutate({ id: editing.id, data: body as UpdateTradeBody });
    } else {
      createMut.mutate({ data: body });
    }
  }

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Трейды</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {filtered.length !== trades.length ? `${filtered.length} из ${trades.length}` : `${trades.length}`} трейдов
          </p>
        </div>
        <WriteOnly>
          <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
            <Plus className="h-3 w-3" /> Новый Трейд
          </Button>
        </WriteOnly>
      </div>

      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по тикеру, сетапу, трейдеру, тегам, заметкам..."
            className="w-full h-9 pl-9 pr-8 bg-card border border-border text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="relative flex items-center flex-shrink-0">
          <Calendar className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="h-9 pl-8 pr-7 bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
          {dateFilter && (
            <button onClick={() => setDateFilter("")} className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-0 border border-border overflow-x-auto">
        {FILTER_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-mono uppercase whitespace-nowrap border-r border-border last:border-r-0 transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono text-left">
            <thead className="bg-muted text-muted-foreground border-b border-border">
              <tr>
                <th className="px-3 py-3 font-normal uppercase text-xs w-8"></th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("ticker")}>Тикер<SortIcon col="ticker" sort={sort} /></th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("date")}>Дата<SortIcon col="date" sort={sort} /></th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap">Side</th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap">Тип</th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("trader")}>Трейдер<SortIcon col="trader" sort={sort} /></th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("entry")}>Вход<SortIcon col="entry" sort={sort} /></th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap">Выход</th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("r")}>R<SortIcon col="r" sort={sort} /></th>
                <th className="px-3 py-3 font-normal uppercase text-xs whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("result")}>Результат<SortIcon col="result" sort={sort} /></th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("pnl")}>PnL<SortIcon col="pnl" sort={sort} /></th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right whitespace-nowrap">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((t) => (
                <React.Fragment key={t.id}>
                  <tr
                    ref={highlightId === t.id ? highlightRef : null}
                    className={`transition-colors cursor-pointer border-l-[3px] ${
                      highlightId === t.id ? "bg-primary/10 border-l-primary animate-pulse" :
                      t.result === "win" ? "border-l-emerald-500/60 hover:bg-emerald-500/5" :
                      t.result === "loss" ? "border-l-red-500/60 hover:bg-red-500/5" :
                      "border-l-muted hover:bg-muted/40"
                    }`}
                    onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  >
                    <td className="px-3 py-3 text-muted-foreground">
                      <div className="flex items-center gap-1">
                        {expanded === t.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-bold text-foreground">{t.ticker}</div>
                      <TagChips tags={(t as any).tags} />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{t.date.substring(0, 10)}</td>
                    <td className="px-3 py-3"><SideBadge side={(t as any).side} /></td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{t.eventType || "-"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{t.trader || "-"}</td>
                    <td className="px-3 py-3">{t.entry?.toFixed(2) || "-"}</td>
                    <td className="px-3 py-3">{t.exit?.toFixed(2) || "-"}</td>
                    <td className="px-3 py-3 text-xs">{t.rMultiple != null ? <span className={t.rMultiple >= 2 ? "text-emerald-400 font-bold" : t.rMultiple >= 1 ? "text-emerald-400/70" : t.rMultiple < 0 ? "text-red-400" : ""}>{t.rMultiple.toFixed(1)}R</span> : "-"}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-bold ${t.result === "win" ? "bg-emerald-500/15 text-emerald-400" : t.result === "loss" ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground"}`}>
                        {t.result === "win" ? "WIN" : t.result === "loss" ? "LOSS" : "BE"}
                      </span>
                    </td>
                    <td className={`px-3 py-3 text-right font-bold ${(t.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {formatCurrency(t.pnl)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        <WriteOnly>
                          <AddToPlaybookButton payload={{
                            name: `${t.ticker} ${(t as any).setup || t.eventType || ""} (${t.date.substring(0, 10)})`.trim(),
                            setupType: (t as any).setup || t.eventType || undefined,
                            conditions: t.notes || undefined,
                            notes: [t.whatWorked ? `Что сработало: ${t.whatWorked}` : "", t.whatFailed ? `Что не сработало: ${t.whatFailed}` : "", t.conclusion ? `Вывод: ${t.conclusion}` : ""].filter(Boolean).join("\n") || undefined,
                            screenshotUrl: t.screenshotUrl || undefined,
                            screenshotNotes: t.screenshotNotes || undefined,
                            tags: (t as any).tags || undefined,
                            sourceType: "trade",
                            sourceId: t.id,
                          }} size="icon" />
                          <button onClick={() => openEdit(t)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setDeleting(t)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </WriteOnly>
                      </div>
                    </td>
                  </tr>
                  {expanded === t.id && (
                    <tr className="bg-muted/10">
                      <td colSpan={12} className="px-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                          {t.notes && (
                            <div className="bg-muted/30 border border-border/50 p-3">
                              <div className="text-muted-foreground uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full" />Заметки
                              </div>
                              <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{t.notes}</div>
                            </div>
                          )}
                          {t.whatWorked && (
                            <div className="bg-emerald-500/5 border border-emerald-500/20 p-3">
                              <div className="text-emerald-400 uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />Что сработало
                              </div>
                              <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{t.whatWorked}</div>
                            </div>
                          )}
                          {t.whatFailed && (
                            <div className="bg-red-500/5 border border-red-500/20 p-3">
                              <div className="text-red-400 uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                                <div className="w-1.5 h-1.5 bg-red-400 rounded-full" />Что не сработало
                              </div>
                              <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{t.whatFailed}</div>
                            </div>
                          )}
                          {t.conclusion && (
                            <div className="bg-primary/5 border border-primary/20 p-3 md:col-span-3">
                              <div className="text-primary uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                                <div className="w-1.5 h-1.5 bg-primary rounded-full" />Вывод
                              </div>
                              <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{t.conclusion}</div>
                            </div>
                          )}
                          <div className="flex gap-4 flex-wrap md:col-span-3 text-foreground/70">
                            {t.holdTime && <div className="bg-muted/30 px-2 py-1 border border-border/30"><span className="text-muted-foreground">Время: </span>{t.holdTime}</div>}
                            {t.session && <div className="bg-muted/30 px-2 py-1 border border-border/30"><span className="text-muted-foreground">Сессия: </span>{t.session}</div>}
                            {t.relativeVolume != null && <div className="bg-muted/30 px-2 py-1 border border-border/30"><span className="text-muted-foreground">RVOL: </span>{t.relativeVolume}x</div>}
                            {t.float && <div className="bg-muted/30 px-2 py-1 border border-border/30"><span className="text-muted-foreground">Float: </span>{t.float}</div>}
                            {(t as any).setup && <div className="bg-muted/30 px-2 py-1 border border-border/30"><span className="text-muted-foreground">Setup: </span>{(t as any).setup}</div>}
                          </div>
                          {(t as any).tags && (
                            <div>
                              <div className="text-muted-foreground uppercase mb-1 flex items-center gap-1"><Tag className="h-3 w-3" />Теги</div>
                              <TagChips tags={(t as any).tags} />
                            </div>
                          )}
                          {t.screenshotUrl && (
                            <div className="md:col-span-3">
                              <ScreenshotDisplay
                                urls={t.screenshotUrl}
                                notes={t.screenshotNotes}
                                onNotesChange={async (newNotes) => {
                                  try {
                                    await fetch(`${BASE}/api/trades/${t.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ screenshotNotes: newNotes }),
                                    });
                                    qc.invalidateQueries({ queryKey: getListTradesQueryKey() });
                                  } catch {}
                                }}
                              />
                            </div>
                          )}
                        </div>
                        <TradeActions
                          tradeId={t.id}
                          traderName={user?.role === "trader" ? user.traderName : "Guest"}
                          isCurator={dbUsers.some((u) => u.name === user?.traderName && u.role === "curator")}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && !isLoading && (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-muted-foreground text-xs font-mono">Нет трейдов</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-tight">{editing ? "Редактировать трейд" : "Новый трейд"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Тикер *</Label>
              <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="NVDA" className="font-mono bg-background h-8 text-xs uppercase" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Дата *</Label>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Side *</Label>
              <div className="flex gap-0 border border-border h-8">
                {SIDES.map((s) => (
                  <button key={s} type="button" onClick={() => set("side", s)}
                    className={`flex-1 text-xs font-mono uppercase transition-colors ${form.side === s ? (s === "Long" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30") : "text-muted-foreground hover:bg-muted"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Тип события</Label>
              <Select value={form.eventType} onValueChange={(v) => set("eventType", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                <SelectContent>{EVENT_TYPES.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Результат *</Label>
              <Select value={form.result} onValueChange={(v) => set("result", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{RESULTS.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Сессия</Label>
              <Select value={form.session} onValueChange={(v) => set("session", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SESSIONS.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Трейдер</Label>
              <Select value={form.trader} onValueChange={(v) => set("trader", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                <SelectContent>{traderNames.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(["entry", "exit", "stop", "pnl", "rMultiple", "slippage", "relativeVolume"] as const).map((field) => (
              <div key={field} className="space-y-1">
                <Label className="text-muted-foreground uppercase text-xs">{field === "entry" ? "Вход" : field === "exit" ? "Выход" : field === "stop" ? "Стоп" : field === "pnl" ? "PnL $" : field === "rMultiple" ? "R-кратное" : field === "slippage" ? "Проскальзывание" : "RVOL"}</Label>
                <Input type="number" step="any" value={form[field]} onChange={(e) => set(field, e.target.value)} className="font-mono bg-background h-8 text-xs" />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Время удержания</Label>
              <Input value={form.holdTime} onChange={(e) => set("holdTime", e.target.value)} placeholder="1h 30m" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Market Cap</Label>
              <Input value={form.marketCap} onChange={(e) => set("marketCap", e.target.value)} placeholder="Large Cap" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Float</Label>
              <Input value={form.float} onChange={(e) => set("float", e.target.value)} placeholder="2.45B" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5"><Tag className="h-3 w-3" />Теги</Label>
              <TagSelector 
                selectedTags={form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : []}
                onChange={(tags) => set("tags", tags.join(", "))}
              />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Заметки</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Что сработало</Label>
              <Textarea value={form.whatWorked} onChange={(e) => set("whatWorked", e.target.value)} rows={2} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Что не сработало</Label>
              <Textarea value={form.whatFailed} onChange={(e) => set("whatFailed", e.target.value)} rows={2} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Вывод</Label>
              <Textarea value={form.conclusion} onChange={(e) => set("conclusion", e.target.value)} rows={2} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 md:col-span-4">
              <ScreenshotFields
                urls={form.screenshotUrls}
                onChange={(urls) => setForm((f) => ({ ...f, screenshotUrls: urls }))}
                notes={form.screenshotNotes}
                onNotesChange={(notes) => setForm((f) => ({ ...f, screenshotNotes: notes }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-mono uppercase text-xs">Отмена</Button>
            <Button onClick={handleSave} disabled={isPending || !form.ticker} className="font-mono uppercase text-xs">
              {isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Удалить трейд?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {deleting?.ticker} — {deleting?.date?.substring(0, 10)}. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate({ id: deleting.id })} className="font-mono text-xs uppercase bg-red-600 hover:bg-red-700">Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
