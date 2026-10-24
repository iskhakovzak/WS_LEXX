/**
 * «Вид» (appearance customiser) settings: the shape, presets, defaults and the zod schema.
 * Stored per user in `users.settings.appearance` (PUT /api/users/me/settings, mirrored by the API's
 * lib/users/appearanceSchema.ts) and cached in localStorage for a flash-free first paint (lib/appearance/apply.ts).
 * The theme itself stays in `users.theme` (PATCH /api/users/theme); a saved look («образ») carries its theme.
 * The background image is never part of this: it lives in IndexedDB on the device (lib/appearance/bg-store.ts).
 */
import { z } from "zod";

export const THEME_IDS = ["dark", "dim", "platinum", "light"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
/** Themes with dark text on light surfaces (text tone applies here; no `.dark` class). */
export const LIGHT_THEMES: readonly ThemeId[] = ["platinum", "light"];
export const isLightTheme = (t: ThemeId): boolean => LIGHT_THEMES.includes(t);

/** Accent swatches: base hues; the guard (vars.ts) moves their lightness per theme so text and fills stay AA. */
export const ACCENTS = {
  ink: null, // the theme's own monochrome primary (white in dark themes, ink in light ones)
  blue: "#3b82f6",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  green: "#22c55e",
  lime: "#84cc16",
  amber: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
  slate: "#64748b",
} as const satisfies Record<string, string | null>;
export type AccentId = keyof typeof ACCENTS;
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

/** Text tones for the light themes (all pass AA on every light surface; see appearance tests). */
export const TEXT_TONES = {
  ink: null,
  graphite: "#2b2f34",
  espresso: "#3b2a21",
  navy: "#1b2a4a",
} as const satisfies Record<string, string | null>;
export type TextToneId = keyof typeof TEXT_TONES;
export const TEXT_TONE_IDS = Object.keys(TEXT_TONES) as TextToneId[];

export const LINE_MODES = ["theme", "text", "accent"] as const;
export type LineMode = (typeof LINE_MODES)[number];

export const FONT_IDS = ["inter", "geist", "serif", "mono"] as const;
export type FontId = (typeof FONT_IDS)[number];
/** CSS font stacks (Geist and Source Serif 4 are self-hosted: src/assets/fonts, OFL). */
export const FONT_STACKS: Record<FontId, string | null> = {
  inter: null, // index.css default
  geist: "'Geist Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  serif: "'Source Serif 4 Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

/** «WS originals» (lib/appearance/scenes): interactive 3D / HOVER backgrounds. «smoke» is the HOVER smoke. */
export const SCENE_IDS = ["smoke", "ridge", "porsche-gt3rs", "porsche-wheel", "laocoon", "discobolus", "hercules", "zeus", "porsche-gt3", "porsche-turbo-s", "porsche-918", "carrera-gt", "porsche-rs27", "ferrari-f40", "parthenon", "sounion", "nike", "riace", "delphi", "matterhorn", "storm", "manhattan", "nyse"] as const;
export type SceneId = (typeof SCENE_IDS)[number];
export const BG_KINDS = ["none", "image", "aurora", "grid", "dusk", ...SCENE_IDS] as const;
export type BgKind = (typeof BG_KINDS)[number];
export const PANEL_MODES = ["glass", "frosted", "solid"] as const;
/** «Движение и анимации» for the whole app: on by default (whatever the OS says), the viewer can switch it off.
 * An old stored «auto» (the earlier third choice) reads as «on». */
export const BG_MOTIONS = ["on", "off"] as const;
export type BgMotion = (typeof BG_MOTIONS)[number];
export type PanelMode = (typeof PANEL_MODES)[number];
export const DENSITIES = ["compact", "spacious"] as const;
export type Density = (typeof DENSITIES)[number];
export const GUARD_MODES = ["off", "streak", "daily"] as const;
export type GuardMode = (typeof GUARD_MODES)[number];

/** Upper bound of the break-even range (USD either side of zero). */
export const BE_RANGE_MAX = 1000;
export const MAX_LOOKS = 5;
export const LOOK_NAME_MAX = 32;

/** «Чипы журнала»: chip groups and their keys (CSS tokens --chip-<group>-<key lower-case>, index.css). */
export const CHIP_GROUPS = {
  strategy: ["OPG", "Print", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing", "PM", "IMX"],
  tag: ["setup", "mistake", "emotion", "other"],
  horizon: ["intraday", "overnight", "swing"],
} as const;
export type ChipGroup = keyof typeof CHIP_GROUPS;
export const CHIP_GROUP_IDS = Object.keys(CHIP_GROUPS) as ChipGroup[];
export const chipToken = (group: ChipGroup, key: string) => `--chip-${group}-${key.toLowerCase()}`;

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/);
const chipGroupSchema = (group: ChipGroup) =>
  z.object({
    /** Off: every chip of the group is neutral. */
    on: z.boolean().catch(true),
    /** Custom colours by key; keys outside the group and broken colours are dropped. */
    colors: z.record(z.string(), z.unknown()).catch({}).transform((r) =>
      Object.fromEntries(Object.entries(r).filter(([k, v]) => (CHIP_GROUPS[group] as readonly string[]).includes(k) && hex.safeParse(v).success)) as Record<string, string>),
  }).catch({ on: true, colors: {} });
const presetOrHex = <T extends readonly [string, ...string[]]>(ids: T) => z.union([z.enum(ids), hex]);

export const appearanceSchema = z.object({
  /** Accent: a swatch id or a custom #rrggbb. */
  accent: presetOrHex(ACCENT_IDS as [AccentId, ...AccentId[]]).catch("ink"),
  /** Text tone in the light themes: a tone id or a custom #rrggbb (guarded to AA). */
  textTone: presetOrHex(TEXT_TONE_IDS as [TextToneId, ...TextToneId[]]).catch("ink"),
  /** Hairlines: the theme's, derived from the text colour, from the accent, or a custom #rrggbb. */
  lines: presetOrHex(LINE_MODES).catch("theme"),
  font: z.enum(FONT_IDS).catch("inter"),
  money: z.object({
    win: hex.nullable().catch(null),
    loss: hex.nullable().catch(null),
    be: hex.nullable().catch(null),
    /** ±USD around zero that reads as break-even in the UI (colour / label only; data and analytics untouched). */
    beRange: z.number().finite().min(0).max(BE_RANGE_MAX).catch(0),
  }).catch({ win: null, loss: null, be: null, beRange: 0 }),
  guard: z.object({
    mode: z.enum(GUARD_MODES).catch("off"),
    color: hex.nullable().catch(null),
  }).catch({ mode: "off", color: null }),
  bg: z.object({
    kind: z.enum(BG_KINDS).catch("none"),
    panels: z.enum(PANEL_MODES).catch("glass"),
    /** «Яркость фона»: share (0…1) of the brightest a scene / image may show in this theme (lib/appearance/scenes). */
    brightness: z.number().finite().min(0).max(1).catch(0.7),
    motion: z.preprocess((v) => (v === "auto" ? "on" : v), z.enum(BG_MOTIONS)).catch("on"),
  }).catch({ kind: "none", panels: "glass", brightness: 0.7, motion: "on" }),
  density: z.enum(DENSITIES).catch("compact"),
  chips: z.object({
    strategy: chipGroupSchema("strategy"),
    tag: chipGroupSchema("tag"),
    horizon: chipGroupSchema("horizon"),
  }).catch({ strategy: { on: true, colors: {} }, tag: { on: true, colors: {} }, horizon: { on: true, colors: {} } }),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const lookSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(LOOK_NAME_MAX),
  theme: z.enum(THEME_IDS),
  settings: appearanceSchema,
});
export type Look = z.infer<typeof lookSchema>;

/** What `users.settings.appearance` holds. */
export const storedAppearanceSchema = z.object({
  v: z.literal(1).catch(1),
  current: appearanceSchema,
  looks: z.array(lookSchema).max(MAX_LOOKS).catch([]),
});
export type StoredAppearance = z.infer<typeof storedAppearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = Object.freeze({
  accent: "ink",
  textTone: "ink",
  lines: "theme",
  font: "inter",
  money: { win: null, loss: null, be: null, beRange: 0 },
  guard: { mode: "off", color: null },
  bg: { kind: "none", panels: "glass", brightness: 0.7, motion: "on" },
  density: "compact",
  chips: { strategy: { on: true, colors: {} }, tag: { on: true, colors: {} }, horizon: { on: true, colors: {} } },
}) as Appearance;

/** Lenient read: any stored value (old, partial, foreign) → a full, valid Appearance; invalid fields fall back. */
export function parseAppearance(raw: unknown): Appearance {
  const r = appearanceSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return r.success ? r.data : { ...DEFAULT_APPEARANCE };
}

/** Lenient read of the stored block (current + looks); looks beyond the limit or broken are dropped. */
export function parseStored(raw: unknown): StoredAppearance {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const looks = Array.isArray(obj.looks)
    ? obj.looks.flatMap((l) => { const p = lookSchema.safeParse(l); return p.success ? [p.data] : []; }).slice(0, MAX_LOOKS)
    : [];
  return { v: 1, current: parseAppearance(obj.current), looks };
}

export function isDefault(a: Appearance): boolean {
  return JSON.stringify(a) === JSON.stringify(DEFAULT_APPEARANCE);
}

/** The hex behind an accent value (null = the theme's own primary). */
export function accentHex(v: Appearance["accent"]): string | null {
  return v in ACCENTS ? ACCENTS[v as AccentId] : v;
}
export function toneHex(v: Appearance["textTone"]): string | null {
  return v in TEXT_TONES ? TEXT_TONES[v as TextToneId] : v;
}
