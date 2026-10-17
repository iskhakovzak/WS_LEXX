/** Server namespaces. Add one per area: `export const <area>T = defineNamespace(ru<Area>, { en: en<Area>, uz: uz<Area> });` */
import { defineNamespace } from ".";
import ruCommon from "./ru/common";
import enCommon from "./en/common";
import uzCommon from "./uz/common";
import ruErrors from "./ru/errors";
import enErrors from "./en/errors";
import uzErrors from "./uz/errors";
import ruNotifications from "./ru/notifications";
import enNotifications from "./en/notifications";
import uzNotifications from "./uz/notifications";

export const commonT = defineNamespace(ruCommon, { en: enCommon, uz: uzCommon });

/** `errors`: one text per API error code (src/lib/http/errors.ts ERROR_CODES). Used by the error middleware. */
export const errorsT = defineNamespace(ruErrors, { en: enErrors, uz: uzErrors });

/** `notifications`: notification texts stored as type + params (lib/notificationText.ts renderNotification). */
export const notificationsT = defineNamespace(ruNotifications, { en: enNotifications, uz: uzNotifications });
