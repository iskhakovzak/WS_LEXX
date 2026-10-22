// The suggestion cards and the section note, server-rendered from fixtures: the honest statuses («Подтверждено» /
// «Гипотеза» with its next step: days needed, «всё время», or a review for «разбор»), the «до входа» / «разбор»
// eyebrow, the out-of-sample line, the muted «разбор» amount, «предварительно» while the check runs, the honest empty
// screen, the disclaimer in every note, and today's cards for an older API.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { HonestyInfo, HonestyState, Suggestion, SuggestionsResponse } from "./api";
import { SuggestionCards, SuggestionsNote } from "./suggestions-panel";

const sg = (p: Partial<Suggestion> = {}): Suggestion => ({
  rule: { type: "excludeTickers", tickers: ["BAD"] }, label: "", improvement: 1234, ci: { lo: 100, hi: 2000 }, tradesLeft: 50, excluded: 12,
  scenarioNet: 0, scenarioWinRate: null, scenarioProfitFactor: null, robust: true, kind: "exante", picked: true, sameData: false,
  holdout: null, affected: 12, changed: 0, estimate: false, ...p,
});
const honesty = (state: HonestyState, p: Partial<HonestyInfo> = {}): HonestyInfo => ({
  state, version: 1, computedAt: null, wfAvailable: true, months: 8, testDays: 120, confirmed: 0, hypotheses: 0, pollMs: null, ...p,
});
const resp = (suggestions: Suggestion[], h?: HonestyInfo): SuggestionsResponse => ({
  scope: "T0", period: { from: null, to: null, withEntryTime: 0, withHold: 0, withR: 0, withQty: 0 }, baselineNet: 0, trades: 900, days: 160,
  smallSample: false, suggestions, tested: 57, generatedAt: "", ...(h ? { honesty: h } : {}),
});

