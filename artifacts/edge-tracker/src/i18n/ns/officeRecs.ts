import { createNamespace } from "..";
import ru from "../locales/ru/officeRecs";

/** «Рекомендации офису» + the «Обзор» extras of «Статистика офиса» (components/office-stats/recommendations.tsx, …). */
export const officeRecsI18n = createNamespace("officeRecs", ru, {
  en: () => import("../locales/en/officeRecs"),
  uz: () => import("../locales/uz/officeRecs"),
});
