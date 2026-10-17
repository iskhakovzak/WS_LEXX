/**
 * Timestamps for remote + office students: the viewer's local time, plus New York time when it differs
 * (market-related deadlines and reviews are discussed in NY time).
 */
const LOCAL = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const NY = new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const NY_OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const LOCAL_OFFSET = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

export function formatLocal(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? LOCAL.format(d) : "—";
}

export function formatNy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  if (NY_OFFSET.format(d) === LOCAL_OFFSET.format(d)) return null; // viewer is already on NY time
  return `${NY.format(d)} NY`;
}

export function DualTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const ny = formatNy(iso);
  return (
    <time dateTime={iso ?? undefined} className={className ?? "tabular-nums"} title={ny ? `Ваше время / ${ny}` : "Время Нью-Йорка совпадает с вашим"}>
      {formatLocal(iso)}
      {ny && <span className="ml-1 text-muted-foreground">({ny})</span>}
    </time>
  );
}

export function relativeDays(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "нет активности";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} дн. назад`;
}
