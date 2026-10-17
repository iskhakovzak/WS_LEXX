/**
 * Permissions matrix — frontend mirror of api-server/src/lib/permissionsMatrix.ts.
 * Keys, groups and DEFAULT_MATRIX must stay identical (scripts/check-permissions.mjs in api-server compares
 * both files). Pure module: no React, no "@/..." imports, so the offline check can load it under Node.
 *
 * At runtime the effective capabilities come from GET /api/permissions/me (desk overrides applied); the
 * defaults here are only the fallback while that request is in flight or failed.
 */

export const ROLES = ["trader", "curator", "admin", "guest"] as const;
export type Role = (typeof ROLES)[number];
export type Scope = "desk" | "assigned";

export type CapabilityDef = {
  key: Capability;
  group: string;
  label: string;
  description: string;
  team?: boolean;
  own?: boolean;
  adminOnly?: boolean;
};

export const CAPABILITIES = [
  { key: "team.read", group: "Деск", label: "Видеть данные всех трейдеров", team: true,
    description: "Сделки, события, идеи, рейтинги, плейбук-статистика и ленты по любому трейдеру. Без него — только свои." },
  { key: "users.read.team", group: "Деск", label: "Список команды", team: true,
    description: "Настройки → Команда, /admin/users, назначения куратор/риск/ментор (просмотр)." },

  { key: "trades.read.own", group: "Сделки", label: "Смотреть свои сделки", own: true, description: "Журнал, исполнения, чек-листы своих сделок." },
  { key: "trades.read.team", group: "Сделки", label: "Смотреть сделки команды", team: true, description: "Сделки и исполнения других трейдеров." },
  { key: "trades.write.own", group: "Сделки", label: "Вести свои сделки", own: true, description: "Создавать, править, удалять свои сделки и исполнения." },
  { key: "trades.write.any", group: "Сделки", label: "Править чужие сделки", team: true, description: "Редактировать/переназначать сделки других трейдеров, привязывать их к сетапам и событиям." },
  { key: "trades.review", group: "Сделки", label: "Разбор сделок куратором", team: true, description: "Оставлять разборы и оценку качества." },
  { key: "trades.review.delete.any", group: "Сделки", label: "Удалять чужие разборы", adminOnly: true, description: "Удалять разборы других кураторов." },

  { key: "journal.write.own", group: "Дневник", label: "Вести свой дневник", own: true, description: "План дня, итоги дня, закрытие дня, недельная самооценка, заметки, эмоции." },
  { key: "journal.read.team", group: "Дневник", label: "Читать дневники команды", team: true, description: "Дневник, EOD-статус, недельный отчёт, заметки, эмоции и психо-аналитика других трейдеров." },
  { key: "journal.review", group: "Дневник", label: "Ревью куратора", team: true, description: "Очередь закрытых дней, оценка дня, недельный отчёт 1:1, сводки джуниоров, напоминания." },
  { key: "gameplan.publish", group: "Дневник", label: "Публиковать план дня", description: "Создавать/удалять premarket game plan и видеть кто прочитал." },
  { key: "dailyfeed.manage", group: "Дневник", label: "Управлять дневной лентой", team: true, description: "EOD-пост ленты, правка чужих записей, список непрочитавших." },
  { key: "errors.manage.team", group: "Дневник", label: "Журнал ошибок команды", team: true, description: "Смотреть и вести журнал ошибок от имени трейдера." },

  { key: "risk.read.own", group: "Риск", label: "Свой риск-профиль", own: true, description: "Лимиты, история, позиции, алерты по себе." },
  { key: "risk.read.team", group: "Риск", label: "Риск-деск", team: true, description: "Риск-деск, лимиты и история любого трейдера." },
  { key: "risk.limits.edit", group: "Риск", label: "Менять лимиты", team: true, description: "Изменение лимитов трейдера." },
  { key: "scaling.read.team", group: "Риск", label: "План масштабирования команды", team: true, description: "Оценка и история любого трейдера." },
  { key: "scaling.configure", group: "Риск", label: "Настраивать лестницу тиров", description: "Тиры и правила масштабирования." },
  { key: "scaling.approve", group: "Риск", label: "Решать по тирам", team: true, description: "Создавать/одобрять/отклонять предложения, назначать тир напрямую." },
  { key: "rules.manage.team", group: "Риск", label: "Правила команды", team: true, description: "Правила и нарушения других трейдеров (просмотр, создание, правка)." },
  { key: "rules.violations.delete", group: "Риск", label: "Удалять нарушения", description: "Удаление нарушений (трейдер может только «принять»)." },

  { key: "propreports.import", group: "PropReports", label: "Импорт своих отчётов", own: true, description: "Загрузка файлов по своим счетам (dry-run и запись)." },
  { key: "propreports.read.team", group: "PropReports", label: "Статус и отчёты команды", team: true, description: "Все счета, история синка, инбокс сверки, отчёты по любому трейдеру." },
  { key: "propreports.configure", group: "PropReports", label: "Привязка счетов", description: "Привязка счетов PropReports к трейдерам, обновление списка счетов." },
  { key: "propreports.sync", group: "PropReports", label: "Синхронизация и сверка", description: "Запуск синка, объединение/разделение сделок, удаление отчётов, XLS-импорт из админки." },

  { key: "ratings.read.team", group: "Оценки", label: "Оценки команды", team: true, description: "Еженедельные оценки любого трейдера." },
  { key: "ratings.write", group: "Оценки", label: "Ставить оценки", team: true, description: "Ставить оценки, править/удалять свои оценки." },
  { key: "ratings.manage.any", group: "Оценки", label: "Править чужие оценки", adminOnly: true, description: "Редактировать и удалять оценки других кураторов." },

  { key: "playbook.edit", group: "Контент", label: "Вести плейбук", description: "Создавать сетапы, править свои и командные (без автора)." },
  { key: "playbook.edit.any", group: "Контент", label: "Править чужие сетапы", team: true, description: "Редактировать сетапы, созданные другими трейдерами, автопривязка по всему деску." },
  { key: "playbook.review", group: "Контент", label: "Ревью плейбука", description: "Вердикты approved/needs_work/retired, переименование и удаление папок." },
  { key: "ideas.publish", group: "Контент", label: "Публиковать идеи", own: true, description: "Создавать и публиковать свои торговые идеи, комментировать." },
  { key: "ideas.review", group: "Контент", label: "Ревью идей", team: true, description: "Статус ревью идей, управление чужими идеями, черновики всех." },
  { key: "discussions.moderate", group: "Контент", label: "Модерация обсуждений", description: "Удалять чужие темы и комментарии, закрывать темы." },
  { key: "discussions.edit.any", group: "Контент", label: "Править чужие комментарии", adminOnly: true, description: "Редактировать чужие комментарии." },
  { key: "checklist.template.edit", group: "Контент", label: "Шаблон pre-trade чек-листа", description: "Менять пункты чек-листа для всего деска." },
  { key: "watchlist.manage", group: "Контент", label: "Вотчлист деска", description: "Править общий вотчлист (любой участник, не гость)." },

  { key: "users.manage", group: "Администрирование", label: "Управлять пользователями", description: "Создавать, править, деактивировать, банить трейдеров и кураторов; менять назначения." },
  { key: "users.manage.admins", group: "Администрирование", label: "Управлять админами", adminOnly: true, description: "Создавать админов, выдавать роль admin, править/деактивировать админов, банить кураторов." },
  { key: "admin.reports", group: "Администрирование", label: "Жалобы на контент", description: "Очередь жалоб, решение, бан автора." },
  { key: "admin.audit", group: "Администрирование", label: "Журнал аудита", description: "Читать audit log и статистику." },
  { key: "admin.backups.read", group: "Администрирование", label: "Список бэкапов", description: "Список бэкапов, полный JSON-бэкап." },
  { key: "admin.backups.run", group: "Администрирование", label: "Запуск и скачивание бэкапов", adminOnly: true, description: "Запуск бэкапа, ссылки на скачивание." },
  { key: "telegram.broadcast", group: "Администрирование", label: "Telegram-рассылка", description: "Массовая рассылка и отвязка Telegram у пользователей." },
  { key: "digest.manage.any", group: "Администрирование", label: "Дайджест за других", team: true, description: "Смотреть/менять подписку на дайджест другого участника." },
  { key: "permissions.manage", group: "Администрирование", label: "Менять права доступа", adminOnly: true, description: "Редактировать матрицу прав деска." },
] as const;

