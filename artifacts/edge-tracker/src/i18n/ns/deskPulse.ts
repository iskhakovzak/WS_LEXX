import { createNamespace } from "..";
import ru from "../locales/ru/deskPulse";

/** Desk pulse, easy money of the day, the season report (components/shared/desk-pulse/*, pages/season-report). */
export const deskPulseI18n = createNamespace("deskPulse", ru, {
  en: () => import("../locales/en/deskPulse"),
  uz: () => import("../locales/uz/deskPulse"),
});
