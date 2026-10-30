import { createNamespace } from "..";
import ru from "../locales/ru/help";

/** One help text per tool (lib/help/registry): the «?» popover, the daily-loop tour and «Справочник» (/guide). */
export const helpI18n = createNamespace("help", ru, {
  en: () => import("../locales/en/help"),
  uz: () => import("../locales/uz/help"),
});
