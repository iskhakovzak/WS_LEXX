/**
 * «Похожие прошлые случаи» (api GET /analogues): a ticker and a day → the desk's past trades, playbook examples and
 * cases with a similar profile (setup, catalyst type, gap band, direction, strength, regime), ranked. The sheet opens
 * with the day's own profile on top (what was matched against), then the cases — each says why it matched and links
 * to the desk day or the setup. Counts and R only. AnaloguesButton is the one action every screen uses.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { History } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtDate, fmtPct, fmtR } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { analoguesI18n } from "@/i18n/ns/analogues";
import { marketRegimeI18n } from "@/i18n/ns/marketRegime";
import { analoguesQuery, type Analogue, type Profile } from "./api";

const regimeName = (k: string) => marketRegimeI18n.tryT(`regimes.${k}.name`) ?? k;

function ProfileLine({ p }: { p: Profile }) {
  const { t } = analoguesI18n.useT();
  const parts = [
    p.gapPct != null ? t("sheet.gap", { gap: fmtPct(p.gapPct, 1) }) : t("sheet.noGap"),
    p.kind ? t(`kind.${p.kind}`) : null,
    p.direction ? t(`direction.${p.direction}`) : null,
    p.strength ? t(`strength.${p.strength}`) : null,
    p.regime ? t("sheet.regime", { name: regimeName(p.regime) }) : null,
  ].filter(Boolean);
  return <span>{parts.join(" · ")}</span>;
}

function Row({ a }: { a: Analogue }) {
  const { t } = analoguesI18n.useT();
  const href = a.source === "case" && a.setupId != null ? links.setup(a.setupId) : links.deskDay(a.ticker, a.day);
  return (
    <li className="rounded-xl border border-[var(--glass-border)] p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-foreground">{a.ticker}</span>
        <span className="text-sm text-muted-foreground">{fmtDate(a.day, "medium")}</span>
        <Pill tone={a.source === "trade" ? "neutral" : "accent"}>{t(`source.${a.source}`)}</Pill>
        {a.setupName && <span className="text-sm text-foreground">{a.setupName}</span>}
        <span className="ml-auto text-xs font-medium text-primary">{t("sheet.score", { score: a.score })}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground"><ProfileLine p={a} /></p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {a.matched.map((m) => <span key={m} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{t(`trait.${m}`)}</span>)}
        {a.trades > 0 && (
          <span className="text-xs text-muted-foreground">
            · {t("trades", { count: a.trades, wins: a.wins, losses: a.losses })}{a.avgR != null ? ` · ${t("avgR", { r: fmtR(a.avgR) })}` : ""}
          </span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-7" asChild>
          <Link href={href}>{a.source === "case" ? t("openSetup") : t("openDay")}</Link>
        </Button>
      </div>
      {a.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.note}</p>}
    </li>
  );
}

export function AnaloguesSheet({ ticker, day, setupId, open, onOpenChange }: {
  ticker: string; day: string; setupId?: number | null; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { t } = analoguesI18n.useT();
  const q = useQuery(analoguesQuery(ticker, day, setupId ?? null, open));
  const w = q.data?.weights;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t("sheet.title", { ticker })}</SheetTitle>
          <SheetDescription>{t("sheet.description")}</SheetDescription>
        </SheetHeader>
        {q.data && (
          <p className="rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-sm text-foreground">
            <span className="font-medium">{t("sheet.profile", { date: fmtDate(day, "medium") })}: </span>
            <ProfileLine p={q.data.query} />
          </p>
        )}
        {q.isLoading ? <ListSkeleton rows={4} /> : q.isError ? (
          <ErrorState compact error={q.error} onRetry={q.refetch} title={t("sheet.loadFailed")} />
        ) : !q.data?.analogues.length ? (
          <EmptyState compact icon={History} title={t("sheet.empty")} />
        ) : (
          <ul className="flex flex-col gap-2">{q.data.analogues.map((a) => <Row key={a.key} a={a} />)}</ul>
        )}
        {w && <p className="text-xs text-muted-foreground">{t("sheet.rule", { setup: w.setup, kind: w.kind, gap: w.gap, direction: w.direction, strength: w.strength, regime: w.regime })}</p>}
      </SheetContent>
    </Sheet>
  );
}

/** The «Похожие прошлые случаи» action: one button, the sheet opens on demand (no request before). */
export function AnaloguesButton({ ticker, day, setupId, short = false, className }: { ticker: string; day: string; setupId?: number | null; short?: boolean; className?: string }) {
  const { t } = analoguesI18n.useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className={cn("h-7", className)} onClick={() => setOpen(true)}>
        <History aria-hidden="true" />{short ? t("actionShort") : t("action")}
      </Button>
      {open && <AnaloguesSheet ticker={ticker} day={day} setupId={setupId} open={open} onOpenChange={setOpen} />}
    </>
  );
}
