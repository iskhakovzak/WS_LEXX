/**
 * /integrations header for a trader (wave 1, 1.13): ONE line — «Сделки за пн, 19 окт.: ✓ 48 · синхронизация 16:02»
 * and what it means (verified with the broker / waiting for the sync / mismatch / no account linked). Replaces the
 * «раздел для кураторов» placeholder. Data: GET /api/propreports/my-freshness (own data only).
 */
import { AlertTriangle, CheckCircle2, Clock, Link2Off, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCount, fmtDate, fmtDeskDateTime, fmtDeskTime, fmtUsd } from "@/lib/format";
import { nyDate } from "@/lib/trading-date";
import { links } from "@/lib/links";
import { propreportsI18n } from "@/i18n/ns/propreports";
import { useMyFreshness, type MyFreshness } from "./api";

type Tone = "up" | "warn" | "down" | "neutral";
type DetailKey = "verified" | "synced" | "missingOurs" | "missingBroker" | "mismatch" | "behind" | "noAccount";

/** Pure view model of the line (tested in my-freshness.test.ts). */
export function freshnessView(f: MyFreshness): { tone: Tone; icon: "ok" | "warn" | "wait" | "unlinked"; detail: DetailKey; diff: number | null } {
  if (f.state === "no_account") return { tone: "neutral", icon: "unlinked", detail: "noAccount", diff: null };
  if (f.state === "behind") return { tone: "warn", icon: "wait", detail: "behind", diff: null };
  if (f.state === "mismatch") {
    const st = f.broker?.status;
    const detail: DetailKey = st === "missing_ours" ? "missingOurs" : st === "missing_broker" ? "missingBroker" : "mismatch";
    return { tone: "down", icon: "warn", detail, diff: f.broker ? Math.abs(f.broker.diff) : null };
  }
  return { tone: "up", icon: "ok", detail: f.broker?.status === "ok" ? "verified" : "synced", diff: null };
}

const ICON: Record<ReturnType<typeof freshnessView>["icon"], LucideIcon> = { ok: CheckCircle2, warn: AlertTriangle, wait: Clock, unlinked: Link2Off };
const ICON_TONE: Record<Tone, string> = { up: "text-up", warn: "text-warn", down: "text-down", neutral: "text-muted-foreground" };

/** «16:02 NY» today, «16 окт., 16:02 NY» earlier (the desk clock). */
function syncTime(iso: string): string {
  return nyDate(new Date(iso)) === nyDate() ? fmtDeskTime(iso) : fmtDeskDateTime(iso);
}

export function MyFreshnessCard() {
  const { t } = propreportsI18n.useT();
  const q = useMyFreshness();
  if (q.isLoading) return <Skeleton className="h-24 w-full rounded-2xl" />;
  if (!q.data) return <section className="glass-panel rounded-2xl p-4 text-sm text-muted-foreground">{t("fresh.failed")}</section>;
  const f = q.data;
  const v = freshnessView(f);
  const Icon = ICON[v.icon];
  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5" aria-label={t("fresh.aria")}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${ICON_TONE[v.tone]}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-base font-semibold">
              {t("fresh.title", { day: fmtDate(f.day, "weekdayDayMonth") })}: <span className="tabular-nums">{fmtCount(f.trades)}</span>
            </h2>
            <Pill tone={v.tone} dot>{t(`fresh.state.${f.state}`)}</Pill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`fresh.detail.${v.detail}`, { diff: v.diff != null ? fmtUsd(v.diff) : "" })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{f.lastSyncedAt ? t("fresh.sync", { time: syncTime(f.lastSyncedAt) }) : t("fresh.noSync")}</span>
            {f.trades > 0 && (
              <Link href={links.trades({ from: f.day, to: f.day })} className="text-primary hover:underline">{t("fresh.openTrades")}</Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
