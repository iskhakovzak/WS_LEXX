import { createNamespace } from "..";
import ru from "../locales/ru/charts";

/** Shared chart pieces (components/shared/charts): heat calendar legend, tooltips, keyboard help. */
export const chartsI18n = createNamespace("charts", ru, {
  en: () => import("../locales/en/charts"),
  uz: () => import("../locales/uz/charts"),
});
