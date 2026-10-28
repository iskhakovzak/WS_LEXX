/**
 * Quote library preferences, stored per user in `users.settings.quotes` (PUT /users/me/settings { quotes }). The web
 * mirrors this shape in edge-tracker src/lib/quotes/store.ts (parsePrefs). The library itself is served by
 * routes/quotes.ts (src/data/quotes); these are the reader's choices, so they follow them across devices:
 *   seed  rotation seed of the no-repeat cycle (lib/quotes/rotation.ts)
 *   favs  favourite quote ids («il-012»…), newest first, at most 300
 *   cats  categories kept on in the dashboard card (empty = all)
 */
import { z } from "zod";
import { QUOTE_CATS } from "../quotes/types";

export const QUOTE_FAVS_MAX = 300;

export const QuotePrefsSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  favs: z.array(z.string().regex(/^[a-z]{2,4}-\d{3,4}$/)).max(QUOTE_FAVS_MAX).optional(),
  cats: z.array(z.enum(QUOTE_CATS)).max(QUOTE_CATS.length).optional(),
});

export type QuotePrefs = z.infer<typeof QuotePrefsSchema>;
