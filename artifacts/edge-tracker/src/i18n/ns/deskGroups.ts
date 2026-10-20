import { createNamespace } from "..";
import ru from "../locales/ru/deskGroups";

/** «Группы» (Волна 1 п. 1.19): desk groups with their curator and traders — components/settings/groups-panel.tsx. */
export const deskGroupsI18n = createNamespace("deskGroups", ru, {
  en: () => import("../locales/en/deskGroups"),
  uz: () => import("../locales/uz/deskGroups"),
});
