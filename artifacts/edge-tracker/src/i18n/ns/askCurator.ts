import { createNamespace } from "..";
import ru from "../locales/ru/askCurator";

/** «Попросить куратора» (Волна 1 п. 1.1): the button next to every «задаёт куратор», and the curator's «Запросы». */
export const askCuratorI18n = createNamespace("askCurator", ru, {
  en: () => import("../locales/en/askCurator"),
  uz: () => import("../locales/uz/askCurator"),
});
