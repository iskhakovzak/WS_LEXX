import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { getListResearchQueryKey } from "@workspace/api-client-react";
import { BookOpen, ExternalLink, Link2, LineChart, Unlink } from "lucide-react";
import { Pill, toneOf, toneText, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { splitTickers, type ResearchNote } from "./research-utils";

/* Evidence for a research note: trades linked through `trades.pattern_id`
 * (`GET /api/research/:id/trades`, scoped to the viewer) and the playbook setups promoted from it.
 * All numbers come from the shared API math — WR excludes BE, net = gross − |fees|. */

type LinkedTrade = {
  id: number; ticker: string; date: string; exitDate: string | null; closeDate: string; side: string | null; setup: string | null;
  result: string | null; horizon: string | null; pnl: number | null; fees: number | null; netPnl: number | null; rMultiple: number | null; signedR: number | null;
  trader: string | null; source: string | null; brokerAccount: string | null; qty: number | null; linked: boolean;
};
type TradeStats = { n: number; wins: number; losses: number; be: number; open: number; winRate: number | null; sumR: number | null; grossPnl: number | null; fees: number | null; netPnl: number | null };
type TradesPayload = { scope: string | null; trades: LinkedTrade[]; stats: TradeStats };
type PlaybookLite = { id: number; name: string; folder?: string | null; sourceType: string | null; sourceId: number | null };

const MIN_EVIDENCE = 5;

export function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.abs(n).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  return n < 0 ? `−$${s}` : `$${s}`;
}

