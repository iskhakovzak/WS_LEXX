import { createNamespace } from "..";
import ru from "../locales/ru/lockEggs";

/** Lock-screen easter eggs (components/lock/eggs/*, lib/lock/eggs/*). */
export const lockEggsI18n = createNamespace("lockEggs", ru, {
  en: () => import("../locales/en/lockEggs"),
  uz: () => import("../locales/uz/lockEggs"),
});
