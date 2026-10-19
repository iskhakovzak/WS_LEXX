// Component tests of «Сегодня»: server-render the pieces from fixtures (node env, no DOM) and check what the trader
// sees — every schematic picture, the cheat sheet (four lines, grade rules, size calculator, lock note), the window
// list (edge chips, locks with the unlock condition, stars), the picks panel and the day map; RU and UZ.
import { createElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { i18nReady, setLang } from "@/i18n";
import { SCHEMA_KEYS, SetupSchema } from "../schema-art";
import { CheatCard } from "../cheat-card";
import { DayMap } from "../day-map";
import { PlanToday } from "../plan-today";
import { WindowList, EdgeSummaryPanel } from "../today-landing";
import { today } from "./fixtures";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;

function render(el: ReactElement): string {
  const qc = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(SsrRouter, { ssrPath: "/playbook" }, el)))
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("schematic pictures", () => {
  it("every schema key draws an accessible SVG with marks; unknown keys draw nothing", () => {
    expect(SCHEMA_KEYS).toHaveLength(16);
    for (const key of SCHEMA_KEYS) {
      const html = render(createElement(SetupSchema, { schema: key }));
      expect(html, key).toContain(`data-schema="${key}"`);
      expect(html, key).toMatch(/<(path|rect|line)\b/);
      expect(html, key).toContain('role="img"');
      expect(html, key).toMatch(/aria-label="Схема: [^"]+"/);
      expect(html, key).not.toMatch(/#[0-9a-f]{3,6}\b/i); // theme tokens only
    }
    expect(render(createElement(SetupSchema, { schema: "nope" }))).toBe("");
    expect(render(createElement(SetupSchema, { schema: "orb", title: "" }))).toContain('aria-hidden="true"');
  });
});

describe("cheat sheet", () => {
  const t = today();
  const orb = t.setups.find((s) => s.id === 13)!;
  it("one screen: picture, name + window, four lines, grade-A bullets, checklist, 1R from the plan", () => {
    const html = render(createElement(CheatCard, { setup: orb, oneR: t.oneR, date: t.date, canPick: true, picked: false, onTogglePick: () => {} }));
    expect(html).toContain('data-schema="orb"');
    expect(html).toContain("1.3 ORB");
    expect(html).toContain("Открытие · 09:35–10:30 NY");
    expect(html).toContain("твой лучший: 23 сделки, +0.42R");
    for (const label of ["Вход", "Стоп", "Цель", "Отмена", "Грейд A, если", "Чек-лист — отмечай по ходу", "Размер позиции"]) expect(html).toContain(label);
    expect(html).toContain("Пробой high диапазона 5 минут");
    expect(html).toContain('role="checkbox"');
    expect(html).toContain("1R = $50");
    expect(html).toContain("из личного плана");
    expect(html).toContain("На сегодня");
    // Nothing ticked yet → no grade at all (ILYA-27: grade C only after ticks).
    expect(html).not.toContain("Грейд C");
    expect(html).not.toMatch(/truncate|line-clamp/);
  });
  it("no 1R → a hint pointing to the plan's risk per trade, with the plan link of the day", () => {
    const html = render(createElement(CheatCard, { setup: orb, oneR: null, date: t.date }));
    expect(html).toContain("1R не задан");
    expect(html).toContain("/game-plan?view=my&date=2026-10-19");
  });
  it("a locked setup says how it unlocks and offers no star", () => {
    const gap = t.setups.find((s) => s.id === 11)!;
    const html = render(createElement(CheatCard, { setup: gap, oneR: t.oneR, date: t.date, canPick: true, onTogglePick: () => {} }));
    expect(html).toContain("Закрыт");
    expect(html).toContain("откроется после 10 сделок по 1.3 с грейдом A (сейчас 4) или на уровне «Джун»");
    expect(html).not.toContain("На сегодня");
    // ILYA-27 / DEV-06: no rules, no live checklist, no size calculator for a setup one may not trade yet.
    for (const label of ["Вход", "Чек-лист — отмечай по ходу", "Размер позиции", 'role="checkbox"']) expect(html).not.toContain(label);
  });
  it("UZ (Latin)", async () => {
    await setLang("uz", { source: "init" });
    await i18nReady();
    const html = render(createElement(CheatCard, { setup: orb, oneR: t.oneR, date: t.date }));
    expect(html).toContain("Kirish");
    expect(html).toContain("A baho, agar");
    expect(html).not.toContain("Baho C");
    expect(html).not.toContain("Чек-лист — отмечай");
    expect(html).not.toContain("Размер позиции");
  });
});

describe("landing", () => {
  const t = today();
  it("windows: edge chips, locked rows with the unlock condition, stars for unlocked setups only", () => {
    const html = render(createElement(WindowList, { today: t, now: 525, draft: [13], canPick: true, onOpen: () => {}, onTogglePick: () => {} }));
    expect(html).toContain("Премаркет");
    expect(html).toContain("Тренд дня");
    expect(html).toContain("На это окно сетапов нет"); // close has none
    expect(html).toContain("осторожно: −0.10R");
    expect(html).toContain("откроется на уровне «Трейдер»");
    expect(html).toContain('aria-pressed="true"'); // 1.3 is picked
    expect(html).toContain("Убрать «1.3 ORB» из сегодняшних");
    expect(html).not.toContain("Взять «1.1 Gap & Go» на сегодня");
    expect(html).toContain(">дальше<"); // the open is next in the morning
    expect(html).not.toMatch(/truncate|line-clamp/); // names and lines wrap
  });
  it("my plan, nothing saved: the suggestion pre-selected and one «Взять в план»", () => {
    const html = render(createElement(PlanToday, { today: t, saved: [], draft: [13, 12], suggestion: [13, 12], saving: false, onToggle: () => {}, onTake: () => {} }));
    expect(html).toContain("Мой план на сегодня");
    expect(html).toContain("Дневной стоп");
    expect(html).toContain("1R");
    expect(html).toContain("$50 · из личного плана");
    expect(html).toContain("Изменить план");
    expect(html).toContain("/game-plan?view=my&date=2026-10-19");
    expect(html).toContain("Выбери сетапы на сегодня");
    expect(html).toContain("Взять в план · 2 сетапа");
    expect(html).toContain("Отмечены сетапы, где у тебя плюс по статистике, и стартовые"); // 13 best + 12 new (ILYA-15)
    expect(html.match(/aria-checked="true"/g)?.length).toBe(2);
    expect(html).not.toContain('data-setup-id="13"'); // no full card before the plan is taken
  });
  it("my plan, saved: every pick is a full cheat sheet (rules, checklist, size) — no chips, nothing clipped", () => {
    const html = render(createElement(PlanToday, { today: today({ picks: [13, 21] }), saved: [13, 21], draft: [], suggestion: [], saving: false, onToggle: () => {}, onTake: () => {} }));
    expect(html).toContain('data-setup-id="13"');
    expect(html).toContain('data-setup-id="21"');
    expect(html).toContain("2 из 3");
    expect(html).toContain("Под low диапазона");
    expect(html).toContain("Размер позиции");
    expect(html).toContain("В сегодняшних");
    expect(html).not.toContain("Выбери сетапы на сегодня");
    expect(html).not.toMatch(/truncate|line-clamp/);
  });
  it("UZ: the plan strip and the prompt", async () => {
    await setLang("uz", { source: "init" });
    await i18nReady();
    const html = render(createElement(PlanToday, { today: t, saved: [], draft: [13], suggestion: [13], saving: false, onToggle: () => {}, onTake: () => {} }));
    expect(html).toContain("Bugungi rejam");
    expect(html).toContain("Kunlik stop");
    expect(html).toContain("Rejaga olish · 1 ta setap");
    expect(html).not.toContain("Мой план");
  });
  it("edge summary and the day map", () => {
    const edge = render(createElement(EdgeSummaryPanel, { setups: t.setups, onOpen: () => {} }));
    expect(edge).toContain("Где у тебя преимущество");
    expect(edge).toContain("1.3 ORB");
    expect(edge).toContain("1.5 Первый откат");
    const map = render(createElement(DayMap, { windows: t.windows, now: 525 }));
    expect(map).toContain("До открытия 45 минут");
    expect(render(createElement(DayMap, { windows: t.windows, now: 17 * 60 }))).toContain("Рынок закрыт · 17:00 NY");
    // ROMAN-10: a weekend shows the next session, every window ahead.
    const weekend = render(createElement(DayMap, { windows: t.windows, now: 0, nextSession: "2026-10-19" }));
    expect(weekend).toContain("Следующая сессия");
    expect(weekend).not.toContain("прошло");
  });
});
