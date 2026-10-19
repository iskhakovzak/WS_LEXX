import { createNamespace } from "..";
import ru from "../locales/ru/playbookToday";

/** Playbook «Сегодня»: morning landing, cheat sheet, tier locks, quick / tagging sheets, day row and plan bits. */
export const playbookTodayI18n = createNamespace("playbookToday", ru, {
  en: () => import("../locales/en/playbookToday"),
  uz: () => import("../locales/uz/playbookToday"),
});
