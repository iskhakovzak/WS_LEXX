import { createNamespace } from "..";
import ru from "../locales/ru/capital";

/** /scaling → «Распределение риска»: capital allocation proposals, desk view, applied changes (components/scaling/capital-*). */
export const capitalI18n = createNamespace("capital", ru, {
  en: () => import("../locales/en/capital"),
  uz: () => import("../locales/uz/capital"),
});
