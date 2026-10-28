/**
 * «История и избранное»: the quotes shown on this browser (dashboard and lock screen, newest first) and the starred
 * ones (synced via users.settings.quotes). A row opens the quote in the card. Only the open tab's quotes are asked
 * from the API (GET /api/quotes/items), warmed when the pointer reaches the button.
 */
import * as React from "react";
import { LockKeyhole, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtRelative } from "@/lib/format";
import type { HistoryEntry } from "@/lib/quotes/store";
import type { QuoteLang } from "@/lib/quotes/types";
import { usePrefetchQuotes, useQuotes } from "@/lib/quotes/hooks";
import { quotesI18n } from "@/i18n/ns/quotes";

type Tab = "history" | "favs";

export function QuoteHistory({
  lang, history, favs, onOpen, trigger,
}: {
  lang: QuoteLang;
  history: readonly HistoryEntry[];
  favs: readonly string[];
  onOpen: (id: string) => void;
  /** The icon button that opens it (the card's own IconAction). */
  trigger: React.ReactElement;
}) {
  const { t } = quotesI18n.useT();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("history");
  const rows = tab === "history"
    ? history.map((h) => ({ id: h.id, at: h.at, lock: h.s === "lock" }))
    : favs.map((id) => ({ id, at: null as number | null, lock: false }));
  const ids = rows.map((r) => r.id);
  const quotes = useQuotes(lang, ids, open);
  const prefetch = usePrefetchQuotes();
  const byId = new Map((quotes.data ?? []).map((q) => [q.id, q]));
  const items = rows.map((r) => ({ ...r, q: byId.get(r.id) })).filter((r) => r.q);
  const loading = open && ids.length > 0 && !quotes.data && !quotes.isError;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onPointerEnter={() => prefetch(lang, history.map((h) => h.id))}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <Segmented<Tab>
            ariaLabel={t("history.button")}
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "history", label: t("history.tabHistory") },
              { value: "favs", label: <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" aria-hidden="true" />{t("history.tabFavs")}{favs.length ? ` ${favs.length}` : ""}</span> },
            ]}
          />
        </div>
        <div className="max-h-[min(30rem,65dvh)] overflow-y-auto overscroll-contain px-3 py-1.5">
          {loading ? (
            <div className="space-y-2 py-2" aria-busy="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">{t(tab === "history" ? "history.emptyHistory" : "history.emptyFavs")}</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {items.map(({ id, at, lock, q }) => (
                <li key={`${tab}-${id}`}>
                  <button
                    type="button"
                    onClick={() => { onOpen(id); setOpen(false); }}
                    className="w-full rounded-md px-1 py-2 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${t("history.open")}: ${q!.authorName}`}
                  >
                    <p className="line-clamp-3 text-sm leading-snug text-foreground/90" lang={lang}>{q!.text}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
                      <span className="truncate">— {q!.authorName}</span>
                      {at != null && <span className="shrink-0 tabular-nums">· {fmtRelative(new Date(at))}</span>}
                      {lock && <span className="inline-flex shrink-0 items-center gap-0.5" title={t("history.onLock")}><LockKeyhole className="h-2.5 w-2.5" aria-hidden="true" /><span className="sr-only">{t("history.onLock")}</span></span>}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
