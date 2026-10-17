/**
 * «Эталоны» — gallery of example trades across every setup the viewer can read, scoped by the page's space bar.
 * Filters (kept in the URL, so a link shows the same selection): tier (gt), setup (gs), trader (gtr), period (gp).
 * Tier 1 is the default — the showcase of textbook trades. Someone else's trade shows R only (playbookPrivacy).
 * Cards open the setup on its «Эталоны» tab. Data: GET /api/playbook-tools/gallery.
 */
import * as React from "react";
import { Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, Segmented } from "@/components/ds";
import { addDays, nyDate } from "@/lib/trading-date";
import { notLiveMessage, useGallery } from "./api";
import { ExampleCard, checklistOf } from "./examples-board";
import { RedactedHint } from "./setup-bits";
import { useUrlParams } from "./url-state";
import type { PlaybookEntry, SetupExample, SpaceTab } from "./model";

type TierF = "1" | "2" | "3" | "all";
type PeriodF = "30" | "90" | "365" | "all";
export type GalleryScope = SpaceTab | "all";

const TIER_OPTIONS: { value: TierF; label: string }[] = [
  { value: "1", label: "Tier 1 · эталоны" },
  { value: "2", label: "Tier 2" },
  { value: "3", label: "Tier 3 · на разбор" },
  { value: "all", label: "Все" },
];
const PERIODS: { value: PeriodF; label: string }[] = [
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "365", label: "Год" },
  { value: "all", label: "Всё время" },
];
const DEFAULTS = { gt: "1", gp: "all" };

const isTier = (v: string | null): v is TierF => v === "1" || v === "2" || v === "3" || v === "all";
const isPeriod = (v: string | null): v is PeriodF => PERIODS.some((p) => p.value === v);

/** Server space filter for the page scope; «Команда» has no server filter — narrowed on the client. */
function serverSpace(scope: GalleryScope): string | null {
  if (scope === "office") return "office";
  if (scope === "mine") return "personal";
  if (scope === "shared") return "shared";
  return null;
}

