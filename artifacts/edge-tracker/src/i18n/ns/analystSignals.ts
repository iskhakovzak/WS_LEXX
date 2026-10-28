import { createNamespace } from "..";
import ru from "../locales/ru/analystSignals";

/** /analyst-actions block «Сила катализатора» (components/analyst/StrengthSignals.tsx). */
export const analystSignalsI18n = createNamespace("analystSignals", ru, {
  en: () => import("../locales/en/analystSignals"),
  uz: () => import("../locales/uz/analystSignals"),
});
