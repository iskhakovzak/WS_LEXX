import { createNamespace } from "..";
import ru from "../locales/ru/juniorCost";

/** «Цена джуна до безубытка» (components/shared/junior-cost/*, components/office-stats/junior-cost-*.tsx). */
export const juniorCostI18n = createNamespace("juniorCost", ru, {
  en: () => import("../locales/en/juniorCost"),
  uz: () => import("../locales/uz/juniorCost"),
});
