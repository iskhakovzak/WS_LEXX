import React, { useState, useEffect, useMemo, useRef, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { Pill } from "@/components/ds";
import { BookOpen, FolderPlus, Folder, Inbox, AlertTriangle, Loader2, X, GitBranch, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toneText } from "@/components/ds";
import { ApiError, invalidateExamples, invalidateTradeLinks, notLiveMessage, pbRequest } from "@/components/playbook/api";
import { TIERS, ddmm, fmtUsd, moneyTone, tierMeta, type Tier } from "@/components/playbook/model";
import { useToast } from "@/hooks/use-toast";
import { safeHttpUrl } from "@/lib/url";
import { useAuth } from "@/contexts/auth-context";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

const tok = () => { try { return localStorage.getItem("ws_lexx_token") ?? ""; } catch { return ""; } };
const authHdr = () => tok() ? { Authorization: `Bearer ${tok()}` } : {} as Record<string, string>;

const LAST_FOLDER_KEY = "ws_lexx_playbook_last_folder";
function readLastFolder(): string {
  try { return localStorage.getItem(LAST_FOLDER_KEY) ?? ""; } catch { return ""; }
}
function writeLastFolder(f: string) {
  try { if (f) localStorage.setItem(LAST_FOLDER_KEY, f); else localStorage.removeItem(LAST_FOLDER_KEY); } catch { /* storage blocked */ }
}

export type PlaybookPayload = {
  name: string;
  setupType?: string;
  conditions?: string;
  checklist?: string;
  notes?: string;
  confidenceLevel?: number | null;
  screenshotUrl?: string;
  screenshotNotes?: string;
  tags?: string;
  ticker?: string;
  marketCap?: string | null;
  float?: string | null;
  adv?: string | null;
  atr?: number | null;
  relativeVolume?: number | null;
  beta?: number | null;
  shortInterest?: number | null;
  sector?: string | null;
  longName?: string | null;
  sourceType: "trade" | "research" | "dailyfeed" | "event" | "watchlist" | "trade_idea";
  sourceId: number;
};

type PlaybookEntry = {
  id: number;
  name: string;
  folder: string | null;
  parentId: number | null;
  sourceType: string | null;
  sourceId: number | null;
};

const SOURCE_LABEL: Record<PlaybookPayload["sourceType"], string> = {
  trade: "Сделка",
  research: "Ресёрч",
  event: "Событие",
  watchlist: "Вотчлист",
  trade_idea: "Идея",
  dailyfeed: "Дневная лента",
};

/**
 * «В плейбук».
 * For a trade (sourceType "trade") it opens a 1–2-click popover: pick a setup (suggested by auto-classification,
 * recent, or search), a tier (Tier 1 эталон / Tier 2 / Tier 3 ошибка) and an optional note → the trade becomes an
 * example of that setup. «Новый сетап из сделки» still opens the full dialog. Older API (no examples endpoints) →
 * the dialog opens directly. Other sources (research, events, ideas…) keep the dialog.
 */
export function AddToPlaybookButton({
  payload,
  size = "sm",
  className,
  label = "В плейбук",
}: {
  payload: PlaybookPayload;
  size?: "sm" | "icon";
  /** Optional: extra classes for the trigger. */
  className?: string;
  /** Optional: trigger text for size="sm". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const quick = payload.sourceType === "trade" && Number.isSafeInteger(payload.sourceId) && payload.sourceId > 0;
  const onTrigger = (e: React.MouseEvent) => { e.stopPropagation(); if (!quick) setOpen(true); };

  const trigger = size === "icon" ? (
    <button
      type="button"
      aria-label="Добавить в плейбук"
      onClick={onTrigger}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      title="Добавить в плейбук"
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={onTrigger} className={className}>
      <BookOpen aria-hidden="true" /> {label}
    </Button>
  );

  return (
    <>
      {quick ? (
        <Popover open={quickOpen} onOpenChange={setQuickOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[400px] p-0"
            onClick={(e) => e.stopPropagation()}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {quickOpen && (
              <TradeQuickAdd
                tradeId={payload.sourceId}
                onClose={() => setQuickOpen(false)}
                onNewSetup={() => { setQuickOpen(false); setOpen(true); }}
              />
            )}
          </PopoverContent>
        </Popover>
      ) : (
        trigger
      )}
      <AddToPlaybookDialog open={open} onOpenChange={setOpen} payload={payload} />
    </>
  );
}

/* ───────────────────────── 1–2-click popover for a trade ───────────────────────── */

type ForTradeSetup = {
  id: number; name: string; folder: string | null; space: "office" | "personal"; mine: boolean; shared: boolean;
  owner: string | null; canAddExamples: boolean; setupType: string | null; tags: string | null;
};
type ForTrade = {
  trade: { id: number; ticker: string; date: string | null; trader: string | null; setup: string | null; playbookId: number | null; netPnl: number | null; autoSetup?: string | null } | null;
  setups: ForTradeSetup[];
  recent: number[];
  suggested: { id: number; reason: string }[];
  examples: { id: number; playbookId: number; tier: Tier; note: string | null }[];
};

function spaceLabel(s: ForTradeSetup) {
  if (s.space === "office") return "Офис";
  if (s.mine) return "Мой";
  return s.owner ?? "Личный";
}

function TradeQuickAdd({ tradeId, onClose, onNewSetup }: { tradeId: number; onClose: () => void; onNewSetup: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fid = useId();
  const q = useQuery<ForTrade>({
    queryKey: ["playbook-for-trade", tradeId],
    queryFn: () => pbRequest<ForTrade>(`/api/playbook-tools/for-trade/${tradeId}`),
    staleTime: 15_000,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  });
  const notLive = q.isError && !!notLiveMessage(q.error);
  // Older API: no quick add — fall back to the «new setup» dialog.
  useEffect(() => { if (notLive) onNewSetup(); }, [notLive]); // eslint-disable-line react-hooks/exhaustive-deps

  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [tier, setTier] = useState<Tier>(1);
  const [note, setNote] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = window.setTimeout(() => searchRef.current?.focus(), 30); return () => window.clearTimeout(t); }, []);

  const data = q.data;
  const writable = useMemo(() => (data?.setups ?? []).filter((s) => s.canAddExamples), [data]);
  const byId = useMemo(() => new Map((data?.setups ?? []).map((s) => [s.id, s])), [data]);
  const existing = useMemo(() => new Map((data?.examples ?? []).map((e) => [e.playbookId, e])), [data]);
  const reasons = useMemo(() => new Map((data?.suggested ?? []).map((s) => [s.id, s.reason])), [data]);

  type Row = { s: ForTradeSetup; group: string };
  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (term) {
      const terms = term.split(/\s+/);
      return writable
        .filter((s) => { const h = `${s.name} ${s.folder ?? ""} ${s.setupType ?? ""} ${s.tags ?? ""}`.toLowerCase(); return terms.every((t) => h.includes(t)); })
        .slice(0, 40)
        .map((s) => ({ s, group: "Найдено" }));
    }
    const out: Row[] = [];
    const seen = new Set<number>();
    const push = (id: number, group: string) => {
      const s = byId.get(id);
      if (!s || !s.canAddExamples || seen.has(id)) return;
      seen.add(id); out.push({ s, group });
    };
    for (const sg of data.suggested) push(sg.id, "Подходят по сделке");
    for (const id of data.recent) push(id, "Недавние");
    if (out.length < 6) for (const s of writable) { if (out.length >= 8) break; push(s.id, "Все сетапы"); }
    return out;
  }, [data, search, writable, byId]);

  // Preselect the best guess so the common case is one click on «Добавить».
  useEffect(() => {
    if (!rows.length) { setPicked(null); return; }
    if (picked == null || !rows.some((r) => r.s.id === picked)) setPicked(rows[0].s.id);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ex = picked != null ? existing.get(picked) : undefined;
    if (ex) { setTier(ex.tier); setNote(ex.note ?? ""); }
  }, [picked, existing]);

  const target = picked != null ? byId.get(picked) ?? null : null;
  const already = picked != null ? existing.get(picked) : undefined;

  const add = useMutation({
    mutationFn: (setupId: number) => pbRequest<{ examples: { id: number }[]; skipped: { reason: string }[] }>(`/api/playbook/${setupId}/examples`, {
      method: "POST",
      json: { tradeIds: [tradeId], tier, note: note.trim() || null },
    }),
    onSuccess: (r, setupId) => {
      if (!r.examples?.length) {
        toast({ title: "Сделку не удалось добавить", description: r.skipped?.[0]?.reason === "forbidden" ? "Нет доступа к сделке" : undefined, variant: "destructive" });
        return;
      }
      const s = byId.get(setupId);
      invalidateExamples(qc, setupId);
      invalidateTradeLinks(qc);
      qc.invalidateQueries({ queryKey: ["playbook"] });
      toast({
        title: existing.has(setupId) ? `Обновлено: ${tierMeta(tier).label}` : `В «${s?.name ?? "сетап"}» · ${tierMeta(tier).label}`,
        description: s?.space === "office" ? "Эталон в плейбуке офиса" : undefined,
        action: <ToastAction altText="Открыть эталоны сетапа" onClick={() => navigate(`/playbook?id=${setupId}&tab=examples`)}>Открыть</ToastAction>,
      });
      onClose();
    },
    onError: (e) => toast({ title: "Не удалось добавить", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });
  const canAdd = picked != null && !!target?.canAddExamples && !add.isPending;
  const submit = (id: number | null = picked) => { if (id != null && byId.get(id)?.canAddExamples && !add.isPending) add.mutate(id); };

  const move = (delta: 1 | -1) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.s.id === picked);
    const next = rows[Math.max(0, Math.min(rows.length - 1, (i < 0 ? -1 : i) + delta))];
    setPicked(next.s.id);
    listRef.current?.querySelector(`[data-pick="${next.s.id}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const t = data?.trade;
  const net = t?.netPnl ?? null;

  if (q.isLoading || notLive) {
    return (
      <div className="flex min-h-[320px] flex-col gap-2 p-[var(--panel-p)]" aria-busy="true">
        <div className="h-5 w-2/3 animate-pulse rounded bg-[var(--glass-bg)] motion-reduce:animate-none" />
        <div className="h-9 animate-pulse rounded-xl bg-[var(--glass-bg)] motion-reduce:animate-none" />
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--glass-bg)] motion-reduce:animate-none" />)}
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="flex flex-col gap-3 p-[var(--panel-p)]">
        <p className="text-sm text-down">{(q.error as Error)?.message ?? "Не удалось загрузить сетапы"}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Повторить</Button>
          <Button size="sm" variant="ghost" onClick={onNewSetup}>Новый сетап из сделки</Button>
        </div>
      </div>
    );
  }

  let lastGroup = "";
  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
        if (e.altKey && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); setTier(Number(e.key) as Tier); }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-[var(--panel-p)] py-3">
        <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          Эталон в плейбук{t ? ` · ${t.ticker}` : ""}{t?.date ? ` · ${ddmm(t.date)}` : ""}
        </span>
        {net != null && <span className={cn("shrink-0 text-sm font-semibold tabular-nums", toneText(moneyTone(net)))}>{fmtUsd(net)}</span>}
      </div>

      <div className="flex flex-col gap-3 p-[var(--panel-p)]">
        {existing.size > 0 && (
          <p className="text-xs text-muted-foreground">
            Уже в плейбуке:{" "}
            {[...existing.values()].map((ex, i) => (
              <span key={ex.id}>
                {i > 0 && ", "}
                <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={() => { onClose(); navigate(`/playbook?id=${ex.playbookId}&tab=examples`); }}>
                  {byId.get(ex.playbookId)?.name ?? `#${ex.playbookId}`}
                </button>{" "}
                <span className="tabular-nums">T{ex.tier}</span>
              </span>
            ))}
          </p>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
              if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); submit(); }
            }}
            placeholder="Найти сетап"
            aria-label="Найти сетап"
            aria-controls={`${fid}-list`}
            className="h-9 pl-9"
          />
        </div>

        <ul id={`${fid}-list`} ref={listRef} role="listbox" aria-label="Сетап" className="-mx-1 max-h-60 min-h-[120px] overflow-y-auto px-1">
          {rows.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              {writable.length === 0 ? "Нет сетапов, куда можно добавить эталон. Создайте свой." : "Ничего не найдено"}
            </li>
          ) : rows.map(({ s, group }) => {
            const head = group !== lastGroup ? group : null;
            lastGroup = group;
            const active = picked === s.id;
            const reason = reasons.get(s.id);
            const ex = existing.get(s.id);
            return (
              <React.Fragment key={s.id}>
                {head && <li role="presentation" className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground first:pt-0">{head}</li>}
                <li
                  role="option"
                  aria-selected={active}
                  data-pick={s.id}
                  onClick={() => setPicked(s.id)}
                  onDoubleClick={() => { setPicked(s.id); submit(s.id); }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5",
                    active ? "bg-primary/15" : "hover:bg-[var(--glass-hover-bg)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm text-foreground", active ? "font-semibold" : "font-medium")}>{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{reason ?? s.folder ?? "Без папки"}</span>
                  </span>
                  {ex && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">T{ex.tier}</span>}
                  <span className="shrink-0 rounded-full bg-[var(--glass-bg)] px-2 py-0.5 text-xs text-muted-foreground">{spaceLabel(s)}</span>
                </li>
              </React.Fragment>
            );
          })}
        </ul>

        <div role="radiogroup" aria-label="Тир" className="grid grid-cols-3 gap-1.5">
          {TIERS.map((x) => {
            const [top, bottom] = x.label.split(" · ");
            return (
              <button
                key={x.tier}
                type="button"
                role="radio"
                aria-checked={tier === x.tier}
                title={`${x.hint} (Alt+${x.tier})`}
                onClick={() => setTier(x.tier)}
                className={cn(
                  "flex min-h-9 flex-col items-center justify-center rounded-xl border px-2 py-1 text-xs transition-colors duration-[var(--dur-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tier === x.tier ? "border-primary/60 bg-primary/10 font-semibold text-foreground" : "border-border/60 text-muted-foreground hover:bg-[var(--glass-hover-bg)]",
                )}
              >
                <span>{top}</span>
                {bottom && <span className="font-normal">{bottom}</span>}
              </button>
            );
          })}
        </div>

        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="Заметка: почему эталон / в чём ошибка (необязательно)"
          aria-label="Заметка к эталону"
          maxLength={2000}
          className="h-9"
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-[var(--panel-p)] py-3">
        <button type="button" onClick={onNewSetup} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Новый сетап из сделки
        </button>
        <Button size="sm" className="bg-primary-solid" onClick={() => submit()} disabled={!canAdd} aria-busy={add.isPending} title="Enter или Ctrl+Enter">
          {add.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {already ? "Обновить" : "Добавить"}
        </Button>
      </div>
    </div>
  );
}

