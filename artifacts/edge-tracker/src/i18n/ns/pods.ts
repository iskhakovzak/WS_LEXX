import { createNamespace } from "..";
import ru from "../locales/ru/pods";

/** Trading pods (components/pods/*): the member's pod panel, the curator's pod manager. */
export const podsI18n = createNamespace("pods", ru, {
  en: () => import("../locales/en/pods"),
  uz: () => import("../locales/uz/pods"),
});
