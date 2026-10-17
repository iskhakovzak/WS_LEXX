/**
 * «Галерея эталонов» — Tier-1 (by default) example trades across all setups the viewer can read.
 * Filters: tier, setup, trader (staff), space. Cards open the setup on its «Эталоны» tab.
 * Data: GET /api/playbook-tools/gallery.
 */
import * as React from "react";
import { Trophy } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, Segmented } from "@/components/ds";
import { notLiveMessage, useGallery } from "./api";
import { ExampleCard, checklistOf } from "./examples-board";
import { RedactedHint } from "./setup-bits";
import type { PlaybookEntry } from "./model";

type TierF = "1" | "2" | "3" | "all";
type SpaceF = "all" | "office" | "personal";

export function Gallery({ entries, onOpenSetup }: { entries: PlaybookEntry[]; onOpenSetup: (id: number) => void }) {
  const { isCurator, dbUsers } = useAuth();
  const [tier, setTier] = React.useState<TierF>("1");
  const [space, setSpace] = React.useState<SpaceF>("all");
  const [setupId, setSetupId] = React.useState<number | null>(null);
  const [trader, setTrader] = React.useState<string>("");
  const q = useGallery({ tier: tier === "all" ? undefined : Number(tier), setupId, trader: trader || null, space: space === "all" ? null : space, limit: 160 });
  const byId = React.useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const setups = React.useMemo(() => [...entries].sort((a, b) => a.name.localeCompare(b.name, "ru")), [entries]);
  const items = q.data ?? [];
  const live = q.isError ? notLiveMessage(q.error) : null;

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      {!live && (
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<TierF>
          ariaLabel="Тир"
          size="sm"
          value={tier}
          onChange={setTier}
          options={[{ value: "1", label: "Tier 1" }, { value: "2", label: "Tier 2" }, { value: "3", label: "Ошибки" }, { value: "all", label: "Все" }]}
        />
        <Select value={space} onValueChange={(v) => setSpace(v as SpaceF)}>
          <SelectTrigger className="h-9 w-48" aria-label="Пространство"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все пространства</SelectItem>
            <SelectItem value="office">Офис</SelectItem>
            <SelectItem value="personal">Личные и общие</SelectItem>
          </SelectContent>
        </Select>
        <Select value={setupId ? String(setupId) : "__all"} onValueChange={(v) => setSetupId(v === "__all" ? null : Number(v))}>
          <SelectTrigger className="h-9 w-64" aria-label="Сетап"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="__all">Все сетапы</SelectItem>
            {setups.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {isCurator && (
          <Select value={trader || "__all"} onValueChange={(v) => setTrader(v === "__all" ? "" : v)}>
            <SelectTrigger className="h-9 w-44" aria-label="Трейдер"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Все трейдеры</SelectItem>
              {dbUsers.filter((u) => u.active !== false).map((u) => <SelectItem key={u.name} value={u.name}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {items.length > 0 && <span className="ml-auto text-sm tabular-nums text-muted-foreground">{items.length}</span>}
      </div>
      )}
      {!q.isLoading && !q.isError && items.some((x) => x.redacted) && <RedactedHint />}

      {q.isLoading ? (
        <div className="grid min-h-[480px] grid-cols-2 gap-[var(--grid-gap)] xl:grid-cols-3 2xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-[var(--glass-bg)] motion-reduce:animate-none" />)}
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
            title={tier === "1" ? "Эталонов Tier 1 пока нет" : "Ничего не найдено"}
            description="Откройте сетап → «Эталоны» → «Добавить примеры» или добавьте сделку из её карточки кнопкой «В плейбук»."
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-[var(--grid-gap)] xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((ex) => {
            const setup = byId.get(ex.playbookId);
            return (
              <ExampleCard
                key={ex.id}
                ex={ex}
                setupId={ex.playbookId}
                checklist={setup ? checklistOf(setup) : []}
                editable={false}
                compact
                header={
                  <button
                    type="button"
                    onClick={() => onOpenSetup(ex.playbookId)}
                    className="-mx-1 truncate rounded px-1 text-left text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={ex.setupFolder ? `${ex.setupFolder} / ${ex.setupName}` : ex.setupName}
                  >
                    {ex.setupName ?? setup?.name ?? `Сетап #${ex.playbookId}`}
                    {ex.setupSpace === "personal" && ex.setupOwner && <span className="font-normal text-muted-foreground"> · {ex.setupOwner}</span>}
                  </button>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
