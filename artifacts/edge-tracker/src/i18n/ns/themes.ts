import { createNamespace } from "..";
import ru from "../locales/ru/themes";

/** «Темы рынка» (/themes, components/themes/*): theme tracker panels and the staff theme settings. */
export const themesI18n = createNamespace("themes", ru, {
  en: () => import("../locales/en/themes"),
  uz: () => import("../locales/uz/themes"),
});