function render(el: ReturnType<typeof createElement>): string {
  const html = renderToStaticMarkup(createElement(TooltipProvider, null, el));
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, "");
}
const cards = (data: SuggestionsResponse) => render(createElement(SuggestionCards, { data, isLoading: false, rules: [], periodLabel: "за всё время", onToggle: () => undefined }));

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("honest cards", () => {
  const ready = resp([
    sg({ status: "confirmed", timing: "exante", oos: { sum: 640, months: 6, positive: 5, testDays: 120 }, needDays: null }),
    sg({
      rule: { type: "maxTradesPerDay", n: 3 }, status: "hypothesis", robust: false, picked: false, timing: "exante", improvement: 300,
      oos: null, needDays: 63, needDaysAtLeast: true, fragile: { reason: "topDays", days: 3 },
    }),
    sg({ rule: { type: "excludeSetups", setups: ["ORB"] }, kind: "label", status: "hypothesis", timing: "review", improvement: 200, needDays: null }),
  ], honesty("ready", { confirmed: 1, hypotheses: 2 }));

  it("statuses, eyebrows, the out-of-sample line and the days still needed", () => {
    const html = cards(ready);
    expect(html).toContain("Подтверждено");
    expect(html).toContain("Гипотеза");
    expect(html).toContain("до входа");
    expect(html).toContain("разбор");
    expect(html).toContain("на следующих месяцах +$640.00 · помогло в 5 из 6");
    expect(html).toContain("нужно ещё не меньше ~63 торговых дня");
    // «разбор»: no days promise (more data cannot confirm it) — the review is its next step.
    expect(html).not.toContain("~21 торговый день");
    expect(html).toContain("разбери эти сделки в «Разборе дня»");
    expect(html).toContain("держится на 3 днях");
    // The confirmed card has no range line (out of sample instead); the hypothesis without oos keeps its range.
    expect(html).toContain("от +$100.00 до +$2,000");
    expect(html).not.toContain("предварительно");
    expect(html).not.toContain("по твоим отметкам");
  });

  it("«разбор» does not promise «+$»: its amount is muted, the ex-ante ones are green", () => {
    const html = cards(ready);
    expect(html).toMatch(/text-muted-foreground">\+\$200\.00</);
    expect(html).toMatch(/text-up">\+\$1,234</);
  });

  it("«с начала года»: a card whose days outrun the year offers «всё время» (a switch when the page has one)", () => {
    const outrun = resp([sg({ status: "hypothesis", timing: "exante", needDays: null, needAllTime: true })], honesty("ready", { hypotheses: 1 }));
    expect(cards(outrun)).toContain("проверка — на периоде «Всё время»");
    const html = render(createElement(SuggestionCards, { data: outrun, isLoading: false, rules: [], periodLabel: "с начала года", onToggle: () => undefined, onAllTime: () => undefined }));
    expect(html).toMatch(/<button[^>]*>проверка — на периоде «Всё время»<\/button>/);
  });

  it("the honest empty screen when nothing passed", () => {
    const html = cards(resp([], honesty("ready")));
    expect(html).toContain("Подтверждённых правил пока нет");
    expect(html).toContain("Она обновится сама");
  });
});

describe("while the check runs, team, older API", () => {
  it("fast cards are «предварительно»; their tooltip says «ещё считается» only while it runs", () => {
    const html = cards(resp([sg({ status: "preliminary", timing: "exante" })], honesty("queued", { pollMs: 4000 })));
    expect(html).toContain("предварительно");
    expect(html).not.toContain("устойчиво");
    expect(html).toContain("Честная проверка ещё считается");
    for (const st of ["failed", "unavailable"] as const) {
      const off = cards(resp([sg({ status: "preliminary", timing: "exante" })], honesty(st)));
      expect(off, st).toContain("Честная проверка сейчас недоступна");
      expect(off, st).not.toContain("ещё считается");
    }
  });

  it("an older API (no honesty, no timing): today's pills, the eyebrow from kind, the old empty state", () => {
    const html = cards(resp([sg({ robust: false })]));
    expect(html).toContain("слабый сигнал");
    expect(html).toContain("до входа");
    expect(cards(resp([]))).toContain("Нет простого «если бы»");
  });

  it("EN", async () => {
    await setLang("en", { source: "init" });
    const html = cards(resp([sg({ status: "hypothesis", needDays: 40, timing: "exante" })], honesty("ready")));
    expect(html).toContain("Hypothesis");
    expect(html).toContain("needs ~40 trading days more");
    expect(html).toContain("before entry");
  });
});

describe("section note", () => {
  const note = (data: SuggestionsResponse | undefined, onAllTime?: () => void) => render(createElement(SuggestionsNote, { data, periodPhrase: "за всё время", onAllTime }));

  it("computing (with a spinner), no confirmed yet, team, unavailable — else today's hint", () => {
    expect(note(resp([sg()], honesty("running")))).toContain("Проверяем честно");
    expect(note(resp([sg()], honesty("running")))).toContain("animate-spin");
    expect(note(resp([sg({ status: "hypothesis" })], honesty("ready", { hypotheses: 1 })))).toContain("Подтверждённых правил пока нет — вот сильнейшие гипотезы");
    expect(note(resp([sg()], honesty("team")))).toContain("Командный вид");
    expect(note(resp([sg()], honesty("unavailable")))).toContain("недоступна");
    expect(note(resp([sg()]))).toContain("Подбираем по твоим сделкам за всё время");
    expect(note(undefined)).toContain("Подбираем по твоим сделкам");
  });

  it("«Это история, а не обещание» in every state, whatever the cards are (ru / en / uz)", async () => {
    const states = [honesty("queued"), honesty("running", { pendingMs: 600_000 }), honesty("ready", { hypotheses: 1 }), honesty("team"), honesty("window"), honesty("failed"), honesty("unavailable"), undefined];
    for (const h of states) expect(note(resp([sg({ status: "hypothesis" })], h)), h?.state ?? "older API").toContain("Это история, а не обещание.");
    await setLang("en", { source: "init" });
    for (const h of states) expect(note(resp([sg()], h)), h?.state ?? "older API").toContain("This is history, not a promise.");
    await setLang("uz", { source: "init" });
    for (const h of states) expect(note(resp([sg()], h)), h?.state ?? "older API").toContain("Bu tarix, vaʼda emas.");
  });

  it("taking longer than usual: no spinner and no «обычно до минуты» — the cards still update by themselves", () => {
    const html = note(resp([sg()], honesty("running", { pendingMs: 5 * 60_000, pollMs: 30_000 })));
    expect(html).toContain("идёт дольше обычного");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("до минуты");
  });

  it("a short period: the fast pick, and the switch to «всё время» where the honest check runs", () => {
    expect(note(resp([sg()], honesty("window")))).toContain("На коротком периоде — быстрый отбор");
    expect(note(resp([sg()], honesty("window")), () => undefined)).toMatch(/<button[^>]*>Показать за всё время<\/button>/);
    expect(note(resp([sg()], honesty("window")))).not.toContain("<button");
  });
});
