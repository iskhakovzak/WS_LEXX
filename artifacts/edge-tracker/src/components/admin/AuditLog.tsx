import { useEffect, useMemo, useState } from "react";
import { Download, ScrollText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/query-error";
import { EmptyState, ListSkeleton, Panel, Pill, Segmented } from "@/components/ds";
import { addDays, nyDate } from "@/lib/trading-date";
import { downloadCsv, type AuditEntry } from "./api";
import { OBJECT_TYPE_LABEL, actorName, auditSentence, describeAudit, objectLabel } from "./audit-text";
import { nyDayOf, useAuditSearch, type AuditQuery } from "./console-api";

const ALL = "__all";
type Quick = "1" | "7" | "30" | "all" | "custom";

/** Action groups for the «Что» filter («user.*» matches every user action). */
const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "user.*", label: "Пользователи: все действия" },
  { value: "propreports.*", label: "PropReports: все действия" },
  { value: "scaling.*", label: "Тиры: все действия" },
  { value: "report.*", label: "Жалобы: все действия" },
  { value: "academy.*", label: "Академия: все действия" },
];

function rangeFor(q: Quick): { from?: string; to?: string } {
  const today = nyDate();
  if (q === "1") return { from: addDays(today, -1), to: today };
  if (q === "7") return { from: addDays(today, -7), to: today };
  if (q === "30") return { from: addDays(today, -30), to: today };
  return {};
}

function dayHeading(ymd: string) {
  const today = nyDate();
  if (ymd === today) return "Сегодня";
  if (ymd === addDays(today, -1)) return "Вчера";
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
}

