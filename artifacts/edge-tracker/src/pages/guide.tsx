/**
 * «Справочник» (/guide; owner, 2026-10-30): every tool grouped by the trader's day — the home screen, before the open,
 * the session, after the close, the week and the season, then market, learning, team, staff and the account. Each card
 * is the tool's help registry entry (lib/help/registry, the `help` namespace): what it is, why, how to read it, an
 * example, where it leads next — the same texts as its «?» and the tour. Only tools this viewer can open are listed
 * (staff pages, sections closed for the stage). Searchable; `/guide#<id>` (the «?» popover's «Весь справочник») scrolls
 * to that card and marks it. The daily-loop tour starts (or continues) from here too.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Route as RouteIcon, Search, X } from "lucide-react";
import { Page, PageHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motionReduced } from "@/lib/motion";
import { helpI18n } from "@/i18n/ns/help";
import { shellI18n } from "@/i18n/ns/shell";
import ruShell from "@/i18n/locales/ru/shell";
import { helpText, helpTitle, useHelpViewer } from "@/components/shared/tool-help";
import { guideGroups, HELP, isHelpId, isWidget, matchesQuery, nextFor, type HelpId } from "@/lib/help/registry";
import { requestTour, useOnboarding } from "@/lib/onboarding/store";
import { tourRole, tourSeen } from "@/lib/onboarding/model";
import { useAuth } from "@/contexts/auth-context";

/** Everything a search may match: the name (and the Russian nav name in any language) and the four lines. */
function haystack(id: HelpId): string {
  const t = helpText(id);
  const ru = isWidget(id) ? "" : ruShell.nav[id];
  return [helpTitle(id), ru, t.what, t.why, t.read, t.example].join(" ");
}

export default function GuidePage() {
  const { t } = helpI18n.useT();
  shellI18n.useT();
  const viewer = useHelpViewer();
  const { user, permissions } = useAuth();
  const ob = useOnboarding();
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<HelpId | null>(null);
  const [location] = useLocation();

  const groups = useMemo(() => guideGroups(viewer), [viewer]);
  // ~80 short entries: filtered on every render, so the texts searched are always the current language's.
  const q = query.trim();
  const shown = q ? groups.map((g) => ({ ...g, ids: g.ids.filter((id) => matchesQuery(haystack(id), q)) })).filter((g) => g.ids.length) : groups;
  const count = shown.reduce((n, g) => n + g.ids.length, 0);

  // `/guide#riskSignals`: scroll to that card once it is on screen and mark it.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!isHelpId(id)) return;
    setQuery("");
    setFocus(id);
    const raf = window.requestAnimationFrame(() => {
      document.getElementById(`help-${id}`)?.scrollIntoView({ block: "center", behavior: motionReduced() ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [location]);

  const goTo = (id: HelpId) => {
    setQuery("");
    setFocus(id);
    window.history.replaceState(window.history.state, "", "#" + id);
    window.requestAnimationFrame(() => {
      document.getElementById("help-" + id)?.scrollIntoView({ block: "center", behavior: motionReduced() ? "auto" : "smooth" });
    });
  };

  const role = tourRole(permissions.role ?? user?.role, permissions.tier);
  const canResume = !!ob.state.loopStep && ob.state.loopStep.r === role && !tourSeen(ob.state, role);
  const guest = !user || user.role === "guest";

  return (
    <Page>
      <PageHeader
        title={t("guide.title")}
        description={t("guide.description")}
        actions={guest ? undefined : (
          <Button variant="outline" size="sm" onClick={() => requestTour({ resume: canResume })}>
            <RouteIcon className="h-4 w-4" aria-hidden="true" />
            {canResume ? t("guide.tourResume") : t("guide.tour")}
          </Button>
        )}
      />

      <div className="mt-4 flex items-center gap-3">
        <label className="relative block w-full max-w-md">
          <span className="sr-only">{t("guide.searchAria")}</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocus(null); }}
            placeholder={t("guide.search")}
            className="glass-field h-10 w-full rounded-full pl-10 pr-10 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("guide.clear")}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </label>
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">{t("guide.count", { count })}</p>
      </div>

      {count === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">{t("guide.empty")}</p>
      ) : (
        <div className="mt-6 space-y-10">
          {shown.map((g, gi) => (
            <section key={g.phase} aria-labelledby={`guide-${g.phase}`}>
              <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id={`guide-${g.phase}`} className="text-lg font-semibold tracking-tight text-foreground">
                  <span className="mr-2 tabular-nums text-muted-foreground/70">{gi + 1}</span>
                  {t(`phases.${g.phase}.label`)}
                </h2>
                <p className="text-sm text-muted-foreground">{t(`phases.${g.phase}.hint`)}</p>
              </header>
              <div className="grid gap-3 md:grid-cols-2">
                {g.ids.map((id) => <GuideCard key={id} id={id} focused={focus === id} onGo={goTo} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

function GuideCard({ id, focused, onGo }: { id: HelpId; focused: boolean; onGo: (id: HelpId) => void }) {
  const { t } = helpI18n.useT();
  const viewer = useHelpViewer();
  const text = helpText(id);
  const next = nextFor(id, viewer);
  const href = HELP[id].href;
  return (
    <article
      id={`help-${id}`}
      aria-labelledby={`help-${id}-title`}
      className={cn("glass-panel scroll-mt-24 rounded-2xl px-4 py-3.5 transition-shadow", focused && "ring-2 ring-primary/70")}
    >
      <h3 id={`help-${id}-title`} className="text-sm font-semibold text-foreground">
        <Link href={href} className="rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{helpTitle(id)}</Link>
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{text.what}</p>
      <dl className="mt-2.5 grid gap-2 text-[0.8125rem] leading-relaxed">
        <Line label={t("ui.why")} value={text.why} />
        <Line label={t("ui.read")} value={text.read} />
        <Line label={t("ui.example")} value={text.example} />
      </dl>
      {next.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--glass-border)] pt-2.5 text-xs">
          <span className="text-muted-foreground">{t("ui.next")}:</span>
          {next.map((n) => (
            <button key={n} type="button" onClick={() => onGo(n)} className="inline-flex items-center gap-1 rounded-md font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
              {helpTitle(n)}
            </button>
          ))}
        </p>
      )}
    </article>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground/85">{value}</dd>
    </div>
  );
}
