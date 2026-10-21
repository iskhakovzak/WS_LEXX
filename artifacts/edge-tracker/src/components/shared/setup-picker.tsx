/**
 * Setup tag = one of the office playbook setups (wave 1, 1.2). One module for every place that tags a trade with a
 * setup: the S picker and bulk tagging on /trades (components/trades/review-tagging, BulkActionBar), the evening
 * journal (drop-in for components/journal) and the trade sheet. Writes go to `playbookId` (the server keeps
 * `trades.setup` = the setup's name — api lib/tradesSetupLink).
 *
 *   useOfficeSetups()               GET /api/setups-auto/setups — { id, code, name, folder, locked }[] (cached 5 min)
 *   useSetupNames(fallback)         names of the setups the viewer may tag with (unlocked), for name-based pickers
 *   useSetupSuggestion(trade)       the auto-classifier's pending suggestion mapped to an office setup (batched GET
 *                                   /api/setups-auto/for-trades for every row on screen), or null
 *   useAcceptSuggestion()           POST /api/setups-auto/:tradeId/accept — writes playbook_id, refreshes trade data
 *   <SetupPicker value onChange />  a button + searchable list (1–9 hotkeys); onChange({ id, name } | null)
 *   <SuggestionChip trade />        «✦ 1.3 ORB 5 минут» — one tap accepts the suggestion
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Lock, Sparkles } from "lucide-react";
import { Kbd } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { http } from "@/lib/api/http";
import { invalidateTradeDependents } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { tradesI18n } from "@/i18n/ns/trades";

export type OfficeSetup = { id: number; code: string | null; name: string; folder: string | null; locked: boolean };
export type SetupSuggestion = { playbookId: number; name: string; confidence: number };
export type SetupChoice = { id: number; name: string };

const SETUPS_KEY = ["setup-picker", "office-setups"] as const;
const SUGG_KEY = "setup-picker-suggestion";

export function useOfficeSetups() {
  return useQuery({
    queryKey: SETUPS_KEY,
    queryFn: async () => (await http.get<{ setups: OfficeSetup[] }>("/api/setups-auto/setups")).setups,
    staleTime: 5 * 60_000,
  });
}

/** Pure: the setups a viewer can tag with (unlocked), in playbook order. */
export function taggableSetups(list: readonly OfficeSetup[] | undefined): OfficeSetup[] {
  return (list ?? []).filter((s) => !s.locked);
}

/** Names of the taggable setups (`fallback` while the list loads or when it is unavailable). */
export function useSetupNames(fallback: readonly string[] = []): readonly string[] {
  const { data } = useOfficeSetups();
  return React.useMemo(() => (data ? taggableSetups(data).map((s) => s.name) : fallback), [data, fallback]);
}

/* ─── suggestions: one request for every row rendered in the same tick ─── */

type Waiter = { resolve: (v: SetupSuggestion | null) => void; reject: (e: unknown) => void };
const pending = new Map<number, Waiter[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const batch = new Map(pending);
  pending.clear();
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    try {
      const r = await http.get<{ items: Record<string, SetupSuggestion> }>("/api/setups-auto/for-trades", { query: { ids: chunk.join(",") } });
      for (const id of chunk) for (const w of batch.get(id) ?? []) w.resolve(r.items?.[id] ?? null);
    } catch (e) {
      for (const id of chunk) for (const w of batch.get(id) ?? []) w.reject(e);
    }
  }
}

/** Batched load of one trade's suggestion (exported for tests). */
export function loadSuggestion(tradeId: number): Promise<SetupSuggestion | null> {
  return new Promise((resolve, reject) => {
    const list = pending.get(tradeId) ?? [];
    list.push({ resolve, reject });
    pending.set(tradeId, list);
    if (!timer) timer = setTimeout(() => void flush(), 30);
  });
}

type TradeLike = { id: number; setup?: string | null; playbookId?: number | null; result?: string | null };

/** Pure: a trade may carry a pending suggestion (closed, no setup link, no setup text). */
export function wantsSuggestion(t: TradeLike): boolean {
  return t.playbookId == null && !(t.setup ?? "").trim() && (t.result ?? "").toLowerCase() !== "open";
}

