// Admin → «Настройки деска»: the quests / achievements groups (api lib/settings/registry.ts) come right after «Награды»
// and their keys have labels in RU and UZ (the form renders keys generically; a key without a label shows the key).
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { deskSettingsI18n } from "@/i18n/ns/deskSettings";
import { groupRows, type SettingRow } from "./desk-settings-model";
import { settingLabel } from "./desk-settings-text";

const row = (key: string, group: string): SettingRow => ({ key, def: { group, type: "boolean", default: true }, value: true }) as unknown as SettingRow;

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("quests / achievements settings", () => {
  it("groups follow «Награды», before Telegram", () => {
    const g = groupRows([row("telegram.morningEnabled", "telegram"), row("achievements.enabled", "achievements"), row("quests.enabled", "quests"), row("rewards.level1Points", "rewards")]);
    expect(g.map((x) => x.group)).toEqual(["rewards", "quests", "achievements", "telegram"]);
  });

  it("labels and group titles in RU and UZ", async () => {
    expect(settingLabel("quests.curatorDefaultPoints")).toBe("Куратор: награда по умолчанию");
    expect(settingLabel("achievements.contractStreak3")).toBe("Серия контракта: золото");
    expect(deskSettingsI18n.tryT("groups.quests.title")).toBe("Квесты");
    await setLang("uz", { source: "init" });
    expect(settingLabel("achievements.reviewStreak4")).toBe("Uzilishsiz tahlil: platina");
    expect(deskSettingsI18n.tryT("groups.achievements.title")).toBe("Yutuqlar");
  });
});
