/**
 * The live status in the one-line header of «Темы рынка»: dot + «обновлено N с назад», the session, the quote source
 * (wide screens), «данные устарели».
 */
import { useEffect, useState } from "react";
import { Pill, StatusDot } from "@/components/ds";
import { themesI18n } from "@/i18n/ns/themes";
import { ageSeconds, isLiveSession, type ThemesResponse } from "./model";

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

export function ThemesMeta({ data, refreshFailed }: { data: Pick<ThemesResponse, "asOf" | "session" | "source" | "stale">; refreshFailed: boolean }) {
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
      {data.source && <span className="hidden lg:inline">{t("source", { name: SOURCE_NAME[data.source] })}</span>}
      {stale && <Pill tone="warn" title={t("staleHint")}>{t("stale")}</Pill>}
    </>
  );
}