export type Capability = (typeof CAPABILITIES)[number]["key"];

export const CAPABILITY_KEYS: readonly Capability[] = CAPABILITIES.map((c) => c.key);
export const CAPABILITY_DEFS: readonly CapabilityDef[] = CAPABILITIES as unknown as readonly CapabilityDef[];
const CAP_BY_KEY = new Map<string, CapabilityDef>(CAPABILITY_DEFS.map((c) => [c.key, c]));

export function capabilityDef(cap: string): CapabilityDef | undefined {
  return CAP_BY_KEY.get(cap);
}

const MEMBER_CAPS: readonly Capability[] = [
  "trades.read.own", "trades.write.own", "journal.write.own", "risk.read.own", "propreports.import",
  "playbook.edit", "ideas.publish", "watchlist.manage",
];

const CURATOR_CAPS: readonly Capability[] = [
  ...MEMBER_CAPS,
  "team.read", "users.read.team",
  "trades.read.team", "trades.write.any", "trades.review",
  "journal.read.team", "journal.review", "gameplan.publish", "dailyfeed.manage", "errors.manage.team",
  "risk.read.team", "risk.limits.edit", "scaling.read.team", "scaling.configure", "scaling.approve",
  "rules.manage.team", "rules.violations.delete",
  "propreports.read.team", "propreports.configure", "propreports.sync",
  "ratings.read.team", "ratings.write",
  "playbook.edit.any", "playbook.review", "ideas.review", "discussions.moderate", "checklist.template.edit",
  "users.manage", "admin.reports", "admin.audit", "admin.backups.read", "telegram.broadcast", "digest.manage.any",
];

