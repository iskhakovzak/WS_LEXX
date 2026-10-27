import { createNamespace } from "..";
import ru from "../locales/ru/myEdge";

/** «Мой edge и рынок» — the analytics tab and the dashboard line (components/analytics-page/my-edge/*). */
export const myEdgeI18n = createNamespace("myEdge", ru, {
  en: () => import("../locales/en/myEdge"),
  uz: () => import("../locales/uz/myEdge"),
});
