import { describe, expect, it } from "vitest";
import { ALL_NAV_ITEMS } from "@/components/shell/nav";
import { blockableSections } from "@/components/shell/nav-model";
import ru from "@/i18n/locales/ru/help";
import en from "@/i18n/locales/en/help";
import uz from "@/i18n/locales/uz/help";
import { HELP, HELP_IDS, HELP_PHASES, WIDGET_IDS, guideGroups, helpVisible, isHelpId, isWidget, matchesQuery, nextFor, type HelpViewer } from "./registry";

const LANGS = { ru, en, uz } as const;
const FIELDS = ["what", "why", "read", "example"] as const;
const open: HelpViewer = { isCurator: false, tier: "junior", canOpen: () => true };

describe("help registry: one entry per tool", () => {
  it("every nav route has an entry, living at the nav item's own href", () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(isHelpId(item.key), item.key).toBe(true);
      expect(HELP[item.key as keyof typeof HELP].href, item.key).toBe(item.href);
      expect(!!HELP[item.key as keyof typeof HELP].staff, item.key).toBe(!!item.staff);
    }
    // Nothing else besides the nav pages and the named cards.
    const pages = new Set(ALL_NAV_ITEMS.map((i) => i.key as string));
    for (const id of HELP_IDS) expect(pages.has(id) || isWidget(id), id).toBe(true);
    for (const w of WIDGET_IDS) expect(pages.has(w), w).toBe(false);
  });

  it("every entry has all four lines in RU, EN and UZ — short, and different per language", () => {
    for (const id of HELP_IDS) {
      for (const [lang, dict] of Object.entries(LANGS)) {
        const e = (dict.entries as Record<string, Record<string, string>>)[id];
        expect(e, `${lang} ${id}`).toBeTruthy();
        for (const f of FIELDS) {
          const v = e?.[f] ?? "";
          expect(v.trim().length, `${lang} ${id}.${f}`).toBeGreaterThan(8);
          expect(v.length, `${lang} ${id}.${f} is too long`).toBeLessThanOrEqual(200);
        }
      }
      expect(en.entries[id].what, id).not.toBe(ru.entries[id].what);
      expect(uz.entries[id].what, id).not.toBe(en.entries[id].what);
    }
  });

  it("cards have a title, phases a label and a hint, in every language", () => {
    for (const dict of Object.values(LANGS)) {
      for (const w of WIDGET_IDS) expect((dict.titles as Record<string, string>)[w]?.length, w).toBeGreaterThan(2);
      for (const p of HELP_PHASES) {
        expect(dict.phases[p].label.length, p).toBeGreaterThan(2);
        expect(dict.phases[p].hint.length, p).toBeGreaterThan(8);
      }
    }
  });

  it("«Дальше в дне» links are real tools, 1–2 of them, never the tool itself", () => {
    for (const id of HELP_IDS) {
      const next = HELP[id].next;
      expect(next.length, id).toBeGreaterThanOrEqual(1);
      expect(next.length, id).toBeLessThanOrEqual(2);
      for (const n of next) {
        expect(isHelpId(n), `${id} → ${n}`).toBe(true);
        expect(n, id).not.toBe(id);
        expect(HELP[n].legacy, `${id} → ${n}`).toBeFalsy();
      }
    }
  });
});

describe("who sees which help", () => {
  it("staff tools and senior-only cards stay out of a junior's guide; a closed section is gone with its cards", () => {
    const junior = guideGroups(open).flatMap((g) => g.ids);
    expect(junior).not.toContain("curator");
    expect(junior).not.toContain("juniorCost");
    expect(junior).not.toContain("easyMoney");
    expect(junior).not.toContain("activity"); // legacy page: its «?» works, the guide does not list it
    expect(junior).toContain("riskSignals");
    const senior = guideGroups({ ...open, tier: "senior" }).flatMap((g) => g.ids);
    expect(senior).toContain("easyMoney");
    const staff = guideGroups({ ...open, isCurator: true }).flatMap((g) => g.ids);
    expect(staff).toContain("curator");
    expect(staff).toContain("easyMoney");

    const closed = { ...open, canOpen: (h: string) => h !== "/risk" && h !== "/trainer" };
    const ids = guideGroups(closed).flatMap((g) => g.ids);
    expect(ids).not.toContain("risk");
    expect(ids).not.toContain("leakGuard");
    expect(ids).not.toContain("trainer");
    expect(nextFor("riskSignals", closed)).not.toContain("risk");
    expect(helpVisible("riskSignals", closed)).toBe(true); // the strip lives on the dashboard
  });

  it("the guide follows the day: phases in loop order, each tool in exactly one group", () => {
    const groups = guideGroups({ ...open, isCurator: true });
    expect(groups.map((g) => g.phase)).toEqual([...HELP_PHASES]);
    const all = groups.flatMap((g) => g.ids);
    expect(new Set(all).size).toBe(all.length);
    expect(groups[1]!.ids).toContain("gamePlan");
    expect(groups[2]!.ids).toContain("trades");
    expect(groups[3]!.ids).toContain("journal");
  });

  it("the guide itself can never be closed per stage", () => {
    const hrefs = blockableSections().flatMap((g) => g.sections.map((s) => s.href));
    expect(hrefs).not.toContain("/guide");
  });

  it("search: every word must match, case- and ё-insensitive", () => {
    const text = "Сколько осталось до стопа сегодня — Ёмкость лимита";
    expect(matchesQuery(text, "стоп")).toBe(true);
    expect(matchesQuery(text, "СТОП лимит")).toBe(true);
    expect(matchesQuery(text, "емкость")).toBe(true);
    expect(matchesQuery(text, "стоп неделя")).toBe(false);
    expect(matchesQuery(text, "  ")).toBe(true);
  });
});
