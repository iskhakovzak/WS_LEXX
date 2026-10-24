import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { coachI18n } from "@/i18n/ns/coach";
import { intervalText, perDayText, sliceLabel } from "./model";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("edge map view model (R4)", () => {
  it("every slice key the server can send has a label in every language", async () => {
    const keys = [
      "time:before-8:30", "time:8:30-9:30", "time:11:15-13:30", "time:after-16:00", "session:pre", "session:rth", "session:ah",
      "state:after_win_10", "state:after_loss_10", "zone:le_m2", "zone:m2_m05", "zone:flat", "zone:p05_2", "zone:ge_2",
      "seq:1", "seq:2", "seq:3", "seq:4-5", "seq:6+", "price:lt5", "price:5-10", "price:gt200", "side:long", "side:short",
      "size:lt05", "size:normal", "size:x2", "size:x3", "familiar:0", "familiar:1-3", "familiar:4-30", "familiar:gt30", "rapid:yes",
    ];
    for (const lang of ["ru", "en", "uz"] as const) {
      await setLang(lang, { source: "init" });
      await coachI18n.ready();
      for (const k of keys) expect(sliceLabel(k), `${lang} ${k}`).not.toBe(k);
    }
  });

  it("time ranges and price bands are formatted, not translated", () => {
    expect(sliceLabel("time:11:15-13:30")).toBe("Вход 11:15–13:30");
    expect(sliceLabel("price:5-10")).toBe("Цена $5–10");
    expect(sliceLabel("price:lt5")).toBe("Цена < $5");
    expect(sliceLabel("seq:2")).toBe("Сделка №2 за день");
    expect(sliceLabel("mystery:x")).toBe("mystery:x");
  });

  it("$ per day with the 80% interval", () => {
    expect(perDayText({ perDay: -4.2 })).toBe("−$4.20 в день");
    expect(intervalText({ perDayLo: -6.1, perDayHi: -2.3 })).toBe("80%: −$6.10 … −$2.30");
  });
});