export const DEFAULT_MATRIX: Readonly<Record<Role, readonly Capability[]>> = {
  guest: [],
  trader: MEMBER_CAPS,
  curator: CURATOR_CAPS,
  admin: CAPABILITY_KEYS,
};

export const DEFAULT_SCOPE: Scope = "desk";

export function normalizeRole(role: string | null | undefined): Role {
  return role === "admin" || role === "curator" || role === "guest" ? role : "trader";
}

// ─── What GET /api/permissions/me returns ────────────────────────────────────

export type PermissionsMe = {
  name: string | null;
  role: Role;
  guest: boolean;
  capabilities: Capability[];
  /** Scope of every team capability the role holds. */
  scopes: Partial<Record<Capability, Scope>>;
  /** Traders assigned to this actor (curator / risk manager / mentor) — matter only under "assigned" scope. */
  wards: string[];
  /** True when the desk has overrides on top of the defaults. */
  customized: boolean;
  updatedAt: string | null;
};

export type Target = { trader?: string | null };

/** Defaults for a role — the fallback while /api/permissions/me is loading (or failed). */
export function defaultPermissions(role: string | null | undefined, name: string | null): PermissionsMe {
  const r = normalizeRole(role);
  return {
    name,
    role: r,
    guest: r === "guest",
    capabilities: [...DEFAULT_MATRIX[r]],
    scopes: {},
    wards: [],
    customized: false,
    updatedAt: null,
  };
}

/**
 * Client-side evaluation — mirrors `evaluate` in the API:
 *  - the capability must be held;
 *  - own caps: target.trader (when given) must be me;
 *  - team caps under "assigned" scope: target must be me or one of my wards.
 * Only a UI hint — the API re-checks every request.
 */
export function canWith(me: PermissionsMe | null | undefined, cap: Capability, target?: Target | null): boolean {
  if (!me || me.guest) return false;
  if (!me.capabilities.includes(cap)) return false;
  const def = CAP_BY_KEY.get(cap);
  if (!def) return false;
  const t = target?.trader?.trim() || null;
  if (def.own) return t === null || t === me.name;
  if (def.team && t !== null && t !== me.name && (me.scopes[cap] ?? DEFAULT_SCOPE) === "assigned") return me.wards.includes(t);
  return true;
}

/** Group capabilities for the Settings matrix, preserving the declaration order. */
export function groupedCapabilities(defs: readonly CapabilityDef[] = CAPABILITY_DEFS): { group: string; items: CapabilityDef[] }[] {
  const out: { group: string; items: CapabilityDef[] }[] = [];
  for (const d of defs) {
    let g = out.find((x) => x.group === d.group);
    if (!g) { g = { group: d.group, items: [] }; out.push(g); }
    g.items.push(d);
  }
  return out;
}
