// Quests views, server-rendered from fixtures: the dashboard strip (folded / open, onboarding), the «Квесты и
// достижения» tab (header, scopes, history, achievements with tiers and a secret line), the curator block — RU and UZ.
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { DisciplineSummary } from "@/lib/daily/types";
import { QuestStripView } from "../quest-strip";
import { QuestsProgressView } from "../progress-tab";
import { CuratorQuestsView } from "../curator-panel";
import { CURATOR, me, onboarding, daily, quest } from "./fixtures";
import { typeLabelOf, typeMeta } from "@/components/notifications/model";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;
const discipline: DisciplineSummary = { streak: 4, bestStreak: 7, nextBonus: 4, points30: 120, pointsTotal: 185, windowDays: 30, level: 2, levelFrom: 150, nextLevelAt: 400 };

function render(el: ReturnType<typeof createElement>): string {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SsrRouter, { ssrPath: "/" }, el)));
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, "");
}

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("dashboard quest strip", () => {
  it("folded: «Квесты 1/3» only", () => {
    const html = render(createElement(QuestStripView, { me: me() }));
    expect(html).toContain("Квесты 1/3");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Разобрать прошлый день");
  });

  it("open: today's quests with progress, curator deadline, link to everything", () => {
    const html = render(createElement(QuestStripView, { me: me(), defaultOpen: true }));
    expect(html).toContain("План до открытия");
    expect(html).toContain("Без ошибки из фокуса");
    expect(html).toContain("до 23 окт. · осталось 4 дня");
    expect(html).toContain("куратор: Ольга Н.");
    expect(html).toContain("1 из 3");
    expect(html).toContain('href="/ratings?tab=quests"');
    // Grouped by scope: the curator quest is not listed under «На сегодня».
    expect(html.indexOf("От куратора")).toBeGreaterThan(-1);
    expect(html.indexOf("Без ошибки из фокуса")).toBeLessThan(html.indexOf("На сегодня"));
    // Both active quests lead to «/» — the page the strip is on (the test renders at «/»): no dead «Перейти».
    expect(html).not.toContain("Перейти");
  });

  it("new trader: «Первые шаги 3/7» with the next step and its link", () => {
    const data = me({ quests: [...onboarding, ...daily], summary: { ...me().summary, onboarding: { done: 3, total: 7 } } });
    const folded = render(createElement(QuestStripView, { me: data }));
    expect(folded).toContain("Первые шаги 3/7");
    expect(folded).toContain("Дальше: Первый разбор дня");
    const open = render(createElement(QuestStripView, { me: data, defaultOpen: true }));
    expect(open).toContain('href="/?review=1"');
    expect(open).toContain("Подключить Telegram");
  });

  it("nothing for today and no onboarding → no strip", () => {
    expect(render(createElement(QuestStripView, { me: me({ quests: [] }) }))).toBe("");
  });
});

describe("progress tab", () => {
  it("no «Квесты недели: 0 из 0» when the week offered nothing (UMID-19)", () => {
    const empty = me({ summary: { ...me().summary, weekDone: 0, weekTotal: 0 } });
    expect(render(createElement(QuestsProgressView, { data: empty, discipline }))).not.toContain("Квесты недели");
  });

  it("header (level, points), scopes, collapsed history, achievements", () => {
    const html = render(createElement(QuestsProgressView, { data: me(), discipline }));
    expect(html).toContain("Стабильный");
    expect(html).toContain("185 очк.");
    expect(html).toContain("до «Железный» — 215 очк.");
    expect(html).toContain("Квесты недели: 1 из 3");
    expect(html).toContain("От куратора");
    expect(html).toContain("На неделю");
    expect(html).toContain("+25 очк.");
    expect(html).toContain("Не усредняйся против тренда");
    expect(html).toContain("История · 3 квеста");
    expect(html).not.toContain("Не выполнен");
    expect(html).toContain("Серия контракта");
    expect(html).toContain("Бронза · 9 окт");
    expect(html).toContain("До ступени «Серебро»: 7 из 10");
    expect(html).toContain("???");
    expect(html).not.toContain("Лучше себя");
    expect(html).toContain("Дисциплина");
  });

  it("a deep link to a finished quest opens the history", () => {
    const html = render(createElement(QuestsProgressView, { data: me(), discipline, focus: { quest: 502 } }));
    expect(html).toContain("Не выполнен");
    expect(html).toContain('id="quest-502"');
  });

  it("Uzbek (Latin)", async () => {
    await setLang("uz", { source: "init" });
    const html = render(createElement(QuestsProgressView, { data: me(), discipline }));
    expect(html).toContain("Kuratordan");
    expect(html).toContain("Yutuqlar");
    expect(html).toContain("Bronza");
    expect(html.replace(/Ольга Н\.|Не усредняйся против тренда/g, "")).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe("curator block", () => {
  it("summary, medals, cancel only on active curator quests", () => {
    const task = quest({ id: 601, scope: "curator", template: "curator_task", endsOn: "2026-10-23", assignedBy: CURATOR, note: "Пересмотреть сделки AMD с куратором" });
    const data = me({ quests: [...me().quests, task] });
    const html = render(createElement(CuratorQuestsView, { data, onGive: () => undefined, onCancel: () => undefined, onComplete: () => undefined }));
    expect(html).toContain("Дать квест");
    expect(html).toContain("Достижения: 1 из 3");
    expect(html).toContain("Серия контракта — Бронза · 9 окт");
    expect(html.match(/Отменить квест/g)?.length).toBe(2);
    expect(html.match(/Отметить «Задание куратора» выполненным/g)?.length).toBe(1);
    expect(html).toContain("Пересмотреть сделки AMD с куратором");
  });
});

describe("notification types", () => {
  it("quest and achievement notifications have labels and the review group", () => {
    expect(typeLabelOf("quest_done")).toBe("Квест выполнен");
    expect(typeLabelOf("achievement_earned")).toBe("Новое достижение");
    expect(typeMeta("quest_assigned").group).toBe("review");
    expect(typeMeta("quest_failed").severity).toBe("warn");
  });
});
