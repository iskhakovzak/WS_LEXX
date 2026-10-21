import { describe, expect, it } from "vitest";
import { tradesImportTarget } from "../../propreports/import-target";
import type { AccountMapping } from "../../propreports/sync";

const map = (account: string, trader: string | null, extra: Partial<AccountMapping> = {}): AccountMapping => ({
  id: 1, account, accountId: null, accountName: null, trader, active: true, notes: null, aliases: [], lastSyncedAt: null, lastFillAt: null, ...extra,
});

describe("tradesImportTarget", () => {
  it("takes the account from the file name and links it to the picked trader", () => {
    expect(tradesImportTarget({ fromFile: "31206884", trader: "Zakir", mappings: [map("31206881", "Zakir")] }))
      .toEqual({ ok: true, account: "31206884", link: { account: "31206884", trader: "Zakir" } });
  });

  it("does not relink an account the trader already owns", () => {
    expect(tradesImportTarget({ fromFile: "31206881", trader: "Zakir", mappings: [map("31206881", "Zakir")] }))
      .toEqual({ ok: true, account: "31206881", link: null });
  });

  it("refuses an account that belongs to another trader", () => {
    expect(tradesImportTarget({ fromFile: "555", trader: "Zakir", mappings: [map("555", "Dmitry")] }))
      .toEqual({ ok: false, code: "ACCOUNT_LINKED_TO_OTHER", account: "555", owner: "Dmitry" });
  });

  it("gives a trader-less mapping row to the trader", () => {
    expect(tradesImportTarget({ fromFile: "777", trader: "Zakir", mappings: [map("777", null)] }))
      .toEqual({ ok: true, account: "777", link: { account: "777", trader: "Zakir" } });
  });

  it("without an account in the file falls back to the trader's mapping, then to the name", () => {
    expect(tradesImportTarget({ fromFile: null, trader: "Zakir", mappings: [map("31206881", "Zakir", { active: false }), map("31206882", "Zakir")] }))
      .toEqual({ ok: true, account: "31206882", link: null });
    expect(tradesImportTarget({ fromFile: null, trader: "New", mappings: [] }))
      .toEqual({ ok: true, account: "New", link: { account: "New", trader: "New" } });
  });

  it("without a trader keeps the old behaviour (explicit field first, no link)", () => {
    expect(tradesImportTarget({ explicit: "1", fromFile: "2", mappings: [] })).toEqual({ ok: true, account: "1", link: null });
    expect(tradesImportTarget({ mappings: [] })).toEqual({ ok: false, code: "REPORT_ACCOUNT_UNKNOWN" });
  });
});
