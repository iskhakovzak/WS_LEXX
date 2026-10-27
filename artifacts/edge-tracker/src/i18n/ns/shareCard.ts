import { createNamespace } from "..";
import ru from "../locales/ru/shareCard";

/** «Картинка сделки»: the share-card dialog and its buttons (components/trades/share-card). */
export const shareCardI18n = createNamespace("shareCard", ru, {
  en: () => import("../locales/en/shareCard"),
  uz: () => import("../locales/uz/shareCard"),
});
