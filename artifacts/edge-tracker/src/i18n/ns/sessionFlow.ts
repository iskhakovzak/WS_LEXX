import { createNamespace } from "..";
import ru from "../locales/ru/sessionFlow";

/** Session flow (components/shared/session-flow/*): re-entries, chases, give-back, green-to-red, robust edge, timing. */
export const sessionFlowI18n = createNamespace("sessionFlow", ru, {
  en: () => import("../locales/en/sessionFlow"),
  uz: () => import("../locales/uz/sessionFlow"),
});
