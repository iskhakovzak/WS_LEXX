import { createNamespace } from "..";
import ru from "../locales/ru/medals";

/** «Ступени как награды»: stage medals, award coins and the promotion reveal (components/shared/medals). */
export const medalsI18n = createNamespace("medals", ru, {
  en: () => import("../locales/en/medals"),
  uz: () => import("../locales/uz/medals"),
});
