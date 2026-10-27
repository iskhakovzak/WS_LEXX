import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, tripletToRgb, type Rgb } from "./color";
import { BG_KINDS, DEFAULT_APPEARANCE, THEME_IDS, parseAppearance, type Appearance, type ThemeId } from "./model";
import { SCENES, SCENE_GROUPS, SCENE_IDS, sceneSources, scenesIn } from "./scenes";
import { SCENE_PHOTOS } from "./scene-photos";
import { CHIP_PRESETS, MONEY_PRESETS, applyChipsPreset, chipsPresetOf, moneyPresetOf, setAllChips } from "./presets";
import { computeAppearanceVars } from "./vars";
import ru from "@/i18n/locales/ru/appearance";
import en from "@/i18n/locales/en/appearance";
import uz from "@/i18n/locales/uz/appearance";

const DIR = path.resolve(__dirname, "../../../public/backgrounds");
const kb = (f: string) => fs.statSync(path.join(DIR, f)).size / 1024;
/** Size budget per exported width (KB): quality-tuned, so the big screens get sharp photos without heavy pages. */
const BUDGET: Record<number, number> = { 1280: 170, 1920: 310, 2560: 460, 3840: 910 };
const FREE = /^(CC0|Public domain|CC BY(-SA)? \d\.\d( [A-Z]{2})?)$/;

