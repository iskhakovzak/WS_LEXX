// Pure gamification helpers: titles, ranking names, season bar text, reward rows order, season rows, the admin draft.
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { masteryLevelName, masteryPct, rankingName, seasonBarText, seasonMonth, titleLabel } from "@/components/shared/gamification-labels";
import { normalizeNotification } from "@/components/notifications/model";
import { bodyOf, conditionText, draftOf, rewardRows, seasonRows, stockOf, tierHint, tierOption, withActive } from "../model";
import { showLeague } from "../season-tab";
import { gami, items, season } from "./fixtures";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("labels", () => {
  it("titles: known keys, sniper with the setup, unknown → null", () => {
    expect(titleLabel("iron")).toBe("Железный");
    expect(titleLabel("self_beater")).toBe("Обыграл себя");
    expect(titleLabel("sniper:1.3")).toBe("Снайпер 1.3");
    expect(titleLabel("nope")).toBeNull();
    expect(titleLabel(null)).toBeNull();
  });

  it("ranking names: me, alias, stored name", () => {
    expect(rankingName("t4", true)).toBe("я");
    expect(rankingName("t4", false)).toBe("Участник 4");
    expect(rankingName("Ольга Н.", false)).toContain("Ольга");
  });

  it("season bar: with and without a place, last day", () => {
    expect(seasonBarText(season())).toBe("Сезон октября: 84 очка · 7-е место · 12 дней до конца");
    expect(seasonBarText(season({ myRank: null, myPoints: 1, endsInDays: 1 }))).toBe("Сезон октября: 1 очко · 1 день до конца");
    expect(seasonBarText(season({ endsInDays: 0, myPoints: 5, myRank: 1 }))).toBe("Сезон октября: 5 очков · 1-е место · последний день");
    expect(seasonMonth("2026-01")).toBe("января");
  });

  it("mastery names and progress", () => {
    expect(masteryLevelName(0)).toBe("Новичок");
    expect(masteryLevelName(9)).toBe("9");
    expect(masteryPct({ progress: { current: 3, next: 5 } })).toBe(60);
    expect(masteryPct({ progress: { current: 3, next: null } })).toBe(100);
  });

  it("English titles", async () => {
    await setLang("en", { source: "init" });
    expect(titleLabel("risk_keeper")).toBe("Risk keeper");
    expect(seasonBarText(season())).toBe("October season: 84 points · place #7 · 12 days left");
  });
});

