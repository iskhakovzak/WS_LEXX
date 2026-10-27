import * as React from "react";
import { useMemo } from "react";
import { Check, CloudMoon, Gem, Moon, Palette, SlidersHorizontal, Sun } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useTheme, type Theme } from "@/contexts/theme-context";
import { useAppearance } from "@/contexts/appearance-context";
import { THEME_SELECTORS, readThemeTokens } from "@/components/shared/theme-tokens";
import { cn } from "@/lib/utils";
import { Callout } from "./shared";
import { visibleSections } from "./SettingsNav";
import { useAuth } from "@/contexts/auth-context";
import { settingsI18n } from "@/i18n/ns/settings";
import { appearanceI18n } from "@/i18n/ns/appearance";

const THEME_ICONS: Record<Theme, React.ElementType> = { dark: Moon, dim: CloudMoon, platinum: Gem, light: Sun };

/** Miniature app screen rendered with a theme's own tokens. */
function ThemePreview({ tokens }: { tokens: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{ ...tokens, colorScheme: "normal" }}
      className="pointer-events-none relative h-36 overflow-hidden rounded-xl bg-background p-2.5 text-foreground"
    >
      <div className="flex h-full gap-2">
        {/* sidebar */}
        <div className="flex w-8 flex-col items-center gap-1.5 rounded-lg bg-card py-2">
          <span className="h-3.5 w-3.5 rounded-md bg-primary" />
          <span className="h-1.5 w-4 rounded-full bg-muted" />
          <span className="h-1.5 w-4 rounded-full bg-muted" />
          <span className="h-1.5 w-4 rounded-full bg-muted" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* header */}
          <div className="flex items-center justify-between rounded-lg bg-card px-2 py-1.5">
            <span className="h-1.5 w-12 rounded-full bg-foreground/70" />
            <span className="h-3 w-8 rounded-full bg-primary" />
          </div>
          {/* KPI tiles */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg border border-border bg-card p-1.5">
              <span className="block h-1 w-6 rounded-full bg-muted-foreground/60" />
              <span className="mt-1 block text-2xs font-semibold leading-none text-up">+2.4R</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-1.5">
              <span className="block h-1 w-6 rounded-full bg-muted-foreground/60" />
              <span className="mt-1 block text-2xs font-semibold leading-none text-down">−0.8R</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-1.5">
              <span className="block h-1 w-6 rounded-full bg-muted-foreground/60" />
              <span className="mt-1 block text-2xs font-semibold leading-none">62%</span>
            </div>
          </div>
          {/* chart */}
          <div className="relative flex-1 rounded-lg border border-border bg-card">
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)]">
              <polyline points="0,24 12,20 24,22 36,14 48,16 60,9 72,12 84,6 100,4" fill="none" stroke="hsl(var(--chart-1))" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const { t: ts } = settingsI18n.useT();
  const { t: ta } = appearanceI18n.useT();
  const { theme, setTheme, themes, themeLabels } = useTheme();
  const { openAppearance } = useAppearance();
  const { can } = useAuth();
  const sectionCount = Math.min(9, visibleSections(can).length);

  const tokens = useMemo(() => Object.fromEntries(themes.map((id) => [id, readThemeTokens(THEME_SELECTORS[id])])) as Record<Theme, React.CSSProperties>, [themes]);

  function onKey(e: React.KeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = themes[(idx + dir + themes.length) % themes.length];
    setTheme(next);
    (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]")[themes.indexOf(next)])?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={ts("appearance.title")}
        description={ts("appearance.description")}
        icon={Palette}
        actions={
          <Button type="button" size="sm" variant="secondary" onClick={() => openAppearance("colors")} aria-haspopup="dialog">
            <SlidersHorizontal aria-hidden="true" />
            {ts("appearance.openLook")}
          </Button>
        }
      >
        <div role="radiogroup" aria-label={ts("appearance.title")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {themes.map((id, idx) => {
            const active = theme === id;
            const Icon = THEME_ICONS[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setTheme(id)}
                onKeyDown={(e) => onKey(e, idx)}
                className={cn(
                  "lift flex flex-col gap-3 rounded-2xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary bg-primary/10" : "border-border hover:bg-[var(--glass-hover-bg)]",
                )}
              >
                <ThemePreview tokens={tokens[id]} />
                <div className="flex items-start justify-between gap-2 px-1 pb-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {themeLabels[id]}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{ta(`themes.${id}Hint`)}</p>
                  </div>
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", active ? "border-transparent bg-primary-solid text-primary-foreground" : "border-border")}>
                    {active && <Check className="h-3 w-3" aria-hidden="true" />}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{ts("appearance.openLookHint")}</p>
      </Panel>

      <Panel title={ts("appearance.hotkeys")} description={ts("appearance.hotkeysDesc")}>
        <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2"><span className="text-muted-foreground">{ts("appearance.keySearch")}</span><Kbd>/</Kbd></li>
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2"><span className="text-muted-foreground">{ts("appearance.keySection")}</span><span className="flex gap-1"><Kbd>1</Kbd>–<Kbd>{sectionCount}</Kbd></span></li>
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2"><span className="text-muted-foreground">{ts("appearance.keyNav")}</span><span className="flex gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span></li>
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2"><span className="text-muted-foreground">{ts("appearance.keyClose")}</span><Kbd>Esc</Kbd></li>
        </ul>
        <Callout className="mt-3">{ts("appearance.reducedMotion")}</Callout>
      </Panel>
    </div>
  );
}
