import { createNamespace } from "..";
import ru from "../locales/ru/insightCards";

/** Compact insight cards on the dashboard and /stats (components/insight-cards/*). */
export const insightCardsI18n = createNamespace("insightCards", ru, {
  en: () => import("../locales/en/insightCards"),
  uz: () => import("../locales/uz/insightCards"),
});
