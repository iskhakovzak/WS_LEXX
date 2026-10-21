import { createNamespace } from "..";
import ru from "../locales/ru/finviz";

/** Finviz Elite widgets (components/shared/finviz/*): morning screener, ticker context, earnings badge and block. */
export const finvizI18n = createNamespace("finviz", ru, {
  en: () => import("../locales/en/finviz"),
  uz: () => import("../locales/uz/finviz"),
});
