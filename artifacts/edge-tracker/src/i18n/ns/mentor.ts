import { createNamespace } from "..";
import ru from "../locales/ru/mentor";

/** «Ментор» — the personal AI mentor: pages/coach.tsx, components/mentor/*. (`coach` is the fee-coaching namespace.) */
export const mentorI18n = createNamespace("mentor", ru, {
  en: () => import("../locales/en/mentor"),
  uz: () => import("../locales/uz/mentor"),
});