export function useSetupSuggestion(trade: TradeLike, enabled = true) {
  const on = enabled && wantsSuggestion(trade);
  return useQuery({
    queryKey: [SUGG_KEY, trade.id],
    queryFn: () => loadSuggestion(trade.id),
    enabled: on,
    staleTime: 2 * 60_000,
    retry: false,
  }).data ?? null;
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { tradeId: number; playbookId?: number }) =>
      http.post<{ playbookId: number | null; setup: string }>(`/api/setups-auto/${v.tradeId}/accept`, v.playbookId ? { playbookId: v.playbookId } : {}),
    onSuccess: (_d, v) => {
      qc.setQueryData([SUGG_KEY, v.tradeId], null);
      void invalidateTradeDependents(qc, { tradeId: v.tradeId });
    },
  });
}

/** One tap: accept the classifier's office setup for a trade without a setup. Renders nothing without a suggestion. */
export function SuggestionChip({ trade, disabled, className }: { trade: TradeLike; disabled?: boolean; className?: string }) {
  const { t } = tradesI18n.useT();
  const s = useSetupSuggestion(trade, !disabled);
  const accept = useAcceptSuggestion();
  if (!s) return null;
  return (
    <button
      type="button"
      disabled={accept.isPending}
      onClick={(e) => { e.stopPropagation(); accept.mutate({ tradeId: trade.id, playbookId: s.playbookId }); }}
      title={t("setupPicker.acceptTitle", { name: s.name, pct: Math.round(s.confidence * 100) })}
      aria-label={t("setupPicker.acceptTitle", { name: s.name, pct: Math.round(s.confidence * 100) })}
      className={cn(
        "inline-flex h-6 max-w-[200px] items-center gap-1 rounded-full border border-dashed border-primary/50 px-2 text-xs text-primary hover:bg-primary/10 disabled:opacity-60",
        className,
      )}
    >
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{s.name}</span>
      <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
  );
}

/** Pure: the list filtered by a query (name or number, case-insensitive). */
export function filterSetups(list: readonly OfficeSetup[], q: string): OfficeSetup[] {
  const n = q.trim().toLowerCase();
  return n ? list.filter((s) => s.name.toLowerCase().includes(n) || (s.code ?? "").startsWith(n)) : [...list];
}

/**
 * Standalone setup picker (journal, trade sheet): the current setup's name on a button, a searchable list of the
 * viewer's office setups with 1–9 hotkeys, «убрать сетап». `value` = trades.playbook_id.
 */
export function SetupPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number | null;
  onChange: (choice: SetupChoice | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = tradesI18n.useT();
  const { data } = useOfficeSetups();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hi, setHi] = React.useState(0);
  const all = React.useMemo(() => data ?? [], [data]);
  const current = all.find((s) => s.id === value) ?? null;
  const list = React.useMemo(() => filterSetups(taggableSetups(all), q), [all, q]);
  React.useEffect(() => { if (open) { setQ(""); setHi(0); } }, [open]);

  const pick = (s: OfficeSetup | null) => {
    onChange(s ? { id: s.id, name: s.name } : null);
    setOpen(false);
  };
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!q && /^[1-9]$/.test(e.key)) { const s = list[Number(e.key) - 1]; if (s) { e.preventDefault(); pick(s); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); return; }
    if (e.key === "Enter" && list[hi]) { e.preventDefault(); pick(list[hi]); }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className={cn("max-w-full justify-between gap-1.5", className)} aria-label={t("setupPicker.label")}>
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.name ?? t("setupPicker.choose")}</span>
          {current?.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[min(92vw,300px)] p-2" onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={onKeyDown}
          placeholder={t("setupPicker.search")}
          aria-label={t("setupPicker.search")}
          className="h-8 text-sm"
        />
        <ul role="listbox" aria-label={t("setupPicker.label")} className="mt-1.5 max-h-[320px] overflow-y-auto overscroll-contain">
          {list.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={s.id === value}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(s)}
                className={cn("flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm", i === hi && "bg-[var(--glass-hover-bg)]")}
              >
                <span className="min-w-0 flex-1 truncate" title={s.name}>{s.name}</span>
                {s.id === value && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                {i < 9 && !q && <Kbd>{i + 1}</Kbd>}
              </button>
            </li>
          ))}
          {!list.length && <li className="px-2 py-2 text-xs text-muted-foreground">{t("setupPicker.empty")}</li>}
        </ul>
        {value != null && (
          <button type="button" onClick={() => pick(null)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground">
            {t("tagging.clearSetup")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
