import { createNamespace } from "..";
import ru from "../locales/ru/riskSignals";

/** Live risk signals (components/risk-signals/*): the trader's dashboard strip, the risk desk panel and «desk saved». */
export const riskSignalsI18n = createNamespace("riskSignals", ru, {
  en: () => import("../locales/en/riskSignals"),
  uz: () => import("../locales/uz/riskSignals"),
});
