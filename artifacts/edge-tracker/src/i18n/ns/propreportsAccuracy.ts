import { createNamespace } from "..";
import ru from "../locales/ru/propreportsAccuracy";

/** PropReports accuracy panels (/integrations, admin «Данные»): broker adjustments, nightly reconciliation. */
export const propreportsAccuracyI18n = createNamespace("propreportsAccuracy", ru, {
  en: () => import("../locales/en/propreportsAccuracy"),
  uz: () => import("../locales/uz/propreportsAccuracy"),
});
