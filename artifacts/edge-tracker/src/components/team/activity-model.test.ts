import { describe as suite, expect, it } from "vitest";
import { describe, describeBurst, itemHref, type FeedItem } from "./activity-model";

const item = (p: Partial<FeedItem>): FeedItem => ({
  uid: "log:1", action: "created", section: "trades", entityId: null, entityTitle: null, trader: "Ольга Н.", details: null, rating: null,
  createdAt: "2026-10-17T12:00:00.000Z", ...p,
});

// The feed doesn't know anyone's gender: no phrase may conjugate a past-tense verb by the actor («оставил», «закрыла»).
const ACTOR_VERB = /(^|\s)(добавил|обновил|удалил|оставил|закрыл|разобрал|оценил|отправил|открыл|написал|прочитал|подтвердил|утвердил|отклонил|пересдал|синхронизировал|сверил|нарушил|приблизился|отреагировал|прокомментировал|перевёл|переоткрыл|опубликовал|поставил|убрал|изменил)а?(\s|$)/;

suite("activity phrases are gender-neutral", () => {
  const actions = ["created", "updated", "deleted", "published", "converted", "resubmitted", "acknowledged", "rated", "synced", "reconciled",
    "conflict", "closed", "reopened", "reviewed", "approved", "rejected", "violation", "halted", "limit_warning", "liked", "reacted", "commented"];
  const sections = ["trades", "trade-ideas", "playbook", "discussions", "eod", "journal", "risk", "game-plan", "ratings", "sync", "scaling", "weekly-review", "watchlist"];

  it("single items", () => {
    for (const action of actions) for (const section of sections) {
      expect(describe(item({ action, section })), `${action}/${section}`).not.toMatch(ACTOR_VERB);
    }
  });

  it("bursts", () => {
    for (const action of actions) for (const section of sections) {
      expect(describeBurst(action, section, 5), `${action}/${section}`).not.toMatch(ACTOR_VERB);
    }
  });

  it("participles agree with the noun", () => {
    expect(describe(item({ action: "created", section: "trades" }))).toBe("добавлена сделка");
    expect(describe(item({ action: "created", section: "playbook" }))).toBe("добавлен сетап");
    expect(describe(item({ action: "deleted", section: "events" }))).toBe("удалено событие");
    expect(describe(item({ action: "closed", section: "eod" }))).toBe("закрыт торговый день");
    expect(describe(item({ action: "reviewed", section: "eod" }))).toBe("разобран торговый день");
    expect(describeBurst("created", "trades", 12)).toBe("добавлено: 12 сделок");
  });
});

suite("eod links", () => {
  it("a curator's review links to the trader's day, not the curator's", () => {
    expect(itemHref(item({ action: "reviewed", section: "eod", entityId: "2026-10-09|Кирилл Б.", trader: "Ольга Н." })))
      .toBe(itemHref(item({ action: "closed", section: "eod", entityId: "2026-10-09", trader: "Кирилл Б." })));
  });
});
