import { createNamespace } from "..";
import ru from "../locales/ru/trainer";

/** /trainer «Тренажёр»: home with four modes, «Найди вход» drills, the daily reveal and desk ranking (components/sim/trainer-*). */
export const trainerI18n = createNamespace("trainer", ru, {
  en: () => import("../locales/en/trainer"),
  uz: () => import("../locales/uz/trainer"),
});
