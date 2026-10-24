import { createNamespace } from "..";
import ru from "../locales/ru/insightTiles";

/** Insight tiles on the dashboard and /stats (components/insight-tiles/*). */
export const insightTilesI18n = createNamespace("insightTiles", ru, {
  en: () => import("../locales/en/insightTiles"),
  uz: () => import("../locales/uz/insightTiles"),
});
