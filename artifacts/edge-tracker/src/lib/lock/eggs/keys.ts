/**
 * Who owns a key press on the lock screen: the unlock field («начните печатать») or an easter egg.
 *
 *   data-lock-egg="game" — an open mini-game: every key is the game's (Esc closes it).
 *   data-lock-egg="menu" — the corner trigger and the game launcher: Enter / Space / arrows / Esc work their buttons,
 *                          while any printable character (a digit of the code) still starts the unlock.
 * Anywhere else the unlock field takes the key as before.
 */

type ClosestTarget = { closest?: (selector: string) => { getAttribute: (name: string) => string | null } | null } | null;

export const LOCK_EGG_ATTR = "data-lock-egg";

export function lockEggOwnsKey(target: EventTarget | ClosestTarget | null, key: string): boolean {
  const el = target as ClosestTarget;
  const zone = typeof el?.closest === "function" ? el.closest(`[${LOCK_EGG_ATTR}]`)?.getAttribute(LOCK_EGG_ATTR) : null;
  if (zone === "game") return true;
  if (zone === "menu") return key.length !== 1 || key === " ";
  return false;
}
