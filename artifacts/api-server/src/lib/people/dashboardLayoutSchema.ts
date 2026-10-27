/**
 * The personal dashboard layout, `users.settings.dashboardLayout` (PUT /users/me/settings { dashboardLayout }): which
 * tiles the person shows on the dashboard, in which order and at which size, so it follows them across devices.
 * Mirrors edge-tracker src/components/dashboard/layout-model.ts (StoredLayoutSchema). Tile ids are short slugs, not an
 * enum, so a newer client never gets a 400 from an older server (the client drops ids it does not know); at most 48
 * tiles. Personal: only ever read back by GET /users/me/settings for the same caller.
 */
import { z } from "zod";

export const MAX_LAYOUT_TILES = 48;

export const DashboardLayoutSchema = z.object({
  v: z.literal(1),
  items: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/),
    size: z.enum(["s", "m", "l", "xl"]),
    rows: z.literal(2).optional(),
  })).max(MAX_LAYOUT_TILES)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, { message: "duplicate tile id" }),
  /** Every tile id the saving client knew (a newer on-by-default tile missing from it is added once by the client). */
  known: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/)).max(64).optional(),
  updatedAt: z.string().max(40).optional(),
});

export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;
