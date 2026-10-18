// Pure gamification helpers: titles, ranking names, season bar text, reward rows order, season rows, the admin draft.
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { masteryLevelName, masteryPct, rankingName, seasonBarText, seasonMonth, titleLabel } from "@/components/shared/gamification-labels";
import { normalizeNotification } from "@/components/notifications/model";
import { bodyOf, conditionText, draftOf, rewardRows, seasonRows } from "../model";
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
    expect(rankingName("t4", false)).toBe("Трейдер 4");
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

  it("condition texts", () => {
    expect(conditionText(items[0].condition)).toBe("Достижение «Серия контракта» — Золото");
    expect(conditionText({ kind: "achievement", ref: "reviews_total", tier: null })).toBe("Достижение «Разобранные дни»");
    expect(conditionText(items[2].condition)).toBe("Уровень «Железный»");
    expect(conditionText(items[1].condition)).toBe("Место в сезоне не ниже 3-го");
  });

  it("season rows: own row only when outside the top", () => {
    expect(seasonRows(season()).own).toMatchObject({ me: true, rank: 7, points: 84 });
    expect(seasonRows(season({ top: [{ label: "t1", me: true, points: 90, title: null }], myRank: 1 })).own).toBeNull();
  });

  it("admin draft ↔ body with the agreed refs", () => {
    expect(bodyOf(draftOf(items[0]))).toEqual({ ok: true, body: { title: "Обед с руководителем", description: "Раз в месяц", active: true, stock: 3, condition: { kind: "achievement", ref: "contract_streak", tier: "gold", rank: null } } });
    expect(bodyOf(draftOf(items[1]))).toMatchObject({ ok: true, body: { stock: null, condition: { kind: "season_rank", ref: "season", rank: 3, tier: null } } });
    expect(bodyOf(draftOf(items[4]))).toMatchObject({ ok: true, body: { condition: { kind: "mastery", ref: "", tier: "2" } } });
    expect(bodyOf({ ...draftOf(null), title: "  " })).toEqual({ ok: false, problem: "titleRequired" });
    expect(bodyOf({ ...draftOf(null), title: "X", ref: "" })).toEqual({ ok: false, problem: "refRequired" });
    expect(bodyOf({ ...draftOf(null), title: "X", kind: "level", ref: "0" })).toMatchObject({ ok: true, body: { condition: { kind: "level", ref: "0" } } });
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
