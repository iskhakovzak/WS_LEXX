/**
 * A person's name that opens their profile — only where the viewer may open it: one's own name → /profile, anyone
 * else's → /people/:id when the viewer's team.read covers that person (staff by default, «assigned» scope → wards).
 * Otherwise (a trader looking at a colleague, an unknown name) it is plain text: no dead links into a closed view.
 */
import type * as React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { IdCard } from "lucide-react";
import { personName } from "@/i18n";
import { profileI18n } from "@/i18n/ns/profile";

/** Where a name links to for this viewer (null = not linkable). Pure, for lists that build their own rows. */
export function profileHrefFor(
  name: string | null | undefined,
  ctx: { me: string | null | undefined; idOf: (name: string) => number | undefined; canRead: (name: string) => boolean },
): string | null {
  if (!name) return null;
  if (ctx.me && name === ctx.me) return "/profile";
  if (!ctx.canRead(name)) return null;
  const id = ctx.idOf(name);
  return id ? `/people/${id}` : null;
}

export function usePersonHref(): (name: string | null | undefined) => string | null {
  const { user, dbUsers, can } = useAuth();
  const me = user?.role === "guest" ? null : user?.traderName ?? null;
  return (name) => profileHrefFor(name, {
    me,
    idOf: (n) => dbUsers.find((u) => u.name === n)?.id,
    canRead: (n) => can("team.read", { trader: n }),
  });
}

/** A small «профиль» chip / icon link next to a name that is already a button (rows that open a sheet). */
export function PersonProfileLink({ name, className, children }: { name: string; className?: string; children?: React.ReactNode }) {
  const hrefOf = usePersonHref();
  const href = hrefOf(name);
  if (!href) return null;
  const label = profileI18n.t("titleOf", { name: personName(name) });
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className={cn("press inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-md text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      {children ?? <IdCard className="h-3.5 w-3.5" aria-hidden="true" />}
    </Link>
  );
}

export function PersonLink({ name, className, children }: { name: string; className?: string; children?: React.ReactNode }) {
  const hrefOf = usePersonHref();
  const href = hrefOf(name);
  const label = children ?? personName(name);
  if (!href) return <span className={className}>{label}</span>;
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={cn("rounded-sm underline-offset-2 hover:underline focus-visible:underline", className)}
    >
      {label}
    </Link>
  );
}
