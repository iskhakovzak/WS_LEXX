/** «Вид» → Тема: «Выбрать тему» — four preview tiles (a mini page with the day's number and a bar chart), each in its
 * real tokens plus the person's own accent / money colours computed for that theme — and the current background with
 * «Выбрать фон» (the two most common actions of the dialog, side by side). */
import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/theme-context";
import { useAppearance } from "@/contexts/appearance-context";
import { THEME_IDS, type ThemeId } from "@/lib/appearance/model";
import { computeAppearanceVars } from "@/lib/appearance/vars";
import { THEME_SELECTORS, readThemeTokens } from "@/components/shared/theme-tokens";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { OptionCard, OptionText, Section } from "./bits";
import { BgThumb } from "./originals";

const BARS = [38, 62, -24, 48, 80, -40, 66, 54, -18, 72];

function MiniPage({ style }: { style: React.CSSProperties }) {
  return (
    <div aria-hidden="true" style={{ ...style, colorScheme: "normal" }} className="pointer-events-none relative h-24 overflow-hidden sm:h-32 rounded-xl bg-background p-2 text-foreground">
      <div className="flex h-full gap-1.5">
        <div className="flex w-6 flex-col items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-sidebar py-1.5">
          <span className="h-3 w-3 rounded-md bg-primary" />
          <span className="h-1 w-3 rounded-full bg-muted-foreground/50" />
          <span className="h-1 w-3 rounded-full bg-muted-foreground/50" />
          <span className="h-1 w-3 rounded-full bg-muted-foreground/50" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border border-[hsl(var(--card-border))] bg-card p-2">
          <div className="flex items-center justify-between">
            <span className="text-2xs leading-none text-muted-foreground">P&amp;L</span>
            <span className="h-2.5 w-7 rounded-full bg-primary" />
          </div>
          <span className="text-lg font-semibold leading-none tracking-tight text-up tabular-nums">+$16,480</span>
          <div className="relative mt-auto flex h-10 items-end gap-[3px] border-b border-[hsl(var(--border))]">
            {BARS.map((v, i) => (
              <span
                key={i}
                className={v >= 0 ? "w-full self-end rounded-t-[2px] bg-up" : "w-full self-end rounded-t-[2px] bg-down"}
                style={{ height: `${Math.abs(v)}%`, opacity: 0.85 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The current background + «Выбрать фон» (opens the Фон tab). */
function BackgroundNow() {
  const { t } = appearanceI18n.useT();
  const { appearance, setTab } = useAppearance();
  const kind = appearance.bg.kind;
  return (
    <div className="tile flex items-center gap-3 p-2 pr-3">
      <span className="w-24 shrink-0 sm:w-28"><BgThumb kind={kind} /></span>
      <span className="min-w-0 flex-1">
        <OptionText title={t("themes.bgNow", { name: t(`background.kinds.${kind}`) })} note={t("themes.bgNowHint")} />
      </span>
      <Button type="button" size="sm" onClick={() => setTab("background")} className="shrink-0">
        {t("themes.chooseBg")}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

export function ThemesTab() {
  const { t } = appearanceI18n.useT();
  const { theme, setTheme, themeLabels } = useTheme();
  const { appearance } = useAppearance();
  const base = React.useMemo(() => Object.fromEntries(THEME_IDS.map((id) => [id, readThemeTokens(THEME_SELECTORS[id])])) as Record<ThemeId, React.CSSProperties>, []);
  const styles = React.useMemo(
    () => Object.fromEntries(THEME_IDS.map((id) => [id, { ...base[id], ...computeAppearanceVars(appearance, id).vars }])) as Record<ThemeId, React.CSSProperties>,
    [base, appearance],
  );
  return (
    <div className="flex flex-col gap-5">
    <Section title={t("themes.choose")} hint={t("themes.hint")}>
      <div role="radiogroup" aria-label={t("themes.choose")} className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {THEME_IDS.map((id) => (
          <OptionCard key={id} selected={theme === id} onSelect={() => setTheme(id)} label={`${themeLabels[id]}. ${t(`themes.${id}Hint`)}`}>
            <MiniPage style={styles[id]} />
            <OptionText title={themeLabels[id]} note={t(`themes.${id}Hint`)} />
          </OptionCard>
        ))}
      </div>
    </Section>
    <BackgroundNow />
    </div>
  );
}
