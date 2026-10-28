/**
 * «Корпоративные и индексные события» on /events: lock-ups, S&P adds / removals, index rebalances, quad witching,
 * spin-offs, pricings, offerings and IPOs of the coming days (api routes/corp-events.ts). Rule dates and the offerings
 * feed arrive by themselves; curators / admins add the rest («+ Событие», the day of the view pre-filled) and say
 * which playbook setup each type is traded with. A ticker of mine (watchlist ∪ traded) is marked; a ticker opens its
 * history sheet, the setup opens the playbook.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton, Panel, Pill, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { corpEventsI18n } from "@/i18n/ns/corpEvents";
import { fmtDay, weekdayLabel } from "./event-meta";
import { corpEventsQuery, useCorpMutations, type CorpEvent, type CorpType } from "./corp-events-api";
import { CorpEventDialog, CorpSetupsDialog, type CorpDraft } from "./corp-events-dialog";

const TONE: Record<CorpType, Tone> = {
  lockup_expiry: "down", sp_add: "up", sp_remove: "down", index_rebalance: "accent", quad_witching: "warn",
  spinoff: "purple", pricing: "warn", offering: "warn", ipo: "purple",
};
const SHOWN_DAYS = 5;

export function CorpEventsPanel({ from, defaultDay, myTickers, onOpenTicker }: {
  from: string;
  /** The day a new entry starts on (the day the page shows). */
  defaultDay: string;
  myTickers: readonly string[];
  onOpenTicker: (ticker: string) => void;
}) {
  const { t } = corpEventsI18n.useT();
  const { toast } = useToast();
  const q = useQuery(corpEventsQuery(from));
  const mut = useCorpMutations();
  const [all, setAll] = React.useState(false);
  const [draft, setDraft] = React.useState<CorpDraft | null>(null);
  const [setupsOpen, setSetupsOpen] = React.useState(false);
  const mine = React.useMemo(() => new Set(myTickers), [myTickers]);
  const canEdit = !!q.data?.canEdit;

  const days = React.useMemo(() => {
    const by = new Map<string, CorpEvent[]>();
    for (const e of q.data?.events ?? []) by.set(e.day, [...(by.get(e.day) ?? []), e]);
    // My tickers first inside a day: what concerns me is read first.
    return [...by.entries()].map(([day, list]) => [day, [...list].sort((a, b) => Number(!mine.has(a.ticker ?? "")) - Number(!mine.has(b.ticker ?? "")))] as const);
  }, [q.data, mine]);
  const shown = all ? days : days.slice(0, SHOWN_DAYS);

  const remove = (e: CorpEvent) => e.id != null && mut.remove.mutate(e.id, {
    onSuccess: () => toast({ title: t("removed") }),
    onError: (err) => toast({ title: t("saveFailed"), description: humanizeApiError(err), variant: "destructive" }),
  });

  return (
    <Panel
      icon={Building2}
      title={t("title")}
      description={t("description")}
      actions={canEdit ? (
        <span className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setSetupsOpen(true)}>{t("setups")}</Button>
          <Button size="sm" variant="outline" onClick={() => setDraft({ day: defaultDay, type: "sp_add", ticker: "", indexCode: "sp500", note: "" })}><Plus aria-hidden="true" />{t("add")}</Button>
        </span>
      ) : undefined}
    >
      {q.isLoading ? <ListSkeleton rows={3} dense /> : q.isError ? (
        <ErrorState compact error={q.error} onRetry={q.refetch} title={t("loadFailed")} />
      ) : !days.length ? (
        <EmptyState compact icon={Building2} title={t("empty")} />
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map(([day, list]) => (
            <section key={day} aria-label={fmtDay(day, "weekdayDayMonthLong")}>
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">{weekdayLabel(day)} · {fmtDay(day)}</h4>
              <ul className="flex flex-col gap-1">
                {list.map((e) => (
                  <li key={e.key} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1 text-sm", e.ticker && mine.has(e.ticker) && "bg-primary/5")}>
                    <Pill tone={TONE[e.type]}>{t(`type.${e.type}`)}</Pill>
                    {e.ticker && <button type="button" className="font-semibold text-foreground hover:underline" onClick={() => onOpenTicker(e.ticker!)}>{e.ticker}</button>}
                    {e.indexCode && <span className="text-foreground">{t(`index.${e.indexCode}`)}</span>}
                    {e.ticker && mine.has(e.ticker) && <span className="text-xs text-primary">{t("mine")}</span>}
                    <span className="text-xs text-muted-foreground">
                      {e.rule ? t(`rule.${e.rule}`) : t(`source.${e.source}`)}
                      {e.estimated ? ` · ${t("estimated")}` : ""}
                    </span>
                    {e.note && e.source !== "rule" && <span className="min-w-0 truncate text-xs text-muted-foreground" title={e.note}>{e.note}</span>}
                    <span className="ml-auto flex items-center gap-1">
                      {e.setup && <Link href={links.setup(e.setup.id)} className="rounded-lg border border-border px-2 py-0.5 text-xs hover:bg-[var(--glass-hover-bg)]">{t("setup", { name: e.setup.name })}</Link>}
                      {canEdit && e.source === "manual" && e.id != null && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("edit")} onClick={() => setDraft({ id: e.id!, day: e.day, type: e.type, ticker: e.ticker ?? "", indexCode: e.indexCode, note: e.note ?? "" })}><Pencil aria-hidden="true" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("remove")} onClick={() => remove(e)}><Trash2 aria-hidden="true" /></Button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {days.length > SHOWN_DAYS && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
              {all ? t("less") : t("more", { count: days.length - SHOWN_DAYS })}
            </Button>
          )}
        </div>
      )}
      {draft && <CorpEventDialog draft={draft} onClose={() => setDraft(null)} />}
      {setupsOpen && <CorpSetupsDialog current={q.data?.typeSetups ?? {}} onClose={() => setSetupsOpen(false)} />}
    </Panel>
  );
}
