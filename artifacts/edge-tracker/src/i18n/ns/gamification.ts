import { createNamespace } from "..";
import ru from "../locales/ru/gamification";

/** Gamification: season bar and ranking, curator league, mastery, streak freeze, titles, recognition, rewards catalog. */
export const gamificationI18n = createNamespace("gamification", ru, {
  en: () => import("../locales/en/gamification"),
  uz: () => import("../locales/uz/gamification"),
});
