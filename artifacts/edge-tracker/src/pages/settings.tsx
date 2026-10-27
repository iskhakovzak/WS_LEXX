/**
 * Settings (/settings): left-nav layout with sections. Each section lives in components/settings/*.
 * Deep links: /settings#trading, #notifications … (also remembered per browser). Personal settings only (design audit
 * wave 2B): team, rights, backups and integrations live in the desk console — one «Пульт деска» item opens /admin, and
 * old #team / #permissions / #data / #integrations links land where those things live now (LEGACY_SECTIONS).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { useLocation } from "wouter";
import { Settings as SettingsIcon } from "lucide-react";
import { Page, PageHeader, Pill } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { SettingsNav, SECTIONS, visibleSections, type SectionId } from "@/components/settings/SettingsNav";
import { ProfileSection, useMyProfile } from "@/components/settings/ProfileSection";
import { WrappedProfilePanel } from "@/components/wrapped/WrappedLaunch";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { TradingSection } from "@/components/settings/TradingSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { SecuritySection } from "@/components/settings/SecuritySection";
import { useTeam } from "@/components/settings/team-api";
import { isTypingTarget } from "@/components/settings/shared";
import { settingsI18n } from "@/i18n/ns/settings";

const LS_SECTION = "ws_lexx_settings_section";

/** Sections that left /settings: where an old link goes now (the Telegram link itself is under «Уведомления»). */
const LEGACY_SECTIONS: Record<string, { href?: string; staffHref?: string; to?: SectionId }> = {
  team: { href: "/admin?tab=people" },
  permissions: { href: "/admin?tab=roles" },
  data: { href: "/admin?tab=data" },
  integrations: { to: "notifications" },
};

function readInitialSection(): SectionId {
  const fromHash = window.location.hash.replace("#", "");
  if (SECTIONS.some((s) => s.id === fromHash)) return fromHash as SectionId;
  const legacy = LEGACY_SECTIONS[fromHash];
  if (legacy?.to) return legacy.to;
  try {
    const saved = localStorage.getItem(LS_SECTION);
    // A remembered section that moved to /admin must not bounce the user off /settings.
    if (saved && SECTIONS.some((s) => s.id === saved && !s.href)) return saved as SectionId;
  } catch { /* storage unavailable */ }
  return "profile";
}

export default function Settings() {
  const { can, user } = useAuth();
  const { t } = settingsI18n.useT();
  const reduceMotion = useReducedMotion();
  const sections = useMemo(() => visibleSections(can), [can]);
  const canSeeTeam = can("users.read.team");
  const [requested, setRequested] = useState<SectionId>(readInitialSection);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  // Old #team / #permissions / #data links open the desk console (staff); anyone else stays on their profile.
  useEffect(() => {
    const legacy = LEGACY_SECTIONS[window.location.hash.replace("#", "")];
    if (legacy?.href && sections.some((s) => s.id === "desk")) navigate(legacy.href, { replace: true });
  }, [sections, navigate]);

  // Fall back to the first local section when the requested one is hidden for this role (e.g. "team" for traders)
  // or lives on another page.
  const active: SectionId = sections.some((s) => s.id === requested && !s.href) ? requested : sections.find((s) => !s.href)!.id;
  const meta = SECTIONS.find((s) => s.id === active)!;

  const select = useCallback((id: SectionId) => {
    const href = SECTIONS.find((s) => s.id === id)?.href;
    if (href) { navigate(href); return; }
    setRequested(id);
    try { localStorage.setItem(LS_SECTION, id); } catch { /* ignore */ }
    if (window.location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
    document.getElementById("settings-section")?.focus({ preventScroll: true });
    document.getElementById("main-content")?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [reduceMotion, navigate]);

  // Respond to hash changes (links like /settings#trading from other pages).
  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace("#", "");
      if (SECTIONS.some((s) => s.id === id)) setRequested(id as SectionId);
      else if (LEGACY_SECTIONS[id]?.to) setRequested(LEGACY_SECTIONS[id].to!);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keyboard: "/" search, 1–N jump to section.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= sections.length) {
        e.preventDefault();
        select(sections[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sections, select]);

  // Attention badges in the nav: traders without a curator (the console), an unlinked Telegram (notifications).
  const { data: team } = useTeam(canSeeTeam);
  const unassigned = team?.filter((m) => m.active && m.role === "trader" && !m.assignedCurator).length ?? 0;
  const { data: profile } = useMyProfile(!!user?.traderName && user.role !== "guest");
  const badges: Partial<Record<SectionId, React.ReactNode>> = {
    ...(unassigned > 0 ? { desk: <Pill tone="down" className="text-2xs">{unassigned}</Pill> } : {}),
    ...(profile && !profile.telegramLinked
      ? { notifications: <span role="img" className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--chart-3))]" aria-label={t("page.telegramNotLinked")} title={t("page.telegramNotLinked")} /> }
      : {}),
  };

  return (
    <Page>
      <PageHeader title={t("page.title")} description={t("page.description")} icon={SettingsIcon} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-5 xl:grid-cols-[296px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <SettingsNav ref={searchRef} sections={sections} active={active} onSelect={select} query={query} onQuery={setQuery} badges={badges} />
        </aside>

        <section id="settings-section" tabIndex={-1} aria-labelledby="settings-section-title" className="min-w-0 focus:outline-none">
          <div className="mb-4 flex flex-col gap-0.5">
            <h2 id="settings-section-title" className="text-lg font-semibold text-foreground">{meta.label}</h2>
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          </div>
          {/* Enter-only fade: no exit «wait», so switching sections is instant (and never stalls in a background tab). */}
          <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {active === "profile" && <ProfileSection onNavigate={select} recap={<WrappedProfilePanel />} />}
              {active === "appearance" && <AppearanceSection />}
              {active === "trading" && <TradingSection />}
              {active === "notifications" && <NotificationsSection onNavigate={select} />}
              {active === "security" && <SecuritySection />}
            </motion.div>
        </section>
      </div>
    </Page>
  );
}
