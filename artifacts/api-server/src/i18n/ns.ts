/** Server namespaces. Add one per area: `export const <area>T = defineNamespace(ru<Area>, { en: en<Area>, uz: uz<Area> });` */
import { defineNamespace } from ".";
import ruCommon from "./ru/common";
import enCommon from "./en/common";
import uzCommon from "./uz/common";

export const commonT = defineNamespace(ruCommon, { en: enCommon, uz: uzCommon });
