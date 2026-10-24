/**
 * One library quote in the card: category chip, reliability badge, the text, «— speaker · work, locator» and, for
 * Greek / Latin / Chinese… originals, a toggle that loads orig.json on demand.
 */
import * as React from "react";
import { BadgeCheck, Columns3, Feather, Landmark, Brain, TrendingUp, Languages, CircleHelp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { citationOf, loadQuoteOrig } from "@/lib/quotes/library";
import type { Quote, QuoteCat, QuoteLang } from "@/lib/quotes/types";
import { quotesI18n } from "@/i18n/ns/quotes";

export const CAT_ICON: Record<QuoteCat, LucideIcon> = {
  olympus: Landmark,
  philosophy: Columns3,
  discipline: Feather,
  trading: TrendingUp,
  psychology: Brain,
};

const CAT_TONE: Record<QuoteCat, string> = {
  olympus: "text-[hsl(var(--chart-4))]",
  philosophy: "text-[hsl(var(--chart-2))]",
  discipline: "text-[hsl(var(--chart-3))]",
  trading: "text-up",
  psychology: "text-[hsl(var(--chart-5))]",
};

/** Originals worth a toggle (an English original is the English text itself). */
const ORIG_LANGS = new Set(["grc", "la", "zh", "ja", "fr", "de", "it", "es", "ru", "other"]);

export function RelBadge({ rel }: { rel: Quote["rel"] }) {
  const { t } = quotesI18n.useT();
  const verified = rel === "verified";
  const Icon = verified ? BadgeCheck : CircleHelp;
  return (
    <span
      title={t(verified ? "rel.verifiedHint" : "rel.attributedHint")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium",
        verified ? "bg-up/10 text-up" : "bg-warn/12 text-warn",
      )}
      data-testid={`quote-rel-${rel}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(verified ? "rel.verified" : "rel.attributed")}
    </span>
  );
}

export function QuoteBody({ quote, lang, note }: { quote: Quote; lang: QuoteLang; note?: string | null }) {
  const { t } = quotesI18n.useT();
  const [showOrig, setShowOrig] = React.useState(false);
  const [orig, setOrig] = React.useState<string | null>(null);
  const hasOrig = quote.o === 1 && !!quote.lang && ORIG_LANGS.has(quote.lang) && !(quote.lang === "ru" && lang === "ru");
  const CatIcon = CAT_ICON[quote.cat];

  React.useEffect(() => { setShowOrig(false); setOrig(null); }, [quote.id]);
  React.useEffect(() => {
    if (!showOrig || orig !== null) return;
    let alive = true;
    void loadQuoteOrig().then((m) => { if (alive) setOrig(m[quote.id] ?? ""); }).catch(() => { if (alive) setOrig(""); });
    return () => { alive = false; };
  }, [showOrig, orig, quote.id]);

  return (
    <figure className="min-w-0" data-testid="quote-figure" data-quote-id={quote.id}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium">
          <CatIcon className={cn("h-3 w-3", CAT_TONE[quote.cat])} aria-hidden="true" />
          {t(`cat.${quote.cat}`)}
        </span>
        <RelBadge rel={quote.rel} />
        {note && <span className="truncate italic">· {note}</span>}
      </div>
      <blockquote
        key={`${quote.id}-${lang}`}
        className="text-[15px] font-medium leading-relaxed text-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
        lang={lang}
        data-testid="text-daily-quote"
      >
        {quote.text}
      </blockquote>
      <figcaption className="mt-2 text-xs leading-snug text-muted-foreground">
        <span className="font-medium text-foreground/80">— {quote.authorName}</span>
        <span className="italic"> · {citationOf(quote)}</span>
        {hasOrig && (
          <button
            type="button"
            onClick={() => setShowOrig((v) => !v)}
            aria-expanded={showOrig}
            className="ml-2 inline-flex items-center gap-1 rounded text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Languages className="h-3 w-3" aria-hidden="true" />
            {t(showOrig ? "origHide" : "origShow")}
          </button>
        )}
      </figcaption>
      {showOrig && orig && (
        <p className="mt-1.5 border-l-2 border-border/70 pl-2 text-xs italic leading-snug text-muted-foreground" lang={quote.lang === "grc" ? "grc" : quote.lang} aria-label={t("origAria")}>
          {orig}
        </p>
      )}
    </figure>
  );
}
