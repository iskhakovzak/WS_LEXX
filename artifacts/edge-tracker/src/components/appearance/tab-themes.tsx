/** «Вид» → Темы: four preview tiles (a mini page with the day's number and a bar chart), each in its real tokens
 * plus the person's own accent / money colours computed for that theme. */
import * as React from "react";
import { useTheme } from "@/contexts/theme-context";
import { useAppearance } from "@/contexts/appearance-context";
import { THEME_IDS, type ThemeId } from "@/lib/appearance/model";
import { computeAppearanceVars } from "@/lib/appearance/vars";
import { THEME_SELECTORS, readThemeTokens } from "@/components/shared/theme-tokens";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { OptionCard, Section } from "./bits";

const BARS = [38, 62, -24, 48, 80, -40, 66, 54, -18, 72];

function MiniPage({ style }: { style: React.CSSProperties }) {
  return (
    <div aria-hidden="true" style={{ ...style, colorScheme: "normal" }} className="pointer-events-none relative h-32 overflow-hidden rounded-xl bg-background p-2 text-foreground">
      <div className="flex h-full gap-1.5">
        <div className="flex w-6 flex-col items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-sidebar py-1.5">
          <span className="h-3 w-3 rounded-md bg-primary" />
          <span className="h-1 w-3 rounded-full bg-muted-foreground/50" />
          <span className="h-1 w-3 rounded-full bg-muted-foreground/50" />
          <span className="h-1 w-3 rounded-full bg-muted-foreground/50" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border border-[hsl(var(--card-border))] bg-card p-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] leading-none text-muted-foreground">P&amp;L</span>
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
    <Section title={t("tabs.themes")} hint={t("themes.hint")}>
      <div role="radiogroup" aria-label={t("tabs.themes")} className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {THEME_IDS.map((id) => (
          <OptionCard key={id} selected={theme === id} onSelect={() => setTheme(id)} label={`${themeLabels[id]}. ${t(`themes.${id}Hint`)}`}>
            <MiniPage style={styles[id]} />
            <span className="px-1 pb-0.5">
              <span className="block text-sm font-semibold text-foreground">{themeLabels[id]}</span>
              <span className="block text-xs text-muted-foreground">{t(`themes.${id}Hint`)}</span>
            </span>
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}
