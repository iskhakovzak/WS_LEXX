import { createNamespace } from "..";
import ru from "../locales/ru/strategy";

/** «Стратегия = три строки»: catalyst marks, the analytics slice, the playbook formula, variants, day two, the lesson. */
export const strategyI18n = createNamespace("strategy", ru, {
  en: () => import("../locales/en/strategy"),
  uz: () => import("../locales/uz/strategy"),
});
