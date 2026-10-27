/** The assistant's shortcut as shown on the orb and in titles (Ctrl/⌘+J; matched by key code, any layout). */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const ASSISTANT_KEYS = IS_MAC ? "⌘J" : "Ctrl+J";
