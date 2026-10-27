import { createNamespace } from "..";
import ru from "../locales/ru/coach";

/** Fee-aware coaching (components/shared/coach/*): the weekly fee card, the breakeven line, the staff-only plan what-if; wave 1: interventions, edge map, «Застряли», curator priority (components/curator/coach-*, components/shared/edge-map). */
export const coachI18n = createNamespace("coach", ru, {
  en: () => import("../locales/en/coach"),
  uz: () => import("../locales/uz/coach"),
});
