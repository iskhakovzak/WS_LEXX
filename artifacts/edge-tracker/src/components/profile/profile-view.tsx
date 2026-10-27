/**
 * The whole profile for one person: hero → «Характеристика» → key numbers → equity + style → the year → slices →
 * edge + extras → «Автобиография». One query (components/profile/api); 403 = the closed view, 404 = not found.
 */
import { BookText, CandlestickChart, ClipboardList, Lock, SearchX, Sprout } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { BentoGrid, EmptyState, ErrorState, Page, PanelSkeleton, SkeletonBlock, StatGridSkeleton } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { apiErrorStatus } from "@/lib/api/errors";
import { links } from "@/lib/links";
import { useAuth } from "@/contexts/auth-context";
import { profileI18n } from "@/i18n/ns/profile";
import { Link } from "wouter";
import { profileQuery, type ProfileRef, type ProfileResponse } from "./api";
import { AttributeCard } from "./attribute-card";
import { EdgePanel, EquityPanel, KeyStats, SlicesPanel, StylePanel } from "./analytics-panels";
import { Biography } from "./biography";
import { PeerCard, QuoteCard } from "./extras";
import { HeroLink, ProfileHero } from "./profile-hero";
import { ShareCardButton } from "./share-card-dialog";
import { YearHeat } from "./year-heat";
import { RegimeEdgePanel } from "@/components/shared/regime/regime-edge";

export function ProfileSkeleton() {
  const { t } = profileI18n.useT();
  return (
    <Page>
      <div className="flex flex-col gap-section" aria-busy="true" aria-label={t("loadingAria")}>
        <div className="glass-panel flex flex-col gap-4 rounded-2xl p-6">
          <div className="flex items-center gap-4">
            <SkeletonBlock className="h-20 w-20 rounded-2xl" />
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonBlock className="h-8 w-64" />
              <SkeletonBlock className="h-4 w-80 max-w-full" />
            </div>
          </div>
          <SkeletonBlock className="h-6 w-full max-w-3xl" />
        </div>
        <PanelSkeleton height={420} />
        <StatGridSkeleton count={8} min="10rem" />
        <PanelSkeleton height={300} />
      </div>
    </Page>
  );
}

function Closed({ kind }: { kind: "denied" | "notFound" }) {
  const { t } = profileI18n.useT();
  return (
    <Page width="narrow">
      <EmptyState
        icon={kind === "denied" ? Lock : SearchX}
        title={t(kind === "denied" ? "denied.title" : "notFound.title")}
        description={t(kind === "denied" ? "denied.description" : "notFound.description")}
        action={<Button asChild><Link href="/profile">{t("denied.back")}</Link></Button>}
      />
    </Page>
  );
}

function HeroActions({ p }: { p: ProfileResponse }) {
  const { t } = profileI18n.useT();
  const { isCurator } = useAuth();
  const name = p.person.self ? undefined : p.person.name;
  return (
    <>
      {p.person.self && <ShareCardButton profile={p} />}
      <HeroLink href={links.trades({ trader: name })}><CandlestickChart className="h-4 w-4" aria-hidden="true" />{t("links.trades")}</HeroLink>
      <HeroLink href={links.journalDay(p.window.to, name)}><BookText className="h-4 w-4" aria-hidden="true" />{t("links.journal")}</HeroLink>
      {!p.person.self && isCurator && p.person.role === "trader" && (
        <HeroLink href={`/curator?trader=${encodeURIComponent(p.person.name)}`}><ClipboardList className="h-4 w-4" aria-hidden="true" />{t("links.curator")}</HeroLink>
      )}
    </>
  );
}

function ProfileBody({ p }: { p: ProfileResponse }) {
  const { t } = profileI18n.useT();
  const noTrades = p.stats.trades === 0;
  return (
    <Page>
      <ProfileHero profile={p} actions={<HeroActions p={p} />} />
      {noTrades ? (
        <EmptyState icon={Sprout} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <>
          <AttributeCard attrs={p.attributes} windowDays={p.window.days} />
          {/* «Характеристика» → how the person trades each desk regime (hidden when the viewer may not see that book). */}
          <RegimeEdgePanel trader={p.person.self ? null : p.person.name} self={p.person.self} hideEmpty />
          <KeyStats stats={p.stats} />
          <BentoGrid>
            <EquityPanel equity={p.equity} className="lg:col-span-8" />
            <StylePanel style={p.style} className="lg:col-span-4" />
          </BentoGrid>
          <YearHeat calendar={p.calendar} today={p.window.to} />
          <SlicesPanel slices={p.slices} />
          <BentoGrid>
            <EdgePanel edge={p.edge} className={p.peer ? "lg:col-span-6" : "lg:col-span-7"} />
            {p.peer && <PeerCard peer={p.peer} className="lg:col-span-6" />}
            <QuoteCard profile={p} className={p.peer ? "lg:col-span-12" : "lg:col-span-5"} />
          </BentoGrid>
        </>
      )}
      <Biography eras={p.timeline.eras} events={p.timeline.events} />
    </Page>
  );
}

export function ProfileView({ profileRef }: { profileRef: ProfileRef }) {
  const { t } = profileI18n.useT();
  const q = useQuery(profileQuery(profileRef));
  if (q.data) return <ProfileBody p={q.data} />;
  if (q.isError) {
    const status = apiErrorStatus(q.error);
    if (status === 403) return <Closed kind="denied" />;
    if (status === 404 || status === 400) return <Closed kind="notFound" />;
    return <Page><ErrorState error={q.error} onRetry={q.refetch} title={t("loadFailed")} /></Page>;
  }
  return <ProfileSkeleton />;
}
