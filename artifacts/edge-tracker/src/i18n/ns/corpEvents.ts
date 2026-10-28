import { createNamespace } from "..";
import ru from "../locales/ru/corpEvents";

/** /events block «Корпоративные и индексные события» (components/events/corp-events*.tsx). */
export const corpEventsI18n = createNamespace("corpEvents", ru, {
  en: () => import("../locales/en/corpEvents"),
  uz: () => import("../locales/uz/corpEvents"),
});
