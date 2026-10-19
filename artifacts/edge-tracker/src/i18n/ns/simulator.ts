import { createNamespace } from "..";
import ru from "../locales/ru/simulator";

/** «Тренажёр» game screen — the chart game (components/sim/*, pages/trainer.tsx). */
export const simI18n = createNamespace("simulator", ru, {
  en: () => import("../locales/en/simulator"),
  uz: () => import("../locales/uz/simulator"),
});
