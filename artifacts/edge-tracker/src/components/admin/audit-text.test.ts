import { describe, expect, it } from "vitest";
import { actorName, auditSentence, describeAudit, type AuditLike } from "./audit-text";

const entry = (action: string, details: Record<string, unknown> | string | null = null, extra: Partial<AuditLike> = {}): AuditLike => ({
  actor: "Ориф",
  action,
  targetType: "user",
  targetId: "12",
  details: details == null ? null : typeof details === "string" ? details : JSON.stringify(details),
  ...extra,
});

describe("describeAudit", () => {
  it("names the person and keeps the reason as detail", () => {
    const t = describeAudit(entry("user.freeze", { name: "Умид", reason: "нарушение лимита" }));
    expect(t.text).toBe("заморозил учётку Умид");
    expect(t.detail).toBe("нарушение лимита");
    expect(t.tone).toBe("down");
  });

  it("marks bulk actions", () => {
    expect(describeAudit(entry("user.archive", { name: "Умид", reason: "ушёл", bulk: true })).text).toContain("(массово)");
  });

  it("falls back to #id when the name is missing", () => {
    expect(describeAudit(entry("user.unfreeze", {})).text).toBe("разморозил учётку #12");
  });

  it("describes role changes with Russian role names", () => {
    const t = describeAudit(entry("user.role.change", { name: "Умид", from: "trader", role: "curator", reason: "повышение" }));
    expect(t.text).toBe("сменил роль Умид: трейдер → куратор");
  });

  it("summarises PropReports sync counters instead of raw JSON", () => {
    const t = describeAudit(entry("propreports.sync", { source: "file", fileName: "fills.csv", inserted: 3, updated: 536, unchanged: 10 }, { targetType: null, targetId: null }));
    expect(t.text).toBe("синхронизировал PropReports из файла fills.csv");
    expect(t.detail).toBe("добавлено 3, обновлено 536, без изменений 10");
    expect(t.tone).toBe("accent");
  });

  it("uses tier names from config, then the built-in ladder", () => {
    const e = entry("scaling.assign", { toTier: "junior", fromTier: "trainee" }, { targetType: "trader", targetId: "Умид" });
    expect(describeAudit(e, { junior: "Джуниор" }).text).toBe("назначил тир Джуниор трейдеру Умид");
    expect(describeAudit(e).detail).toBe("был: Стажёр");
  });

  it("has a readable fallback for unknown actions and never throws on bad JSON", () => {
    const t = describeAudit(entry("widget.delete", "{not json", { targetType: null, targetId: null }));
    expect(t.text).toBe("widget delete");
    expect(t.tone).toBe("down");
  });
});

describe("actors and sentences", () => {
  it("translates service actors", () => {
    expect(actorName("import-script")).toBe("Скрипт импорта");
    expect(actorName("Ориф")).toBe("Ориф");
  });

  it("builds a full sentence for CSV", () => {
    expect(auditSentence(entry("user.sessions.reset", { name: "Умид", reason: "смена пароля" }))).toBe("Ориф сбросил сессии Умид (смена пароля)");
  });
});
