/**
 * One-click presets of the «Вид» dialog (Детали): money colours and journal chips. Pure data + «which preset is
 * this?» readers; the stored shape stays the plain colours (model.ts), so a preset is just a known set of values and
 * anything else reads as «Своя». Every colour still goes through the AA guard per theme (vars.ts).
 */
import { CHIP_GROUP_IDS, type Appearance, type ChipGroup } from "./model";

type Money = Pick<Appearance["money"], "win" | "loss" | "be">;

export const MONEY_PRESET_IDS = ["classic", "soft", "mono"] as const;
export type MoneyPresetId = (typeof MONEY_PRESET_IDS)[number];

/**
 * classic: the theme's own green / red / amber. soft: calmer emerald / rose / slate. mono: greys only — light win,
 * mid-grey loss (the sign carries the meaning); greys mirror between dark and light themes (vars.ts moneyColour).
 */
export const MONEY_PRESETS: Record<MoneyPresetId, Money> = {
  classic: { win: null, loss: null, be: null },
  soft: { win: "#34d399", loss: "#fb7185", be: "#94a3b8" },
  mono: { win: "#f5f5f5", loss: "#8c8c8c", be: "#bdbdbd" },
};

export function moneyPresetOf(m: Money): MoneyPresetId | "custom" {
  for (const id of MONEY_PRESET_IDS) {
    const p = MONEY_PRESETS[id];
    if (p.win === m.win && p.loss === m.loss && p.be === m.be) return id;
  }
  return "custom";
}

export const CHIP_PRESET_IDS = ["standard", "calm"] as const;
export type ChipPresetId = (typeof CHIP_PRESET_IDS)[number];

/** Custom colours per group for each preset (standard = the stylesheet's own). Calm: the same hues, desaturated. */
export const CHIP_PRESETS: Record<ChipPresetId, Record<ChipGroup, Record<string, string>>> = {
  standard: { strategy: {}, tag: {}, horizon: {} },
  calm: {
    strategy: {
      OPG: "#6b8fb8", Print: "#5e979e", OPGtoDAY: "#b48a6e", Day: "#5f9c84", MOC: "#b09a62",
      AfterMarket: "#b07490", Overnight: "#6e9c72", Swing: "#9488bf", PM: "#8a93a3", IMX: "#b8846a",
    },
    tag: { setup: "#7a96b8", mistake: "#b89a6a", emotion: "#9c8abf" },
    horizon: { overnight: "#9c8abf", swing: "#9488bf" },
  },
};

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

/** «off» when every group is switched off; a preset when all groups match it; otherwise «custom». */
export function chipsPresetOf(chips: Appearance["chips"]): ChipPresetId | "custom" | "off" {
  if (CHIP_GROUP_IDS.every((g) => !chips[g].on)) return "off";
  for (const id of CHIP_PRESET_IDS) {
    if (CHIP_GROUP_IDS.every((g) => chips[g].on && same(chips[g].colors, CHIP_PRESETS[id][g]))) return id;
  }
  return "custom";
}

export function applyChipsPreset(id: ChipPresetId): Appearance["chips"] {
  return Object.fromEntries(CHIP_GROUP_IDS.map((g) => [g, { on: true, colors: { ...CHIP_PRESETS[id][g] } }])) as Appearance["chips"];
}

/** One switch for all chip groups (keeps each group's colours). */
export function setAllChips(chips: Appearance["chips"], on: boolean): Appearance["chips"] {
  return Object.fromEntries(CHIP_GROUP_IDS.map((g) => [g, { ...chips[g], on }])) as Appearance["chips"];
}
