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
    expect(describeAudit(e, { junior: "Джун" }).text).toBe("назначил тир Джун трейдеру Умид");
    expect(describeAudit(e).detail).toBe("был: Стажёр");
  });

  it("has a readable fallback for unknown actions and never throws on bad JSON", () => {
    const t = describeAudit(entry("widget.delete", "{not json", { targetType: null, targetId: null }));
    expect(t.text).toBe("удалил: widget");
    expect(t.tone).toBe("down");
    const u = describeAudit(entry("widget.sync", { historyId: 5, resync: false, tierKey: "trainee" }, { targetType: "curator_notes", targetId: "7" }));
    expect(u.text).toBe("widget sync · Заметка #7");
    expect(u.detail).toBe("тир: Стажёр");
  });

  it("describes risk-limit templates in Russian without technical ids", () => {
    const e = entry("risk.limits.template", { tierKey: "trainee", fromTier: null, resync: false, historyId: 5, changes: ["дневной нет → $150", "недельный нет → $400"] }, { targetType: "trader_risk_limits", targetId: "Умид" });
    const t = describeAudit(e);
    expect(t.text).toBe("применил шаблон лимитов тира Стажёр к Умид");
    expect(t.detail).toBe("дневной нет → $150, недельный нет → $400");
    expect(`${t.text} ${t.detail}`).not.toMatch(/tierKey|resync|historyId/);
    const r = describeAudit(entry("risk.limits.template", { tierKey: "junior", fromTier: "junior", resync: true, changes: [] }, { targetType: "trader_risk_limits", targetId: "Умид" }));
    expect(r.text).toBe("сверил лимиты Умид с шаблоном тира Джун");
    expect(r.detail).toBe("лимиты уже совпадали");
    const k = describeAudit(entry("risk.limits.template", { tierKey: "trainee", changes: ["позиций нет → 2", "тир нет → trainee"] }, { targetType: "trader_risk_limits", targetId: "Умид" }));
    expect(k.detail).toBe("позиций нет → 2, тир нет → Стажёр");
  });

  it("describes the soft queue archive and stage changes", () => {
    const q = describeAudit(entry("curator.queue.archive_old", { olderThanDays: 14, archived: 249, byKind: { eod: 240, weekly: 9 } }, { targetType: "curator_queue_acks", targetId: null }));
    expect(q.text).toBe("убрал из очереди разборов 249 старых элементов");
    expect(q.detail).toBe("старше 14 дн. · дни 240, недели 9");
    const st = describeAudit(entry("academy.stage.promote", { from: "trainee", to: "junior" }, { targetType: "academy_trader_stage", targetId: "Умид" }));
    expect(st.text).toBe("повысил Умид до ступени Джун");
    expect(st.detail).toBe("была: Стажёр");
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
