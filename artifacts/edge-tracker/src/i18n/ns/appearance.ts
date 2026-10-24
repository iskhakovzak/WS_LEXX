import { createNamespace } from "..";
import ru from "../locales/ru/appearance";

/** «Вид» — the personal appearance customiser (components/appearance/*, contexts/appearance-context). */
export const appearanceI18n = createNamespace("appearance", ru, {
  en: () => import("../locales/en/appearance"),
  uz: () => import("../locales/uz/appearance"),
});
