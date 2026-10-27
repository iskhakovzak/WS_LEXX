import { createNamespace } from "..";
import ru from "../locales/ru/marketRegime";

/** Desk market regime (components/shared/regime/*, dashboard tile, plan / risk headers, playbook, weekly reflection). */
export const marketRegimeI18n = createNamespace("marketRegime", ru, {
  en: () => import("../locales/en/marketRegime"),
  uz: () => import("../locales/uz/marketRegime"),
});
