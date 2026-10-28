import { createNamespace } from "..";
import ru from "../locales/ru/briefings";

/** Academy briefing video library (components/academy/briefings*.tsx). */
export const briefingsI18n = createNamespace("briefings", ru, {
  en: () => import("../locales/en/briefings"),
  uz: () => import("../locales/uz/briefings"),
});