describe("rewards", () => {
  it("rows: eligible, requested, locked, granted; inactive without history hidden", () => {
    const rows = rewardRows(gami().rewards);
    expect(rows.map((r) => [r.item.id, r.state])).toEqual([[1, "eligible"], [5, "requested"], [3, "locked"], [2, "locked"], [4, "granted"]]);
  });

  it("an inactive item never offers «Запросить»: a stale eligibility is hidden, history stays (ILYA-17)", () => {
    const r = gami().rewards;
    const off = { ...items[0], id: 77, active: false };
    const rows = rewardRows({
      ...r, catalog: [...r.catalog, off, { ...off, id: 78 }],
      eligible: [...r.eligible, { id: 501, itemId: 77, trader: "Илья Ш.", status: "eligible", at: "2026-10-18T17:50:00Z", by: null }],
      granted: [...r.granted, { id: 502, itemId: 78, trader: "Илья Ш.", status: "granted", at: "2026-10-01T10:00:00Z", by: "Ольга Н." }],
    });
    expect(rows.some((x) => x.item.id === 77)).toBe(false);
    expect(rows.find((x) => x.item.id === 78)?.state).toBe("granted");
  });

  it("condition texts", () => {
    expect(conditionText(items[0].condition)).toBe("Достижение «Серия контракта» — Золото");
    expect(conditionText({ kind: "achievement", ref: "reviews_total", tier: null })).toBe("Достижение «Разобранные дни»");
    expect(conditionText(items[2].condition)).toBe("Уровень «Железный»");
    expect(conditionText(items[1].condition)).toBe("Топ-3 сезона");
  });

  it("season rows: own row only when outside the top", () => {
    expect(seasonRows(season()).own).toMatchObject({ me: true, rank: 7, points: 84 });
    expect(seasonRows(season({ top: [{ label: "t1", me: true, points: 90, title: null }], myRank: 1 })).own).toBeNull();
  });

  it("season below 5 ranked participants (2.14): the own row without a place, no gap row", () => {
    const r = seasonRows(season({ top: [{ label: "t1", me: true, points: 10, title: null }], myRank: null, rankHidden: true }));
    expect(r.rows).toEqual([{ label: "t1", me: true, points: 10, title: null, rank: 0 }]);
    expect(r.own).toBeNull();
  });

  it("admin draft ↔ body with the agreed refs", () => {
    expect(bodyOf(draftOf(items[0]))).toEqual({ ok: true, body: { title: "Обед с руководителем", description: "Раз в месяц", active: true, stock: 3, condition: { kind: "achievement", ref: "contract_streak", tier: "gold", rank: null } } });
    expect(bodyOf(draftOf(items[1]))).toMatchObject({ ok: true, body: { stock: null, condition: { kind: "season_rank", ref: "season", rank: 3, tier: null } } });
    expect(bodyOf(draftOf(items[4]))).toMatchObject({ ok: true, body: { condition: { kind: "mastery", ref: "", tier: "2" } } });
    expect(bodyOf({ ...draftOf(null), title: "  " })).toEqual({ ok: false, problem: "titleRequired" });
    expect(bodyOf({ ...draftOf(null), title: "X", ref: "" })).toEqual({ ok: false, problem: "refRequired" });
    expect(bodyOf({ ...draftOf(null), title: "X", kind: "level", ref: "0" })).toMatchObject({ ok: true, body: { condition: { kind: "level", ref: "0" } } });
  });

  it("editor (OWNER-19): a new reward starts off; stock is empty or ≥ 1 — never silently 0; tier with its target", () => {
    expect(draftOf(null).active).toBe(false);
    expect(stockOf("")).toEqual({ ok: true, stock: null });
    expect(stockOf("5")).toEqual({ ok: true, stock: 5 });
    expect(stockOf("-3")).toEqual({ ok: false });
    expect(stockOf("0")).toEqual({ ok: false });
    expect(stockOf("1.5")).toEqual({ ok: false });
    expect(stockOf("0", 0)).toEqual({ ok: true, stock: 0 }); // an item that ran out may be saved unchanged
    expect(bodyOf({ ...draftOf(items[0]), stock: "-3" })).toEqual({ ok: false, problem: "stockInvalid" });
    expect(tierOption("silver", 10)).toBe("Серебро — 10");
    expect(tierOption("silver", undefined)).toBe("Серебро");
    expect(tierHint("contract_streak", 10)).toBe("Соблюдайте контракт 10 дней подряд");
    expect(withActive(items[0], false)).toMatchObject({ title: "Обед с руководителем", active: false });
    expect("id" in withActive(items[0], false)).toBe(false);
  });

  it("the league shows only as a competition (OLGA-15) or to a curator with members", () => {
    const team = { curator: "Ольга Н.", members: 10, score: 4, rank: 1, mine: true };
    expect(showLeague({ season: "2026-10", teams: [team] })).toBe(false);
    expect(showLeague({ season: "2026-10", teams: [] })).toBe(false);
    expect(showLeague({ season: "2026-10", teams: [team, { ...team, curator: "Сергей", mine: false }] })).toBe(true);
    expect(showLeague({ season: "2026-10", teams: [], members: [{ trader: "Кирилл Б.", points: 3, title: null }] })).toBe(true);
  });
});

describe("reward notifications", () => {
  it("reward_requested goes to the curator queue even with an old trader link", () => {
    const n = normalizeNotification({ id: 1, type: "reward_requested", link: "/ratings?tab=quests&rewards=1", body: "x", createdAt: "2026-10-16T10:00:00Z" });
    expect(n?.link).toBe("/curator?rewards=1");
    expect(n?.typeLabel).toBe("Запрос награды");
    const g = normalizeNotification({ id: 2, type: "reward_granted", link: "/ratings?tab=quests&rewards=1", body: "x", createdAt: "2026-10-16T10:00:00Z" });
    expect(g?.link).toBe("/ratings?tab=quests&rewards=1");
  });
});
