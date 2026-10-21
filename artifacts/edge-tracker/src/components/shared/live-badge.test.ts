import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveBadge, liveAgeMin, liveAgoText } from "./live-badge";

const NOW = Date.parse("2026-10-19T15:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

afterEach(() => vi.useRealTimers());

describe("live badge (RU default)", () => {
  it("age in whole minutes; «только что» under a minute, then minutes, then hours", () => {
    expect(liveAgeMin(ago(3), NOW)).toBe(3);
    expect(liveAgeMin("nope", NOW)).toBeNull();
    expect(liveAgoText(0)).toBe("только что");
    expect(liveAgoText(3)).toBe("3 минуты назад");
    expect(liveAgoText(5)).toBe("5 минут назад");
    expect(liveAgoText(125)).toBe("2 часа назад");
  });

  it("counted snapshot: «Онлайн · обновлено … · открытые −$120»", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const html = renderToStaticMarkup(createElement(LiveBadge, { live: { unrealizedUsd: -120, openPositions: 2, fetchedAt: ago(3), counted: true } }));
    expect(html).toContain("Онлайн · обновлено 3 минуты назад · открытые −$120");
    expect(html).toContain("bg-up");
  });

  it("stale snapshot says so, shows no open amount, grey dot; nothing without a snapshot", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const html = renderToStaticMarkup(createElement(LiveBadge, { live: { unrealizedUsd: -500, openPositions: 1, fetchedAt: ago(45), counted: false } }));
    expect(html).toContain("Позиции не обновляются · обновлено 45 минут назад");
    expect(html).not.toContain("открытые");
    expect(html).toContain("bg-muted-foreground/50");
    expect(renderToStaticMarkup(createElement(LiveBadge, { live: null }))).toBe("");
  });
});