function AddToPlaybookDialog({ open, onOpenChange, payload }: { open: boolean; onOpenChange: (v: boolean) => void; payload: PlaybookPayload }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const trader = user?.role === "trader" && user.traderName ? user.traderName : null;
  const [folder, setFolder] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [name, setName] = useState(payload.name);
  const [notes, setNotes] = useState(payload.notes || "");
  const [parentSetupId, setParentSetupId] = useState("");
  const fid = useId();

  // Reset the form only when the dialog opens. `payload` is usually an inline object literal, so
  // depending on it would wipe what the user typed on every parent re-render (polling, refetch...).
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  useEffect(() => {
    if (open) {
      const p = payloadRef.current;
      setName(p.name);
      setNotes(p.notes || "");
      setFolder(readLastFolder());
      setNewFolder("");
      setCreatingFolder(false);
      setParentSetupId("");
    }
  }, [open]);

  const { data: foldersRaw, isLoading: foldersLoading } = useQuery<string[]>({
    queryKey: ["playbook-folders"],
    queryFn: () => fetch(`${BASE}/api/playbook/folders`).then(r => r.json()),
    enabled: open,
  });
  const folders = Array.isArray(foldersRaw) ? foldersRaw.filter((f) => typeof f === "string" && f) : [];

  // Remembered folder may have been deleted/renamed since — drop it once folders are known.
  useEffect(() => {
    if (open && folder && !creatingFolder && Array.isArray(foldersRaw) && !folders.includes(folder)) setFolder("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, foldersRaw]);

  const { data: allEntriesRaw } = useQuery<PlaybookEntry[]>({
    queryKey: ["playbook-all-light"],
    queryFn: () =>
      fetch(`${BASE}/api/playbook`)
        .then(r => r.json())
        .then((rows: unknown) => (Array.isArray(rows) ? rows : []).map((r: any) => ({
          id: r.id,
          name: r.name,
          folder: r.folder ?? null,
          parentId: r.parentId ?? null,
          sourceType: r.sourceType ?? null,
          sourceId: r.sourceId ?? null,
        }))),
    enabled: open,
  });
  const allEntries = allEntriesRaw ?? [];

  const targetFolder = creatingFolder ? newFolder.trim() : folder;

  const topLevelInFolder = useMemo(() => {
    if (!targetFolder) return [];
    return allEntries.filter((e) => e.folder === targetFolder && e.parentId === null);
  }, [allEntries, targetFolder]);

  // Already added from this exact source? Or a same-name setup in the target folder?
  const duplicateSource = useMemo(
    () => allEntries.find((e) => e.sourceType === payload.sourceType && e.sourceId === payload.sourceId) ?? null,
    [allEntries, payload.sourceType, payload.sourceId],
  );
  const sameName = useMemo(() => {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    return allEntries.find((e) => e.name.trim().toLowerCase() === n && (e.folder ?? "") === (targetFolder ?? "")) ?? null;
  }, [allEntries, name, targetFolder]);

  useEffect(() => {
    setParentSetupId("");
  }, [targetFolder]);

  const openEntry = (id: number) => {
    onOpenChange(false);
    navigate(`/playbook?id=${id}`);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        folder: targetFolder || null,
        setupType: payload.setupType || null,
        conditions: payload.conditions || null,
        checklist: payload.checklist || null,
        notes: notes || null,
        confidenceLevel: payload.confidenceLevel ?? null,
        screenshotUrl: payload.screenshotUrl || null,
        screenshotNotes: payload.screenshotNotes || null,
        tags: payload.tags || null,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        trader,
        ticker: payload.ticker || null,
        marketCap: payload.marketCap ?? null,
        float: payload.float ?? null,
        adv: payload.adv ?? null,
        atr: payload.atr ?? null,
        relativeVolume: payload.relativeVolume ?? null,
        beta: payload.beta ?? null,
        shortInterest: payload.shortInterest ?? null,
        sector: payload.sector ?? null,
        longName: payload.longName ?? null,
        parentId: parentSetupId ? Number(parentSetupId) : null,
      };
      const res = await fetch(`${BASE}/api/playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHdr() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = `Ошибка сервера (${res.status})`;
        try { const d = await res.json(); if (d && typeof d.error === "string") msg = d.error; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      return res.json() as Promise<{ id?: number } | null>;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["playbook"] });
      qc.invalidateQueries({ queryKey: ["playbook-folders"] });
      qc.invalidateQueries({ queryKey: ["playbook-all-light"] });
      writeLastFolder(targetFolder);
      onOpenChange(false);
      const id = created && typeof created.id === "number" ? created.id : null;
      toast({
        title: "Добавлено в плейбук",
        description: targetFolder ? `Папка: ${targetFolder}` : "Без папки",
        action: id ? (
          <ToastAction altText="Открыть сетап в плейбуке" onClick={() => navigate(`/playbook?id=${id}`)}>Открыть</ToastAction>
        ) : undefined,
      });
    },
    onError: (e) => {
      toast({ title: "Не удалось добавить в плейбук", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    },
  });

  const canSave = name.trim().length > 0 && !(creatingFolder && !newFolder.trim()) && !saveMut.isPending;
  const save = () => { if (canSave) saveMut.mutate(); };

  const previewUrl = safeHttpUrl(payload.screenshotUrl?.split("\n")[0]);
  const shotCount = (payload.screenshotUrl ?? "").split("\n").filter((u) => safeHttpUrl(u)).length;
  const tagList = (payload.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/15 text-primary">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </span>
            Добавить в плейбук
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Сохраните сетап, чтобы разбирать и повторять его.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Source preview */}
          <div className="flex gap-3 rounded-2xl bg-[var(--glass-bg)] p-3">
            {previewUrl ? (
              <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border border-[var(--field-border)]">
                <img
                  src={previewUrl}
                  alt="Скриншот, который будет перенесён"
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                />
                {shotCount > 1 && (
                  <span className="absolute bottom-1 right-1 rounded-full bg-background/85 px-1.5 text-xs font-medium tabular-nums">+{shotCount - 1}</span>
                )}
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone="neutral">{SOURCE_LABEL[payload.sourceType] ?? "Источник"} #{payload.sourceId}</Pill>
                {payload.ticker && <Pill tone="accent">{payload.ticker.toUpperCase()}</Pill>}
                {payload.setupType && <Pill tone="purple">{payload.setupType}</Pill>}
                {payload.confidenceLevel != null && <Pill tone="neutral">Уверенность {payload.confidenceLevel}%</Pill>}
              </div>
              {tagList.length > 0 && (
                <p className="truncate text-xs text-muted-foreground" title={tagList.join(", ")}>
                  {tagList.slice(0, 5).join(" · ")}{tagList.length > 5 ? ` · +${tagList.length - 5}` : ""}
                </p>
              )}
              {previewUrl && <p className="text-xs text-muted-foreground">Скриншоты и фундаментал будут перенесены</p>}
            </div>
          </div>

          {duplicateSource && (
            <div role="status" className="flex items-start gap-2 rounded-xl bg-[hsl(var(--chart-3)/0.12)] px-3 py-2 text-sm text-[hsl(var(--chart-3))]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Уже в плейбуке: «{duplicateSource.name}»{duplicateSource.folder ? ` · ${duplicateSource.folder}` : ""}
              </span>
              <button type="button" onClick={() => openEntry(duplicateSource.id)} className="shrink-0 text-xs font-medium underline-offset-2 hover:underline">
                Открыть
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fid}-name`} className="text-xs font-normal text-muted-foreground">Название сетапа</Label>
            <Input
              id={`${fid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
              aria-invalid={!name.trim() || undefined}
              aria-describedby={sameName ? `${fid}-same` : undefined}
              placeholder="Например: Gap and Go — отчёт BMO"
              className="h-10"
            />
            {sameName && !duplicateSource && (
              <p id={`${fid}-same`} className="text-xs text-muted-foreground">
                В этой папке уже есть сетап с таким названием —{" "}
                <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => openEntry(sameName.id)}>открыть</button>
                {" "}или переименуйте.
              </p>
            )}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs text-muted-foreground">Папка</legend>
            {creatingFolder ? (
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <FolderPlus className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); setCreatingFolder(false); } }}
                    placeholder="Название новой папки"
                    aria-label="Название новой папки"
                    className="h-9 pl-10"
                    maxLength={80}
                    autoFocus
                  />
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => setCreatingFolder(false)} aria-label="Отменить создание папки" className="h-9 w-9">
                  <X aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="flex max-h-[104px] flex-wrap gap-1.5 overflow-y-auto p-0.5" role="radiogroup" aria-label="Папка">
                <FolderChip active={!folder} onClick={() => setFolder("")} icon={Inbox}>Без папки</FolderChip>
                {foldersLoading && <span className="inline-flex items-center px-2 text-xs text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />папки…</span>}
                {folders.map((f) => (
                  <FolderChip key={f} active={folder === f} onClick={() => setFolder(f)} icon={Folder}>{f}</FolderChip>
                ))}
                <button
                  type="button"
                  onClick={() => setCreatingFolder(true)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-[var(--field-border)] px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" /> Новая папка
                </button>
              </div>
            )}
          </fieldset>

          {topLevelInFolder.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fid}-parent`} className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> Вложить в сетап (вариация)
              </Label>
              <Select value={parentSetupId || "__none"} onValueChange={(v) => setParentSetupId(v === "__none" ? "" : v)}>
                <SelectTrigger id={`${fid}-parent`} className="h-9">
                  <SelectValue placeholder="Верхний уровень" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-muted-foreground">Верхний уровень (без родителя)</SelectItem>
                  {topLevelInFolder.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fid}-notes`} className="text-xs font-normal text-muted-foreground">Заметки</Label>
            <Textarea
              id={`${fid}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Что сработало, триггер входа, где был стоп…"
              className="resize-none text-sm"
            />
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
            <Kbd>Ctrl</Kbd><Kbd>Enter</Kbd> сохранить
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="button" onClick={save} disabled={!canSave} aria-busy={saveMut.isPending}>
              {saveMut.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {saveMut.isPending ? "Сохраняем…" : duplicateSource ? "Добавить ещё раз" : "Сохранить"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderChip({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Folder; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-active={active}
      onClick={onClick}
      className="chip inline-flex min-h-8 max-w-[220px] items-center gap-1.5 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </button>
  );
}
