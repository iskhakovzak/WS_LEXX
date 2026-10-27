/**
 * Profile extras: «Похожий стиль» (the desk peer with the nearest trading style — staff only, the server leaves it out
 * otherwise) and «Цитата под характер» (a quote from the bundled library on the theme of the growth area, plus the
 * person's favourites on their own profile / for staff).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Quote as QuoteIcon, RefreshCw, Users } from "lucide-react";
import { Panel, SkeletonBlock } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { STALE } from "@/lib/api/keys";
import { asQuoteLang, citationOf, loadQuoteLibrary, quoteMarks, quoteOf } from "@/lib/quotes/library";
import { fmtRate } from "@/lib/format";
import { personInitials, personName, useLang } from "@/i18n";
import { profileI18n } from "@/i18n/ns/profile";
import type { ProfileResponse } from "./api";
import { personHref, themeQuoteIds } from "./model";

export function PeerCard({ peer, className }: { peer: NonNullable<ProfileResponse["peer"]>; className?: string }) {
  const { t } = profileI18n.useT();
  return (
    <Panel title={t("peer.title")} description={t("peer.description")} icon={Users} className={className} fill>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-sm font-bold text-foreground">{personInitials(peer.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{personName(peer.name)}</span>
          <span className="block text-xs text-muted-foreground">{t("peer.similarity", { value: fmtRate(peer.similarity) })}</span>
        </span>
        {peer.id !== null && (
          <Link href={personHref(peer.id)} className="press inline-flex min-h-9 shrink-0 items-center rounded-lg border border-[var(--field-border)] px-3 text-sm text-foreground hover:bg-[var(--glass-bg)]">
            {t("peer.open")}
          </Link>
        )}
      </div>
    </Panel>
  );
}

export function QuoteCard({ profile, className }: { profile: ProfileResponse; className?: string }) {
  const { t } = profileI18n.useT();
  const lang = asQuoteLang(useLang());
  const lib = useQuery({ queryKey: ["quote-library", lang], queryFn: () => loadQuoteLibrary(lang), staleTime: STALE.static, meta: { i18n: false } });
  const [step, setStep] = React.useState(0);
  const ids = React.useMemo(
    () => (lib.data ? themeQuoteIds(lib.data.quotes, profile.quotes.theme, `${profile.person.id}:${profile.window.to}`) : []),
    [lib.data, profile.quotes.theme, profile.person.id, profile.window.to],
  );
  const [open, close] = quoteMarks(lang);
  const quote = lib.data && ids.length ? quoteOf(lib.data, ids[step % ids.length]) : null;
  const favs = lib.data ? profile.quotes.favs.map((id) => quoteOf(lib.data!, id)).filter((q): q is NonNullable<typeof q> => !!q) : [];

  return (
    <Panel
      title={t("quotes.title")}
      description={t("quotes.description")}
      icon={QuoteIcon}
      className={className}
      fill
      actions={ids.length > 1 ? (
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setStep((s) => s + 1)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t("quotes.another")}
        </Button>
      ) : undefined}
    >
      {!lib.data ? (
        <SkeletonBlock className="h-20 w-full rounded-xl" />
      ) : quote ? (
        <figure className="flex flex-col gap-2" aria-live="polite">
          <blockquote className="text-base italic leading-relaxed text-foreground">{open}{quote.text}{close}</blockquote>
          <figcaption className="text-xs text-muted-foreground">{quote.authorName} · {citationOf(quote)}</figcaption>
        </figure>
      ) : null}
      {favs.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
          <h3 className="text-xs font-semibold text-muted-foreground">{t("quotes.favs")}</h3>
          <ul className="flex flex-col gap-2">
            {favs.map((q) => (
              <li key={q.id} className="text-sm text-foreground/90">
                {open}{q.text}{close} <span className="text-xs text-muted-foreground">— {q.authorName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
