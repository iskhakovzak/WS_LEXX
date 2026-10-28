import { createNamespace } from "..";
import ru from "../locales/ru/analogues";

/** Library of analogues: playbook cases, «похожие прошлые случаи», the academy quiz (components/shared/analogues/*). */
export const analoguesI18n = createNamespace("analogues", ru, {
  en: () => import("../locales/en/analogues"),
  uz: () => import("../locales/uz/analogues"),
});
