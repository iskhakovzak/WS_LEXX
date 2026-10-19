/**
 * Quest / achievement notifications rendered per reader (lib/notificationRenderers/quests.ts through
 * renderNotification): every type in RU / EN / UZ, plurals from the target, the staff variants, an unknown template
 * falls back (null).
 */
import { describe, expect, it } from "vitest";
import { renderNotification } from "../notificationText";
import { notificationTypes } from "../notificationCore";

describe("quest notifications", () => {
  it("quest_done for the trader and the assigner", () => {
    expect(renderNotification("quest_done", { template: "contract_days", target: 4, points: 10, scope: "weekly" }, "ru"))
      .toMatchObject({ title: "Квест выполнен: Соблюди контракт 4 дня", body: "+10 к дисциплине. Все квесты — во вкладке «Квесты и достижения»." });
    expect(renderNotification("quest_done", { template: "review_days", target: 5, variant: "staff", trader: "Кирилл Б.", statusCode: "done" }, "ru")!.title)
      .toBe("Кирилл Б.: квест выполнен — Разбери вовремя 5 торговых дней");
    expect(renderNotification("quest_done", { template: "plan_before_open", target: 1, points: 0 }, "en")!.body).toBe("All quests are on the “Quests and achievements” tab.");
  });

  it("quest_failed for the assigner: failed vs expired", () => {
    const r = renderNotification("quest_failed", { template: "replay_own_days", target: 2, variant: "staff", trader: "Кирилл Б.", statusCode: "expired" }, "uz")!;
    expect(r.title).toContain("kvest bajarilmadi");
    expect(r.body).toBe("Muddat tugadi, maqsadga erishilmadi.");
  });

  it("quest_assigned with the deadline in the reader's language and the note", () => {
    const r = renderNotification("quest_assigned", { template: "review_days", target: 3, points: 15, curator: "Ольга Н.", endsDate: "2026-10-30", note: "Разбери AMD" }, "ru")!;
    expect(r.title).toBe("Задание от куратора: Разбери вовремя 3 торговых дня");
    expect(r.body).toMatch(/^Ольга Н\. · до 30 окт\.? · \+15 к дисциплине\n«Разбери AMD»$/);
    // The manual task: its note is the title.
    const manual = renderNotification("quest_assigned", { template: "curator_task", target: 1, points: 10, curator: "Ольга Н.", endsDate: "2026-10-23", note: "Разбери AMD" }, "ru")!;
    expect(manual.title).toBe("Задание от куратора: Разбери AMD");
    expect(manual.body).toMatch(/^Ольга Н\. · до 23 окт\.? · \+10 к дисциплине$/);
  });

  it("quest_cancelled for the trader", () => {
    const r = renderNotification("quest_cancelled", { template: "review_days", target: 3, curator: "Ольга Н.", questId: 11 }, "en")!;
    expect(r.title).toMatch(/^Quest cancelled: /);
    expect(r.body).toContain("Ольга Н.");
    expect(renderNotification("quest_cancelled", { template: "curator_task", target: 1, curator: "Ольга Н.", note: "Разбери AMD" }, "ru")!.title).toBe("Квест отменён: Разбери AMD");
    expect(renderNotification("quest_cancelled", { template: "review_days", target: 3 }, "ru")).toBeNull();
  });

  it("achievement_earned", () => {
    expect(renderNotification("achievement_earned", { line: "focus_beaten", tier: "silver", target: 10 }, "en")!.title).toBe("Achievement: Mistake beaten — silver");
    expect(renderNotification("achievement_earned", { line: "nope", tier: "silver" }, "en")).toBeNull();
    expect(renderNotification("quest_done", { template: "nope", target: 1 }, "ru")).toBeNull();
  });

  it("types are registered with labels in every language", () => {
    for (const lang of ["ru", "en", "uz"] as const) {
      const types = notificationTypes(lang).filter((t) => t.type.startsWith("quest_") || t.type === "achievement_earned");
      expect(types.map((t) => t.type)).toEqual(["quest_assigned", "quest_done", "quest_failed", "quest_cancelled", "achievement_earned"]);
      expect(types.every((t) => t.label !== t.type && t.description && t.group === "review")).toBe(true);
    }
  });
});
