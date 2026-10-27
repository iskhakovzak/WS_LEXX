import { createNamespace } from "..";
import ru from "../locales/ru/dayState";

/** The trader's day state: dashboard lead cards (stop, return, newcomer), state folding, team column, «молчит N дней». */
export const dayStateI18n = createNamespace("dayState", ru, {
  en: () => import("../locales/en/dayState"),
  uz: () => import("../locales/uz/dayState"),
});
