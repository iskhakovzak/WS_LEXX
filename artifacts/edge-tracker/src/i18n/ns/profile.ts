import { createNamespace } from "..";
import ru from "../locales/ru/profile";

/** /profile, /people/:id — the personal profile (pages/profile.tsx, components/profile/*). */
export const profileI18n = createNamespace("profile", ru, {
  en: () => import("../locales/en/profile"),
  uz: () => import("../locales/uz/profile"),
});
