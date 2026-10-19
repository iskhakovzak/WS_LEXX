import { createNamespace } from "..";
import ru from "../locales/ru/chartLab";

/** /chart-lab «График и разбор»: trade picker and start state (the chart itself is `chart`). */
export const chartLabI18n = createNamespace("chartLab", ru, {
  en: () => import("../locales/en/chartLab"),
  uz: () => import("../locales/uz/chartLab"),
});
