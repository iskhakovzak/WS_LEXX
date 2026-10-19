import { createNamespace } from "..";
import ru from "../locales/ru/simOwn";

/** «Тренажёр» → «Мои дни» (components/sim/own-*, components/shared/replay-own-day.tsx). */
export const simOwnI18n = createNamespace("simOwn", ru, {
  en: () => import("../locales/en/simOwn"),
  uz: () => import("../locales/uz/simOwn"),
});
