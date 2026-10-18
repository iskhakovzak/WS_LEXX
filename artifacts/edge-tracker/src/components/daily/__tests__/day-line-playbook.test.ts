// The playbook bits of the day line: «Сегодня торгую» chips in the morning, the quiet link when nothing is picked, and
// the evening «Разметь N сделок» step (the card's own count wins over the playbook's).
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { i18nReady, setLang } from "@/i18n";
import type { DailyMe } from "@/lib/daily/types";
import { DayLineView } from "../day-line";
import { dayPlaybook, type DayPlaybook } from "../daily-model";
import { today } from "@/components/playbook/today/__tests__/fixtures";
import { eveningBroken, me } from "./fixtures";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;

function render(data: DailyMe, playbook: DayPlaybook | null): string {
  const qc = new QueryClient();
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(SsrRouter, { ssrPath: "/" }, createElement(DayLineView, { me: data, plan: null, playbook }))),
  ).replace(/&amp;/g, "&");
}

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("dayPlaybook", () => {
  it("names the picks and keeps only known ids", () => {
    const pb = dayPlaybook(today({ picks: [13, 999, 21] }));
    expect(pb?.picks).toEqual([{ id: 13, name: "1.3 ORB" }, { id: 21, name: "2.1 VWAP Hold" }]);
    expect(pb?.untagged).toBe(3);
    expect(dayPlaybook(null)).toBeNull();
  });
});

describe("day line", () => {
  it("morning: today's picks as chips under the contract", () => {
    const html = render(me({ evening: { ...eveningBroken, reviewed: true } }), dayPlaybook(today({ picks: [13, 21] })));
    expect(html).toContain("Сегодня торгую:");
    expect(html).toContain("1.3 ORB");
    expect(html).toContain("2.1 VWAP Hold");
  });
  it("nothing picked → one quiet link to the playbook", () => {
    const html = render(me({ evening: { ...eveningBroken, reviewed: true } }), dayPlaybook(today()));
    expect(html).toContain('href="/playbook"');
    expect(html).toContain("Выбрать в плейбуке");
  });
  it("evening: «Разметь N сделок» from the card's count; none when everything is tagged", async () => {
    const evening = me({ phase: "afterclose", evening: { ...eveningBroken, untagged: 5 } });
    expect(render(evening, dayPlaybook(today()))).toContain("Разметь 5 сделок");
    expect(render(me({ phase: "afterclose", evening: { ...eveningBroken, untagged: 0 } }), dayPlaybook(today()))).not.toContain("Разметь");
    await setLang("uz", { source: "init" });
    await i18nReady();
    expect(render(evening, null)).toContain("5 ta bitimni belgilang");
  });
});
