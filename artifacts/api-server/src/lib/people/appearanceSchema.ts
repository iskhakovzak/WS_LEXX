/**
 * Validation of the personal «Вид» block, `users.settings.appearance` (PUT /users/me/settings { appearance }).
 * Mirrors edge-tracker src/lib/appearance/model.ts. Strict on write: a value outside the known set is a 400, unknown
 * keys are dropped, at most 5 saved looks. The block is personal — it lives on the caller's own row and is only ever
 * read back by GET /users/me/settings for that same caller (no staff view, no desk-wide copy).
 * The background image is not here by design: it stays in the browser's IndexedDB on the device.
 */
import { z } from "zod";

export const APPEARANCE_THEMES = ["dark", "dim", "platinum", "light"] as const;
const ACCENTS = ["ink", "blue", "cyan", "teal", "green", "lime", "amber", "orange", "red", "slate"] as const;
const TONES = ["ink", "graphite", "espresso", "navy"] as const;
const LINES = ["theme", "text", "accent"] as const;
/** «WS originals» scenes (edge-tracker lib/appearance/model SCENE_IDS). */
const SCENES = ["smoke", "ridge", "porsche-gt3rs", "porsche-wheel", "laocoon", "discobolus", "hercules", "zeus"] as const;
/** «Чипы журнала» keys per group (edge-tracker CHIP_GROUPS). */
const CHIP_KEYS = {
  strategy: ["OPG", "Print", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing", "PM", "IMX"],
  tag: ["setup", "mistake", "emotion", "other"],
  horizon: ["intraday", "overnight", "swing"],
} as const;
export const MAX_LOOKS = 5;
export const BE_RANGE_MAX = 1000;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const chipGroup = <T extends readonly [string, ...string[]]>(keys: T) => z.object({ on: z.boolean(), colors: z.record(z.enum(keys), hex) });
const presetOrHex = <T extends readonly [string, ...string[]]>(ids: T) => z.union([z.enum(ids), hex]);

export const AppearanceSchema = z.object({
  accent: presetOrHex(ACCENTS),
  textTone: presetOrHex(TONES),
  lines: presetOrHex(LINES),
  font: z.enum(["inter", "geist", "serif", "mono"]),
  money: z.object({
    win: hex.nullable(),
    loss: hex.nullable(),
    be: hex.nullable(),
    /** ±USD shown as break-even in the UI (presentation only; no server number depends on it). */
    beRange: z.number().finite().min(0).max(BE_RANGE_MAX),
  }),
  guard: z.object({
    mode: z.enum(["off", "streak", "daily"]),
    color: hex.nullable(),
  }),
  bg: z.object({
    kind: z.enum(["none", "image", "aurora", "grid", "dusk", ...SCENES]),
    panels: z.enum(["glass", "frosted", "solid"]),
    /** «Яркость фона» 0…1 (optional: older clients send none). */
    brightness: z.number().finite().min(0).max(1).optional(),
  }),
  density: z.enum(["compact", "spacious"]),
  /** Optional: clients before the chips setting send none. */
  chips: z.object({
    strategy: chipGroup(CHIP_KEYS.strategy),
    tag: chipGroup(CHIP_KEYS.tag),
    horizon: chipGroup(CHIP_KEYS.horizon),
  }).optional(),
});

export const LookSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(32),
  theme: z.enum(APPEARANCE_THEMES),
  settings: AppearanceSchema,
});

export const StoredAppearanceSchema = z.object({
  v: z.literal(1),
  current: AppearanceSchema,
  looks: z.array(LookSchema).max(MAX_LOOKS),
}).refine((s) => new Set(s.looks.map((l) => l.id)).size === s.looks.length, { message: "duplicate look id", path: ["looks"] });

export type StoredAppearance = z.infer<typeof StoredAppearanceSchema>;
