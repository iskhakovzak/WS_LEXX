/**
 * The story of one period for the signed-in trader: sources (api.ts) → model (model.ts) → card texts (texts.ts), plus
 * the best trade's price line, the background choice (the share card's remembered theme / artwork; each card gets the
 * next «Олимп» painting) and the desk rules (shareCards.enabled / money).
 */
import * as React from "react";
import { usePersistentState } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { personName } from "@/i18n";
import { behaviorI18n } from "@/i18n/ns/behavior";
import { wrappedI18n } from "@/i18n/ns/wrapped";
import { DEFAULT_PREFS, parsePrefs, sharePolicy, sharePrefsKey, type SharePrefs, type ThemeKind } from "@/components/shared/share-canvas/policy";
import { artOf, loadArt, stepArt, type LoadedImage } from "@/components/shared/share-canvas/art";
import { useCardSeries } from "@/components/chart-engine/hooks/useCardSeries";
import type { TradeLike } from "@/components/chart-engine/types";
import { useWrappedSources } from "./api";
import { buildWrapped, type WrappedModel } from "./model";
import { periodOf, type PeriodKind, type WrappedPeriod } from "./period";
import { storyTexts, summaryTexts, type StoryTexts, type SummaryTexts } from "./texts";
import type { Backdrop } from "./render";

export type StoryTheme = Exclude<ThemeKind, "photo">;
export const STORY_THEMES: readonly StoryTheme[] = ["olymp", "marble", "night"];

/** Seed of the procedural backgrounds: stable per period and card. */
export function seedOf(key: string, i: number): number {
  let h = 2166136261;
  for (const ch of `${key}#${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface WrappedStory {
  period: WrappedPeriod | null;
  model: WrappedModel | null;
  texts: StoryTexts[];
  summary: SummaryTexts | null;
  loading: boolean;
  sharing: { enabled: boolean };
  theme: StoryTheme;
  setTheme: (t: StoryTheme) => void;
  /** Background of card `i` (−1 = the summary); null while its artwork is loading. */
  backdropOf: (i: number) => { backdrop: Backdrop; credit: string | null } | null;
  /** Start loading the artworks of these cards. */
  preload: (indexes: number[]) => void;
  series: ReturnType<typeof useCardSeries>["series"];
  seriesLoading: boolean;
  name: string | null;
}

export function useWrappedStory(kind: PeriodKind, key: string): WrappedStory {
  const { user, permissions } = useAuth();
  // The card texts read these namespaces: re-word the cards when the language (or its dictionary) arrives.
  const { t } = wrappedI18n.useT();
  const { t: tb } = behaviorI18n.useT();
  const me = user && user.role !== "guest" ? user.traderName : null;
  const policy = sharePolicy(permissions);
  const [rawPrefs, setRawPrefs] = usePersistentState<SharePrefs>(sharePrefsKey(user?.traderName), DEFAULT_PREFS);
  const prefs = parsePrefs(rawPrefs);
  const theme: StoryTheme = prefs.theme === "photo" ? "olymp" : prefs.theme;
  const setTheme = (t: StoryTheme) => setRawPrefs({ ...prefs, theme: t });
  const period = React.useMemo(() => periodOf(kind, key), [kind, key]);
  const src = useWrappedSources(me, period);
  const model = React.useMemo(
    () => (period && !src.loading ? buildWrapped({ period, money: policy.money, stats: src.stats, behavior: src.behavior, weeks: src.weeks, readiness: src.readiness }) : null),
    [period, src.loading, src.stats, src.behavior, src.weeks, src.readiness, policy.money],
  );
  const name = prefs.showName && me ? personName(me) : null;
  // t / tb: re-word the cards on a language switch (the builders read these namespaces; a new dictionary = new t).
  const texts = React.useMemo(() => { void t; void tb; return model ? model.cards.map((c) => storyTexts(c, model, { name })) : []; }, [model, name, t, tb]);
  const summary = React.useMemo(() => { void t; void tb; return model ? summaryTexts(model, { name }) : null; }, [model, name, t, tb]);

  const best = model?.cards.find((c) => c.kind === "best");
  const bestTrade = best?.kind === "best" ? (best.trade.raw as unknown as TradeLike) : null;
  const { series, loading: seriesLoading } = useCardSeries(bestTrade, best?.kind === "best" ? best.trade.entry : null, best?.kind === "best" ? best.trade.exit : null);

  const [arts, setArts] = React.useState<Record<string, LoadedImage | null>>({});
  const base = artOf(prefs.art);
  const artFor = React.useCallback((i: number) => (i < 0 ? base : stepArt(base.id, i)), [base]);
  const preload = React.useCallback((indexes: number[]) => {
    if (theme !== "olymp") return;
    for (const i of indexes) {
      const a = artFor(i);
      void loadArt(a.id).then((img) => setArts((m) => (a.id in m ? m : { ...m, [a.id]: img })));
    }
  }, [theme, artFor]);

  const backdropOf = React.useCallback((i: number) => {
    const seed = seedOf(key, i);
    if (theme !== "olymp") return { backdrop: { theme, image: null, imageSize: null, seed }, credit: null };
    const a = artFor(i);
    if (!(a.id in arts)) return null;
    const img = arts[a.id];
    // A painting that failed to load: the night background stands in (no credit then).
    return { backdrop: { theme, image: img?.image ?? null, imageSize: img ? { w: img.w, h: img.h } : null, seed }, credit: img ? a.credit : null };
  }, [theme, arts, artFor, key]);

  return {
    period, model, texts, summary, loading: !period || src.loading, sharing: { enabled: policy.enabled },
    theme, setTheme, backdropOf, preload, series, seriesLoading, name,
  };
}
