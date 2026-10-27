/**
 * Profile hero: initials, the name (Latin in EN/UZ), role and ladder stage coin, curator / mentor, how long they trade
 * and on which accounts, the clean streak and the medals — then the one-line «характеристика» as the page's lede.
 */
import type * as React from "react";
import { Flame } from "lucide-react";
import { Link } from "wouter";
import { AwardCoin, StageMedal, medalStageName, medalStageOf } from "@/components/shared/medals";
import { Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { personInitials, personName } from "@/i18n";
import { profileI18n } from "@/i18n/ns/profile";
import type { ProfileResponse } from "./api";
import { achievementName, emblemOf, metalOf, summaryText, tierName } from "./model";

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary/15 text-xl font-bold tracking-wide text-primary ring-1 ring-primary/30 sm:h-20 sm:w-20 sm:text-2xl"
    >
      {personInitials(name)}
    </span>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex min-w-0 items-center">{children}</span>;
}

export function ProfileHero({ profile, actions }: { profile: ProfileResponse; actions?: React.ReactNode }) {
  const { t } = profileI18n.useT();
  const p = profile.person;
  const stage = medalStageOf(p.stage);
  const role = profileI18n.tryT(`role.${p.role}`) ?? p.role;
  const staff = p.role === "admin" || p.role === "curator";
  const facts: React.ReactNode[] = [
    p.curator ? t("hero.curator", { name: personName(p.curator) }) : p.role === "trader" ? t("hero.noCurator") : null,
    p.mentor ? t("hero.mentor", { name: personName(p.mentor) }) : null,
    p.firstTradeDay ? t("hero.tradingSince", { date: fmtDate(p.firstTradeDay, "medium") }) : t("hero.noTradesYet"),
    profile.stats.activeDays ? t("hero.activeDays", { count: profile.stats.activeDays }) : null,
    p.accounts.length ? t(p.accounts.length === 1 ? "hero.account" : "hero.accounts", { list: p.accounts.join(", ") }) : null,
  ].filter(Boolean);
  const streak = profile.streak;

  return (
    <header className="glass-panel flex flex-col gap-5 rounded-2xl p-panel sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={p.name} />
        <div className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="type-display text-foreground [overflow-wrap:anywhere]">{personName(p.name)}</h1>
            {p.self && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-accent-soft">{t("you")}</span>}
          </div>
          {/* The ladder stage with its medal is the person's level («Джун · с 1 сент.»); the access role is a separate small
              badge, only for staff — «Трейдер · Джун» read as two stages (design audit wave 2). */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {stage && (
              <span className="inline-flex items-center gap-1.5">
                <StageMedal stage={stage} size={22} decorative />
                <span className="font-medium text-foreground">{medalStageName(stage)}</span>
                {p.stageSince && <span>· {fmtDate(p.stageSince, "dayMonth")}</span>}
              </span>
            )}
            {staff && <Pill tone="neutral">{role}</Pill>}
          </div>
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {facts.map((f, i) => <Fact key={i}>{f}</Fact>)}
          </p>
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div>}
      </div>

      <p className="max-w-4xl text-base leading-relaxed text-foreground sm:text-lg">{summaryText(profile.summary)}</p>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className={cn("inline-flex items-center gap-2 text-sm", streak.current ? "text-foreground" : "text-muted-foreground")}>
          <Flame className={cn("h-5 w-5", streak.current ? "text-warn" : "text-muted-foreground")} aria-hidden="true" />
          <span className="font-medium">{streak.current ? t("hero.streak", { count: streak.current }) : t("hero.streakNone")}</span>
          {streak.best > streak.current && <span className="text-muted-foreground">· {t("hero.streakBest", { count: streak.best })}</span>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("hero.medals")}</span>
          {profile.achievements.length ? (
            <ul className="flex flex-wrap items-center gap-1.5">
              {profile.achievements.slice(0, 10).map((a) => {
                const label = t("hero.medalTitle", { name: achievementName(a.line), tier: tierName(a.tier) });
                return (
                  <li key={a.line} title={label}>
                    <AwardCoin emblem={emblemOf(a.category)} metal={metalOf(a.tier)} size={30} label={label} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">{t("hero.noMedals")}</span>
          )}
        </div>
      </div>
    </header>
  );
}

/** Small link chip used in the hero actions (trades / journal / curator cabinet). */
export function HeroLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="press inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--field-border)] px-3 text-sm text-foreground hover:bg-[var(--glass-bg)]">
      {children}
    </Link>
  );
}
