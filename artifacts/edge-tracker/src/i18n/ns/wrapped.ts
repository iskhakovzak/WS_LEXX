import { createNamespace } from "..";
import ru from "../locales/ru/wrapped";

/** «Итоги недели / месяца» story cards (components/wrapped). */
export const wrappedI18n = createNamespace("wrapped", ru, {
  en: () => import("../locales/en/wrapped"),
  uz: () => import("../locales/uz/wrapped"),
});