export function AuditRow({ entry, tierNames }: { entry: AuditEntry; tierNames?: Record<string, string> }) {
  const t = describeAudit(entry, tierNames);
  const obj = objectLabel(entry.targetType, entry.targetId);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground" title={new Date(entry.createdAt).toLocaleString("ru-RU")}>
        {new Date(entry.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Pill tone={t.tone}>{t.label}</Pill>
          <span><span className="font-medium">{actorName(entry.actor)}</span> {t.text}</span>
        </div>
        {(t.detail || obj) && (
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {t.detail && <span className="min-w-0 max-w-full truncate" title={t.detail}>{t.detail}</span>}
            {obj && <span className="shrink-0">{obj}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

export function AuditLog({ actor, tierNames }: { actor: string; tierNames?: Record<string, string> }) {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<Quick>("30");
  const [from, setFrom] = useState<string>(() => rangeFor("30").from ?? "");
  const [to, setTo] = useState<string>(() => rangeFor("30").to ?? "");
  const [who, setWho] = useState(ALL);
  const [what, setWhat] = useState(ALL);
  const [objType, setObjType] = useState(ALL);
  const [objIdInput, setObjIdInput] = useState("");
  const [objId, setObjId] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setObjId(objIdInput.trim()); }, 300);
    return () => clearTimeout(t);
  }, [qInput, objIdInput]);

  const pickQuick = (v: Quick) => {
    setQuick(v);
    const r = rangeFor(v);
    setFrom(r.from ?? "");
    setTo(r.to ?? "");
  };

  const query: AuditQuery = {
    actor: who === ALL ? undefined : who,
    action: what === ALL ? undefined : what,
    targetType: objType === ALL ? undefined : objType,
    targetId: objId || undefined,
    q: q || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const { data, isLoading, isError, error, refetch, isFetching } = useAuditSearch(actor, query);
  const entries = data?.items ?? [];

  const actors = useMemo(() => {
    const v = new Set((data?.facets.actors ?? []).map((f) => f.value));
    if (who !== ALL) v.add(who);
    return [...v].sort((a, b) => a.localeCompare(b, "ru"));
  }, [data, who]);
  const actions = useMemo(() => {
    const v = new Map<string, string>();
    for (const f of data?.facets.actions ?? []) v.set(f.value, describeAudit({ actor: "", action: f.value, targetType: null, targetId: null, details: null }).label + ` · ${f.value}`);
    if (what !== ALL && !what.endsWith(".*")) v.set(what, what);
    return [...v].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [data, what]);
  const objTypes = useMemo(() => {
    const v = new Set((data?.facets.targetTypes ?? []).map((f) => f.value));
    if (objType !== ALL) v.add(objType);
    return [...v].sort();
  }, [data, objType]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: AuditEntry[] }[] = [];
    for (const e of entries) {
      const key = nyDayOf(e.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, label: dayHeading(key), items: [e] });
    }
    return out;
  }, [entries]);

  const filtersActive = !!q || who !== ALL || what !== ALL || objType !== ALL || !!objId || quick !== "30";
  const reset = () => { setQInput(""); setQ(""); setWho(ALL); setWhat(ALL); setObjType(ALL); setObjIdInput(""); setObjId(""); pickQuick("30"); };

  const exportCsv = () => downloadCsv(
    ["Время", "Кто", "Что произошло", "Подробности", "Объект", "Код действия", "Тип объекта", "ID объекта", "Сырые данные"],
    entries.map((e) => {
      const t = describeAudit(e, tierNames);
      return [new Date(e.createdAt).toLocaleString("ru-RU"), actorName(e.actor), auditSentence(e, tierNames), t.detail ?? "", objectLabel(e.targetType, e.targetId), e.action, e.targetType ?? "", e.targetId ?? "", e.details ?? ""];
    }),
    `audit-${nyDate()}.csv`,
  );

  return (
    <Panel
      title="Журнал аудита"
      description="Кто, что и когда менял: люди, роли, тиры, счета, синки, жалобы. Дни — по Нью-Йорку."
      icon={ScrollText}
      actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!entries.length}><Download /> CSV</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setQInput(""); }}
              placeholder="Поиск: имя, причина, файл"
              aria-label="Поиск по журналу аудита"
              className="pl-9"
            />
          </div>
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger aria-label="Кто"><SelectValue placeholder="Кто: все" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Кто: все</SelectItem>
              {actors.map((a) => <SelectItem key={a} value={a}>{actorName(a)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={what} onValueChange={setWhat}>
            <SelectTrigger aria-label="Что"><SelectValue placeholder="Что: всё" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Что: всё</SelectItem>
              {ACTION_GROUPS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              {actions.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Select value={objType} onValueChange={setObjType}>
              <SelectTrigger aria-label="Объект" className="min-w-0 flex-1"><SelectValue placeholder="Объект: любой" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Объект: любой</SelectItem>
                {objTypes.map((t) => <SelectItem key={t} value={t}>{OBJECT_TYPE_LABEL[t] ?? t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={objIdInput} onChange={(e) => setObjIdInput(e.target.value)} placeholder="ID / имя" aria-label="ID объекта" className="w-28" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Quick>
            ariaLabel="Период"
            size="sm"
            value={quick}
            onChange={pickQuick}
            options={[{ value: "1", label: "24ч" }, { value: "7", label: "7д" }, { value: "30", label: "30д" }, { value: "all", label: "Всё" }, { value: "custom", label: "Даты" }]}
          />
          {quick === "custom" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              с <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" className="h-8 w-[150px]" />
              по <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="По дату" className="h-8 w-[150px]" />
            </span>
          )}
          {filtersActive && <Button variant="ghost" size="sm" onClick={reset}>Сбросить</Button>}
          {data && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {data.total > entries.length ? `показано ${entries.length} из ${data.total}` : `${entries.length} записей`}
            </span>
          )}
        </div>

        {isError ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={6} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filtersActive ? "Ничего не найдено" : "Журнал пуст"}
            description={filtersActive ? "Измените фильтры или период." : "Здесь появятся изменения людей, ролей, тиров, счетов и синки."}
            action={filtersActive ? <Button variant="outline" size="sm" onClick={reset}>Сбросить фильтры</Button> : undefined}
          />
        ) : (
          <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
            {groups.map((g) => (
              <section key={g.key} className="mb-2">
                <h3 className="micro-label sticky-top py-1.5">{g.label}</h3>
                <ul className="divide-y divide-border/50">
                  {g.items.map((e) => <AuditRow key={e.id} entry={e} tierNames={tierNames} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
