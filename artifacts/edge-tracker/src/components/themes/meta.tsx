/**
 * Header line of «Темы рынка»: live dot + «обновлено N с назад», the session, the quote source, «данные устарели»;
 * and (wide screens only, it would wrap on a phone) the 3 leaders / 3 laggards of the active column — a chip opens
 * that theme.
 */
import { useEffect, useState } from "react";
import { Pill, StatusDot, toneOf, tonePill } from "@/components/ds";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { themesI18n } from "@/i18n/ns/themes";
import { ageSeconds, isLiveSession, leadersLaggards, type BoardTheme, type ThemeMetric, type ThemesResponse } from "./model";

const SOURCE_NAME = { finviz: "Finviz", yahoo: "Yahoo Finance" } as const;

/** Re-render every `ms` (the «N с назад» counter). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function ThemesMeta({ data, refreshFailed }: { data: ThemesResponse; refreshFailed: boolean }) {
  const { t } = themesI18n.useT();
  const now = useNow(5_000);
  const age = ageSeconds(data.asOf, now);
  const live = isLiveSession(data.session);
  const stale = data.stale || refreshFailed;
  return (
    <>
      {age != null && (
        <StatusDot tone={stale ? "warn" : live ? "up" : "neutral"} pulse={live && !stale}>
          <span className="tabular-nums">{age < 60 ? t("updatedSec", { sec: age }) : t("updatedMin", { min: Math.floor(age / 60) })}</span>
        </StatusDot>
      )}
      <Pill tone={live ? "accent" : "neutral"}>{t(`session.${data.session}`)}</Pill>
      {data.source && <span>{t("source", { name: SOURCE_NAME[data.source] })}</span>}
      {stale && <Pill tone="warn" title={t("staleHint")}>{t("stale")}</Pill>}
    </>
  );
}

function Chip({ theme, col, onOpen }: { theme: BoardTheme; col: ThemeMetric; onOpen: (key: string) => void }) {
  const { t } = themesI18n.useT();
  const v = theme[col];
  return (
    <button
      type="button"
      onClick={() => onOpen(theme.key)}
      aria-label={t("openTheme", { name: theme.name })}
      className={cn("inline-flex h-5.5 max-w-[11rem] items-center gap-1 rounded-full px-2 text-xs font-medium hover:brightness-110", tonePill(toneOf(v)))}
    >
      <span className="truncate">{theme.name}</span>
      <span className="tabular-nums">{fmtPct(v, 1)}</span>
    </button>
  );
}

/** «Лидеры» A B C · «Аутсайдеры» X Y Z of the active column (nothing when the column has no values). */
export function LeaderChips({ themes, col, onOpen, className }: { themes: readonly BoardTheme[]; col: ThemeMetric; onOpen: (key: string) => void; className?: string }) {
  const { t } = themesI18n.useT();
  const { leaders, laggards } = leadersLaggards(themes, col);
  if (!leaders.length && !laggards.length) return null;
  return (
    <span className={cn("min-w-0 items-center gap-1.5", className)}>
      {leaders.length > 0 && <span className="text-muted-foreground">{t("leaders")}</span>}
      {leaders.map((th) => <Chip key={th.key} theme={th} col={col} onOpen={onOpen} />)}
      {laggards.length > 0 && <span className="ml-1.5 text-muted-foreground">{t("laggards")}</span>}
      {laggards.map((th) => <Chip key={th.key} theme={th} col={col} onOpen={onOpen} />)}
    </span>
  );
}
