import { createNamespace } from "..";
import ru from "../locales/ru/coach";

/** Coaching evidence, roadmap Wave 1 (components/curator/coach-*, components/shared/edge-map, my-review edge rows). */
export const coachI18n = createNamespace("coach", ru, {
  en: () => import("../locales/en/coach"),
  uz: () => import("../locales/uz/coach"),
});