export function Gallery({
  entries, scope, viewerName, onOpenSetup,
}: {
  entries: PlaybookEntry[];
  scope: GalleryScope;
  viewerName: string | null;
  onOpenSetup: (id: number) => void;
}) {
  const { params, set } = useUrlParams();
  const tier: TierF = isTier(params.get("gt")) ? (params.get("gt") as TierF) : "1";
  const period: PeriodF = isPeriod(params.get("gp")) ? (params.get("gp") as PeriodF) : "all";
  const setupId = Number(params.get("gs")) || null;
  const trader = params.get("gtr") ?? "";
  const from = period === "all" ? null : addDays(nyDate(), -Number(period));

  const q = useGallery({ tier: tier === "all" ? undefined : Number(tier), setupId, space: serverSpace(scope), from, limit: 300 });
  const byId = React.useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const scoped: SetupExample[] = React.useMemo(() => {
    const all = q.data ?? [];
    if (scope !== "team") return all;
    return all.filter((x) => x.setupSpace === "personal" && x.setupOwner !== viewerName);
  }, [q.data, scope, viewerName]);
  // Trader filter for everyone, built from what the scope shows (R-only for other people's trades).
  const traders = React.useMemo(() => [...new Set(scoped.map((x) => x.trader).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ru")), [scoped]);
  const items = React.useMemo(() => (trader ? scoped.filter((x) => x.trader === trader) : scoped), [scoped, trader]);
  const setups = React.useMemo(() => {
    const ids = new Set((q.data ?? []).map((x) => x.playbookId));
    if (setupId) ids.add(setupId);
    return [...entries].filter((e) => ids.has(e.id) || !q.data).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [entries, q.data, setupId]);
  const live = q.isError ? notLiveMessage(q.error) : null;
  const setupCount = new Set(items.map((x) => x.playbookId)).size;
  const filtered = tier !== "1" || period !== "all" || !!setupId || !!trader;

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      {!live && (
        <div className="glass-panel flex flex-wrap items-center gap-2 rounded-2xl p-2">
          <Segmented<TierF> ariaLabel="Тир" size="sm" value={tier} onChange={(v) => set({ gt: v }, DEFAULTS)} options={TIER_OPTIONS} />
          <Select value={period} onValueChange={(v) => set({ gp: v }, DEFAULTS)}>
            <SelectTrigger className="h-9 w-36" aria-label="Период"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={setupId ? String(setupId) : "__all"} onValueChange={(v) => set({ gs: v === "__all" ? null : v })}>
            <SelectTrigger className="h-9 w-full min-w-0 sm:w-72" aria-label="Сетап"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-[min(60dvh,480px)]">
              <SelectItem value="__all">Все сетапы</SelectItem>
              {setups.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={trader || "__all"} onValueChange={(v) => set({ gtr: v === "__all" ? null : v })} disabled={!traders.length && !trader}>
            <SelectTrigger className="h-9 w-full min-w-0 sm:w-48" aria-label="Трейдер"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-[min(60dvh,480px)]">
              <SelectItem value="__all">Все трейдеры</SelectItem>
              {(trader && !traders.includes(trader) ? [trader, ...traders] : traders).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          {filtered && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => set({ gt: null, gp: null, gs: null, gtr: null })}>
              <X className="h-4 w-4" aria-hidden="true" /> Сбросить
            </Button>
          )}
          {items.length > 0 && (
            <span className="ml-auto px-1 text-sm tabular-nums text-muted-foreground">
              {items.length} · {setupCount} {setupCount === 1 ? "сетап" : setupCount < 5 ? "сетапа" : "сетапов"}
            </span>
          )}
        </div>
      )}
      {!q.isLoading && !q.isError && items.some((x) => x.redacted) && <RedactedHint />}

      {q.isLoading ? (
        <div className="grid min-h-[480px] grid-cols-1 gap-[var(--grid-gap)] sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-[var(--glass-bg)] motion-reduce:animate-none" />)}
        </div>
      ) : q.isError ? (
        <div className="glass-panel rounded-2xl">
          <EmptyState
            icon={Trophy}
            title={live ?? "Не удалось загрузить галерею"}
            description={live ? "Галерея эталонов появится после перезапуска API." : (q.error as Error)?.message}
            action={live ? undefined : <Button variant="outline" onClick={() => q.refetch()}>Повторить</Button>}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="glass-panel rounded-2xl">
          <EmptyState
            icon={Trophy}
            title={tier === "1" && !filtered ? "Эталонов Tier 1 здесь пока нет" : "Ничего не найдено"}
            description="Добавьте сделку кнопкой «В плейбук» — в карточке сделки, в списке сделок или в «Разобрать сделки» на главной плейбука."
            action={filtered ? <Button variant="outline" onClick={() => set({ gt: null, gp: null, gs: null, gtr: null })}>Сбросить фильтры</Button> : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[var(--grid-gap)] sm:grid-cols-2 xl:grid-cols-3">
          {items.map((ex) => {
            const setup = byId.get(ex.playbookId);
            return (
              <ExampleCard
                key={ex.id}
                ex={ex}
                setupId={ex.playbookId}
                checklist={setup ? checklistOf(setup) : []}
                editable={false}
                header={
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenSetup(ex.playbookId)}
                      className="-mx-1 min-w-0 truncate rounded px-1 text-left text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={ex.setupFolder ? `${ex.setupFolder} / ${ex.setupName}` : ex.setupName}
                    >
                      {ex.setupName ?? setup?.name ?? `Сетап #${ex.playbookId}`}
                    </button>
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--glass-bg)] px-2 py-0.5 text-xs text-muted-foreground">
                      {ex.setupSpace === "office" ? "Офис" : ex.setupOwner === viewerName ? "Мой" : ex.setupOwner ?? "Личный"}
                    </span>
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