describe("WS originals gallery: files, sizes, credits", () => {
  const photos = Object.entries(SCENE_PHOTOS);

  it("has five groups of exactly 12 backgrounds each, every scene in exactly one", () => {
    expect(photos.length).toBeGreaterThanOrEqual(50);
    expect(SCENE_GROUPS).toEqual(["cars", "antiquity", "nature", "city", "abstract"]);
    // «Абстракции» also shows «Без фона» and the CSS backgrounds (aurora / grid / dusk) before its scenes (originals.tsx).
    const procedural = ["none", "aurora", "grid", "dusk"].length;
    for (const g of SCENE_GROUPS) expect(scenesIn(g).length + (g === "abstract" ? procedural : 0), g).toBe(12);
    expect(SCENE_GROUPS.flatMap((g) => scenesIn(g)).sort()).toEqual([...SCENE_IDS].sort());
    for (const id of SCENE_IDS) if (SCENES[id].photo) expect(SCENES[id].mode === "3d" || ["laocoon", "storm"].includes(id), id).toBe(true);
  });

  it("every photo scene ships ≥ 2560 px (3840 where the source allows), the depth layer and the thumbnail, within budget", () => {
    for (const [id, p] of photos) {
      expect(p.file).toBe(id);
      expect(p.widths, id).toContain(2560);
      expect(p.widths.every((w, i) => i === 0 || w > p.widths[i - 1]), id).toBe(true);
      for (const w of p.widths) {
        const f = `${id}-${w}.webp`;
        expect(fs.existsSync(path.join(DIR, f)), f).toBe(true);
        expect(kb(f), f).toBeLessThanOrEqual(BUDGET[w]);
      }
      for (const s of ["-bg", "-thumb"]) expect(fs.existsSync(path.join(DIR, `${id}${s}.webp`)), `${id}${s}`).toBe(true);
      expect(kb(`${id}-thumb.webp`), id).toBeLessThanOrEqual(30);
      expect(p.max).toBeGreaterThanOrEqual(p.p98);
      expect(p.p98).toBeGreaterThanOrEqual(p.min);
      expect(p.focusX).toBeGreaterThanOrEqual(0);
      expect(p.focusX).toBeLessThanOrEqual(100);
    }
    expect(photos.filter(([, p]) => (p.widths as readonly number[]).includes(3840)).length).toBeGreaterThanOrEqual(40);
  });

  it("phones never get more than the 1920 file; wide screens choose by width", () => {
    for (const [id, p] of photos) {
      const s = sceneSources(p);
      expect(s.phoneSrcSet, id).not.toMatch(/-(2560|3840)\.webp/);
      expect(s.src, id).toMatch(/-1920\.webp$/);
      for (const w of p.widths) expect(s.srcSet, id).toContain(`-${w}.webp ${w}w`);
    }
  });

  it("free licences only, Commons sources, and CREDITS.md lists every file", () => {
    const credits = fs.readFileSync(path.join(DIR, "CREDITS.md"), "utf8");
    for (const [id, p] of photos) {
      expect(p.credit.license, id).toMatch(FREE);
      expect(p.credit.author.length, id).toBeGreaterThan(1);
      expect(p.credit.source, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(credits, id).toContain(`\`${id}\``);
      expect(credits, id).toContain(p.credit.source);
    }
  });

  it("every background has a name and a one-line note in ru, en and uz", () => {
    for (const dict of [ru, en, uz]) {
      const bg = dict.background as unknown as { kinds: Record<string, string>; notes: Record<string, string>; groups: Record<string, string> };
      for (const k of BG_KINDS) {
        expect(bg.kinds[k], k).toBeTruthy();
        expect(bg.notes[k], k).toBeTruthy();
      }
      for (const g of SCENE_GROUPS) expect(bg.groups[g]).toBeTruthy();
    }
  });

  it("stored looks with a new scene parse; unknown kinds fall back", () => {
    expect(parseAppearance({ bg: { kind: "parthenon", panels: "glass", brightness: 0.5 } }).bg.kind).toBe("parthenon");
    expect(parseAppearance({ bg: { kind: "lambo", panels: "glass" } }).bg.kind).toBe("none");
  });
});

describe("Детали presets", () => {
  const themes = THEME_IDS as readonly ThemeId[];
  const tri = (t: string) => tripletToRgb(t) as Rgb;

  it("money presets round-trip and anything else reads «custom»", () => {
    for (const [id, p] of Object.entries(MONEY_PRESETS)) expect(moneyPresetOf({ ...p })).toBe(id);
    expect(moneyPresetOf(DEFAULT_APPEARANCE.money)).toBe("classic");
    expect(moneyPresetOf({ win: "#123456", loss: null, be: null })).toBe("custom");
  });

  it("«Монохром» keeps win, break-even and loss apart (and AA) in every theme", () => {
    const a: Appearance = { ...DEFAULT_APPEARANCE, money: { ...DEFAULT_APPEARANCE.money, ...MONEY_PRESETS.mono } };
    for (const theme of themes) {
      const { vars, report } = computeAppearanceVars(a, theme);
      const [win, loss, be] = ["--up", "--down", "--be"].map((k) => tri(vars[k]));
      expect(contrast(win, loss), `${theme} win/loss`).toBeGreaterThanOrEqual(1.6);
      expect(contrast(win, be), `${theme} win/be`).toBeGreaterThan(1.15);
      for (const k of ["win", "loss", "be"] as const) expect(report[k]?.ok, `${theme} ${k}`).toBe(true);
    }
  });

  it("chip presets: one switch for all groups, presets round-trip, edits read «custom»", () => {
    const base = DEFAULT_APPEARANCE.chips;
    expect(chipsPresetOf(base)).toBe("standard");
    expect(chipsPresetOf(applyChipsPreset("calm"))).toBe("calm");
    expect(chipsPresetOf(setAllChips(base, false))).toBe("off");
    expect(chipsPresetOf(setAllChips(setAllChips(applyChipsPreset("calm"), false), true))).toBe("calm");
    const edited = applyChipsPreset("calm");
    edited.strategy.colors.OPG = "#ff0000";
    expect(chipsPresetOf(edited)).toBe("custom");
    expect(CHIP_PRESETS.standard.strategy).toEqual({});
    // A fresh preset object each time (editing one must not change the table).
    expect(CHIP_PRESETS.calm.strategy.OPG).not.toBe("#ff0000");
  });
});
