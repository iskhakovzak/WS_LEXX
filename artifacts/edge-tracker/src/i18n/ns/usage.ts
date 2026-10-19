import { createNamespace } from "..";
import ru from "../locales/ru/usage";

/** Admin console → «Использование»: internal usage tracking (screens, daily-loop funnel, inactive traders). */
export const usageI18n = createNamespace("usage", ru, {
  en: () => import("../locales/en/usage"),
  uz: () => import("../locales/uz/usage"),
});