function Stat({ label, value, sub, tone, title }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; title?: string }) {
  return (
    <div className="rounded-xl bg-[var(--glass-bg)] p-2.5" title={title}>
      <div className="micro-label">{label}</div>
      <div className={cn("mt-0.5 text-base font-semibold tabular-nums", tone && toneText(tone))}>{value}</div>
      {sub && <div className="text-2xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function ResearchEvidence({ r }: { r: ResearchNote }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = useAuth();
  const [tradeId, setTradeId] = useState("");
  const ticker = splitTickers(r.ticker)[0];

  const q = useQuery({
    queryKey: ["research-trades", r.id],
    queryFn: async (): Promise<TradesPayload | null> => {
      const res = await fetch(`${BASE}/api/research/${r.id}/trades`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as TradesPayload;
    },
    staleTime: 60_000,
    retry: false,
  });

  // Setups promoted from this note (playbook.source_type = research). Same cache prefix as AddToPlaybook's invalidation.
  const lineage = useQuery({
    queryKey: ["playbook", "lineage"],
    queryFn: async (): Promise<PlaybookLite[]> => {
      const res = await fetch(`${BASE}/api/playbook`);
      if (!res.ok) return [];
      const data = (await res.json()) as PlaybookLite[] | { items?: PlaybookLite[] };
      return Array.isArray(data) ? data : data.items ?? [];
    },
    staleTime: 60_000,
    retry: false,
  });
  const promoted = (lineage.data ?? []).filter((p) => p.sourceType === "research" && p.sourceId === r.id);
  const playbookIds = new Set<number>(promoted.map((p) => p.id));
  if (r.playbookId != null) playbookIds.add(r.playbookId);

  // Self-heal lineage: the note remembers the first setup promoted from it (PATCH {playbookId}).
  const healTarget = r.playbookId == null && promoted[0]?.id;
  useEffect(() => {
    if (!canEdit || !healTarget) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/research/${r.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playbookId: healTarget }),
        });
        if (res.ok && !cancelled) void qc.invalidateQueries({ queryKey: getListResearchQueryKey() });
      } catch { /* lineage is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [canEdit, healTarget, r.id, qc]);

  const link = useMutation({
    mutationFn: async ({ id, unlink }: { id: number; unlink: boolean }) => {
      const res = await fetch(`${BASE}/api/research/${r.id}/link-trade`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tradeId: id, unlink }),
      });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error ?? `HTTP ${res.status}`); }
    },
    onSuccess: (_d, v) => {
      setTradeId("");
      void qc.invalidateQueries({ queryKey: ["research-trades", r.id] });
      void qc.invalidateQueries({ queryKey: getListResearchQueryKey() });
      toast({ title: v.unlink ? "Сделка отвязана" : "Сделка привязана к заметке" });
    },
    onError: (e) => toast({ title: "Не удалось изменить привязку", description: (e as Error).message, variant: "destructive" }),
  });

  if (q.data === null) return null; // endpoint not deployed
  // Live payload when available, else the evidence summary that rides along with the list.
  const stats: TradeStats | null = q.data?.stats
    ?? (r.evidence ? { ...r.evidence, n: r.evidence.tradeCount, open: 0 } : null);
  const n = stats?.n ?? 0;
  const decided = (stats?.wins ?? 0) + (stats?.losses ?? 0);
  const trades = q.data?.trades ?? [];
  const playbookList = Array.from(playbookIds);

  return (
    <section className="rounded-xl border border-border/70 p-3.5" aria-label="Доказательная база">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold"><LineChart className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Сделки по паттерну</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {q.data?.scope && <Pill tone="neutral" className="text-2xs">{q.data.scope}</Pill>}
          {ticker && <Link href={links.trades({ ticker })} className="text-primary hover:underline">сделки {ticker}</Link>}
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="mt-3 h-12 rounded-xl" />
      ) : q.isError ? (
        <p className="mt-2 text-xs text-muted-foreground">Не удалось загрузить сделки.</p>
      ) : (
        <>
          {stats && n > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Сделок" value={n} sub={stats.open ? `${stats.open} откр.` : undefined} />
              <Stat
                label="Win rate"
                value={stats.winRate != null ? `${Math.round(stats.winRate)}%` : "—"}
                sub={<>{stats.wins}W / {stats.losses}L{stats.be ? ` · BE ${stats.be}` : ""}</>}
                tone={stats.winRate == null ? "neutral" : stats.winRate >= 50 ? "up" : "down"}
              />
              <Stat label="ΣR" value={stats.sumR != null ? `${stats.sumR > 0 ? "+" : ""}${stats.sumR.toFixed(1)}R` : "—"} tone={stats.sumR != null ? toneOf(stats.sumR) : "neutral"} />
              <Stat
                label="P&L нетто"
                value={fmtUsd(stats.netPnl)}
                sub={stats.grossPnl != null ? `брутто ${fmtUsd(stats.grossPnl)} · комиссии ${fmtUsd(stats.fees)}` : undefined}
                tone={stats.netPnl != null ? toneOf(stats.netPnl) : "neutral"}
              />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Пока ни одной сделки не привязано — уверенность остаётся ручной оценкой.</p>
          )}
          {n > 0 && decided < MIN_EVIDENCE && (
            <p className="mt-2 text-2xs text-muted-foreground">Ручная оценка уверенности до {MIN_EVIDENCE} закрытых сделок (сейчас {decided}).</p>
          )}

          {trades.length > 0 && (
            <ul className="mt-3 flex flex-col">
              {trades.map((t) => {
                const res = t.result?.toLowerCase();
                const tone = res === "win" ? "up" : res === "loss" ? "down" : "neutral";
                const rr = t.signedR ?? t.rMultiple;
                return (
                  <li key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--glass-hover-bg)]">
                    <Link href={links.trade(t.id)} className="flex min-w-0 flex-1 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="font-semibold text-foreground">{t.ticker}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{t.date}</span>
                      {t.side && <span className="text-xs text-muted-foreground">{t.side}</span>}
                      {t.setup ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.setup}</span> : <span className="flex-1" />}
                      {t.trader && <span className="hidden text-xs text-muted-foreground sm:inline">{t.trader}</span>}
                      {t.brokerAccount && <span className="hidden text-2xs text-muted-foreground lg:inline">{t.brokerAccount}</span>}
                      {rr != null && <span className={cn("text-xs font-semibold tabular-nums", toneText(toneOf(rr)))}>{rr > 0 ? "+" : ""}{rr.toFixed(1)}R</span>}
                      {t.netPnl != null && <span className={cn("text-xs tabular-nums", toneText(toneOf(t.netPnl)))} title={`брутто ${fmtUsd(t.pnl)} · комиссии ${fmtUsd(t.fees)}`}>{fmtUsd(t.netPnl)}</span>}
                      <Pill tone={tone} className="text-2xs">{t.result ?? "open"}</Pill>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    </Link>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label="Отвязать сделку"
                        title="Отвязать"
                        disabled={link.isPending}
                        onClick={() => link.mutate({ id: t.id, unlink: true })}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-bg)] hover:text-foreground"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canEdit && (
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); const id = Number(tradeId); if (Number.isInteger(id) && id > 0) link.mutate({ id, unlink: false }); }}
            >
              <label htmlFor={`rs-link-${r.id}`} className="sr-only">ID сделки</label>
              <Input id={`rs-link-${r.id}`} value={tradeId} onChange={(e) => setTradeId(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="ID сделки" className="h-8 w-28 text-sm" />
              <Button type="submit" variant="outline" size="sm" disabled={!tradeId || link.isPending}><Link2 className="h-3.5 w-3.5" /> Привязать</Button>
              <span className="text-2xs text-muted-foreground">только свои сделки; ID виден в журнале</span>
            </form>
          )}
        </>
      )}

      {playbookList.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3 text-xs">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">В плейбуке:</span>
          {playbookList.map((id) => {
            const p = promoted.find((x) => x.id === id);
            return (
              <Link key={id} href={links.setup(id)} className="chip inline-flex min-h-7 items-center gap-1 px-2.5 text-xs text-primary hover:underline">
                {p?.name ?? `сетап #${id}`}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
