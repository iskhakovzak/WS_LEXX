// Gamification views server-rendered from fixtures: the season ranking (aliases, own place after a gap, titles), the
// curator league (own team highlighted, members' contributions), the quests-tab header (season bar, freeze, title)
// and extras (mastery, rewards catalog), the admin catalog list, the curator reward queue, the shared MasteryChip and
// the recognition item in the desk feed. RU, EN and UZ (no Cyrillic in UZ).
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { MasteryChip } from "@/components/shared/mastery-chip";
import { StreamRow, StreamGroup } from "@/components/feed/StreamCard";
import type { StreamItem } from "@/components/feed/stream-api";
import { SeasonTabView } from "../season-tab";
import { QuestsExtrasView, QuestsHeaderView } from "../quests-blocks";
import { RewardItemsList } from "../reward-editor";
import { RewardQueueItems } from "../reward-queue";
import { gamificationKeys } from "../api";
import { gami, items, league, season } from "./fixtures";

const SsrRouter = Router as ComponentType<{ ssrPath: string; children?: ReactNode }>;

function render(el: ReturnType<typeof createElement>, client = new QueryClient()): string {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(SsrRouter, { ssrPath: "/ratings" }, el)));
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/<!-- -->/g, "");
}

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("season tab", () => {
  it("top with aliases and titles, own place after a gap, season bar", () => {
    const html = render(createElement(SeasonTabView, { season: season(), league: null }));
    expect(html).toContain("Сезон октября");
    expect(html).toContain("Сезон октября: 84 очка · 7-е место · 12 дней до конца");
    expect(html).toContain("Трейдер 3");
    expect(html).toContain("Трейдер 11");
    expect(html).toContain("Железный");
    expect(html).toContain("Снайпер 1.3");
    expect(html).toContain("160 очков");
    expect(html).toContain("…");
    expect(html).toContain(">я<");
    expect(html).toContain("из 31 участника");
    // never the real names of other traders
    expect(html).not.toContain("Кирилл");
  });

  it("the viewer inside the top is highlighted in place, no gap row", () => {
    const s = season({ myRank: 2, top: [{ label: "t3", me: false, points: 160, title: null }, { label: "t9", me: true, points: 150, title: "iron" }] });
    const html = render(createElement(SeasonTabView, { season: s, league: null }));
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("…");
    expect(html).not.toContain("Трейдер 9");
  });

  it("league: teams by rank, own team highlighted, curator sees members", () => {
    const html = render(createElement(SeasonTabView, {
      season: null,
      league: league({ members: [{ trader: "Кирилл Б.", points: 84, title: "iron" }, { trader: "Тимур А.", points: 120, title: null }] }),
    }));
    expect(html).toContain("Лига кураторов");
    expect(html.indexOf("Артур")).toBeLessThan(html.indexOf("Ольга"));
    expect(html).toContain("ваша команда");
    expect(html).toContain("72.3 в среднем");
    expect(html).toContain("5 учеников");
    expect(html).toContain("Вклад учеников");
    expect(html.indexOf("Тимур")).toBeLessThan(html.indexOf("Кирилл"));
  });

  it("staff: ranking with names, no own season line; members even before teams are scored", () => {
    const s = season({ myRank: null, myPoints: 0, top: [{ label: "Кирилл Б.", me: false, points: 96, title: "risk_keeper" }] });
    const html = render(createElement(SeasonTabView, { season: s, league: league({ teams: [], members: [{ trader: "Кирилл Б.", points: 96, title: null }] }), participant: false }));
    expect(html).toContain("Кирилл Б.");
    expect(html).toContain("Хранитель риска");
    expect(html).not.toContain("Сезон октября: 0 очков");
    expect(html).not.toContain("В этом месяце очков ещё нет");
    expect(html).toContain("Команды появятся в рейтинге");
    expect(html).toContain("Вклад учеников");
  });

  it("a trader sees teams only (no members)", () => {
    const html = render(createElement(SeasonTabView, { season: null, league: league() }));
    expect(html).not.toContain("Вклад учеников");
  });

  it("English: ordinal-free place, plural points", async () => {
    await setLang("en", { source: "init" });
    const html = render(createElement(SeasonTabView, { season: season(), league: league() }));
    expect(html).toContain("October season: 84 points · place #7 · 12 days left");
    expect(html).toContain("Trader 3");
    expect(html).toContain("Curator league");
  });

  it("Uzbek (Latin)", async () => {
    await setLang("uz", { source: "init" });
    const html = render(createElement(SeasonTabView, { season: season(), league: league() }));
    expect(html).toContain("Oktabr mavsumi");
    expect(html).toContain("Treyder 3");
    expect(html).toContain("Temir");
    expect(html.replace(/(Ольга|Артур)[^<]*/g, "")).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe("quests tab blocks", () => {
  it("header: season bar links to the ranking, freeze, title picker", () => {
    const html = render(createElement(QuestsHeaderView, { me: gami() }));
    expect(html).toContain('href="/ratings?tab=season"');
    expect(html).toContain("Заморозка серии: 1 из 2 в этом месяце");
    expect(html).toContain("Серию сохранила заморозка: 14 окт");
    expect(html).toContain("Звание рядом с именем");
    expect(html).toContain("Звания дают золотые");
  });

  it("no titles yet: a hint instead of an empty picker", () => {
    const html = render(createElement(QuestsHeaderView, { me: gami({ titles: [], activeTitle: null }) }));
    expect(html).toContain("Званий пока нет");
  });

  it("mastery: highest first, chip with progress; rewards: eligible first with «Запросить»", () => {
    const html = render(createElement(QuestsExtrasView, { me: gami() }));
    expect(html).toContain("Мастерство сетапов");
    expect(html.indexOf("VWAP Hold")).toBeLessThan(html.indexOf("ORB"));
    expect(html).toContain("Практик · 3/5");
    expect(html).toContain("Мастер");
    expect(html).toContain("A-сделок: 6 · упражнений: 4");
    expect(html).toContain("Награды");
    expect(html).toContain("Запросить");
    expect(html).toContain("Достижение «Серия контракта» — Золото");
    expect(html).toContain("запрошено 16 окт");
    expect(html).toContain("вручено 30 сент");
    expect(html).toContain("Место в сезоне не ниже 3-го");
    expect(html).toContain("Условие ещё не выполнено");
    expect(html).toContain("закончились");
    expect(html).toContain("Мастерство «Практик» по любому сетапу");
    // eligible first, granted (history) after the locked ones
    expect(html.indexOf("Обед с руководителем")).toBeLessThan(html.indexOf("Книга"));
    expect(html.indexOf("Мерч деска")).toBeLessThan(html.indexOf("Старый приз"));
  });

  it("an inactive item without history is hidden from traders", () => {
    const me = gami({ rewards: { eligible: [], requested: [], granted: [], catalog: items } });
    expect(render(createElement(QuestsExtrasView, { me }))).not.toContain("Старый приз");
  });
});

describe("admin catalog + curator queue", () => {
  it("catalog list: condition, stock, inactive mark, edit", () => {
    const html = render(createElement(RewardItemsList, { items, onEdit: () => {} }));
    expect(html).toContain("Обед с руководителем");
    expect(html).toContain("осталось 3");
    expect(html).toContain("без ограничения");
    expect(html).toContain("неактивна");
    expect(html).toContain("Уровень «Железный»");
    expect(html).toContain("Мастерство «Мастер» по сетапу 1.3");
    expect(html).toContain("Изменить");
  });

  it("queue: who asks for what, grant / decline", () => {
    const client = new QueryClient();
    client.setQueryData(gamificationKeys.queue(), [
      { id: 11, itemId: 5, trader: "Кирилл Б.", status: "requested", at: "2026-10-16", by: null, title: "Книга" },
      { id: 12, itemId: 1, trader: "Тимур А.", status: "granted", at: "2026-10-10", by: "Ольга Н.", title: "Обед" },
    ]);
    const html = render(createElement(RewardQueueItems, { onOpenTrader: () => {} }), client);
    expect(html).toContain("просит награду «Книга»");
    expect(html).toContain("Вручить");
    expect(html).toContain("Отклонить");
    expect(html).not.toContain("Обед");
  });

  it("empty queue renders nothing (no new list)", () => {
    const client = new QueryClient();
    client.setQueryData(gamificationKeys.queue(), []);
    expect(render(createElement(RewardQueueItems, { onOpenTrader: () => {} }), client)).toBe("");
  });
});

describe("shared MasteryChip", () => {
  it("level + progress, top level, level only", () => {
    expect(render(createElement(MasteryChip, { level: 2, progress: { current: 3, next: 5 } }))).toContain("Практик · 3/5");
    const top = render(createElement(MasteryChip, { level: 4, progress: { current: 12, next: null } }));
    expect(top).toContain("Мастер");
    expect(top).toContain("высший уровень");
    expect(render(createElement(MasteryChip, { level: 1, size: "xs" }))).toContain("Ученик");
  });

  it("English and Uzbek", async () => {
    await setLang("en", { source: "init" });
    expect(render(createElement(MasteryChip, { level: 3, progress: { current: 1, next: 4 } }))).toContain("Expert · 1/4");
    await setLang("uz", { source: "init" });
    const uz = render(createElement(MasteryChip, { level: 3, progress: { current: 1, next: 4 } }));
    expect(uz).toContain("Ekspert");
    expect(uz).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe("recognition in the desk feed", () => {
  const item = (over: Partial<StreamItem> = {}): StreamItem => ({
    id: "rec:1", kind: "recognition", cats: ["desk", "achievement"], date: "2026-10-16", at: "2026-10-16T20:05:00Z",
    trader: "Кирилл Б.", actor: null, title: "Кирилл Б.: «Серия контракта» — золото", subtitle: "Звание «Железный»", tone: "accent",
    value: null, valueFmt: null, ticker: null, href: null, group: null, visibility: "public", ...over,
  });

  it("one item: who / what / when", () => {
    const html = render(createElement(StreamRow, { item: item(), baseline: null }));
    expect(html).toContain("Кирилл Б.: «Серия контракта» — золото");
    expect(html).toContain("Звание «Железный»");
    expect(html).toMatch(/\d{1,2}:\d{2}/);
  });

  it("several the same day collapse into «N признания деска»; hidden names stay out", () => {
    const html = render(createElement(StreamGroup, {
      group: "recognition:2026-10-16",
      items: [item(), item({ id: "rec:2", trader: null, title: "Трейдер 4: серия 10 дней" }), item({ id: "rec:3", trader: "Тимур А." })],
      baseline: null,
    }));
    expect(html).toContain("3 признания деска");
    expect(html).toContain("Кирилл Б., Тимур А.");
  });
});
