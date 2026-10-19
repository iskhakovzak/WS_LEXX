import { createNamespace } from "..";
import ru from "../locales/ru/quests";

/** Quests and achievements: dashboard strip, «Квесты и достижения» tab, curator block and «Дать квест» dialog. */
export const questsI18n = createNamespace("quests", ru, {
  en: () => import("../locales/en/quests"),
  uz: () => import("../locales/uz/quests"),
});
