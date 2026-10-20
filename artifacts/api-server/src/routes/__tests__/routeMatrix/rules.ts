/**
 * Rules of the route × role matrix (routeRoleMatrix.test.ts): what each caller may get on a mutating route, derived
 * from the permission matrix or taken from an explicit entry (expectations.ts). Pure — returns the problems found.
 */
import { DEFAULT_MATRIX, isCapability, type Capability } from "../../../lib/permissionsMatrix";
import { isPublicApiRoute } from "../../../lib/auth";
import { samplePath, type Caller, type Observation, type RouteDef } from "./harness";

export type ExpectationKind =
  /** Any signed-in member (own data; scoping happens inside): trader, curator, admin never 401/403. */
  | "member"
  /** Off-matrix role check (curator or admin, e.g. STAFF_ONLY): trader 403, curator and admin pass. */
  | "staff"
  /** Admin only by role: trader and curator 403, admin passes. */
  | "admin"
  /** Owner-only by design (author of the row etc.): any member may be refused — even admin; not observable here. */
  | "owner"
  /** Capability checked after the row is loaded (the empty DB answers 404 first): holders never 403. */
  | "cap"
  /** Public route (lib/auth PUBLIC_API_ROUTES): no sign-in needed. */
  | "public"
  /** A guest may call it (lib/auth GUEST_ALLOWED_MUTATIONS). */
  | "guest-ok"
  /** Retired: every member gets 404 / 410. */
  | "retired"
  /** Behind a desk switch that is off by default (lib/settings/registry): every member gets 404. */
  | "switch";

export type Expectation = { kind: ExpectationKind; reason: string; cap?: Capability };

const MEMBERS = ["trader", "curator", "admin"] as const;
type Member = (typeof MEMBERS)[number];
const denied = (s: number) => s === 401 || s === 403;

export function routeKey(r: RouteDef): string {
  return `${r.method} ${r.path}`;
}

const holds = (role: Member, cap: Capability) => DEFAULT_MATRIX[role].includes(cap);

/** Problems of one route ([] = consistent). */
export function checkRoute(key: string, obs: Record<string, Observation>, exp: Expectation | undefined): string[] {
  const out: string[] = [];
  const bad = (who: Caller | Member, want: string) => out.push(`${key}: ${who} got ${obs[who].status}${obs[who].code ? ` ${obs[who].code}` : ""}, expected ${want}`);
  const [method, ...rest] = key.split(" ");
  const path = rest.join(" ");
  const isPublic = isPublicApiRoute(method, samplePath(path));

  for (const c of Object.keys(obs) as Caller[]) {
    if (obs[c].status === 0) out.push(`${key}: ${c} → no answer (${obs[c].code})`);
  }
  if (out.length) return out;

  // The global gate (lib/auth apiAuthGate) covers every route.
  if (!isPublic && obs.anon.status !== 401) bad("anon", "401");
  if (!isPublic && exp?.kind !== "guest-ok" && obs.guest.status !== 403) bad("guest", "403 (guest is read-only)");

  if (exp) {
    if (exp.cap !== undefined && !isCapability(exp.cap)) out.push(`${key}: expectations.ts names an unknown capability ${exp.cap}`);
    switch (exp.kind) {
      case "member":
      case "guest-ok":
        for (const m of MEMBERS) if (denied(obs[m].status)) bad(m, "not 401/403 (any member)");
        break;
      case "staff":
        if (obs.trader.status !== 403) bad("trader", "403 (staff only)");
        for (const m of ["curator", "admin"] as const) if (denied(obs[m].status)) bad(m, "not 401/403 (staff)");
        break;
      case "admin":
        for (const m of ["trader", "curator"] as const) if (obs[m].status !== 403) bad(m, "403 (admin only)");
        if (denied(obs.admin.status)) bad("admin", "not 401/403 (admin)");
        break;
      case "cap":
        if (!exp.cap) out.push(`${key}: a «cap» entry needs the capability`);
        else for (const m of MEMBERS) {
          if (holds(m, exp.cap) && denied(obs[m].status)) bad(m, `not 401/403 (holds ${exp.cap})`);
          if (!holds(m, exp.cap) && obs[m].status === 403 && obs[m].capability && obs[m].capability !== exp.cap) bad(m, `403 naming ${exp.cap}`);
        }
        break;
      case "owner":
        for (const m of MEMBERS) if (obs[m].status === 401) bad(m, "not 401 (signed in)");
        break;
      case "public":
        if (!isPublic) out.push(`${key}: «public» entry, but lib/auth PUBLIC_API_ROUTES does not list it`);
        break;
      case "retired":
        for (const m of MEMBERS) if (obs[m].status !== 404 && obs[m].status !== 410) bad(m, "404 / 410 (retired)");
        break;
      case "switch":
        for (const m of MEMBERS) if (obs[m].status !== 404) bad(m, "404 (desk switch off by default)");
        break;
    }
    return out;
  }

  // Derived: the capabilities named by the 403s of this route.
  const caps = [...new Set(MEMBERS.map((m) => obs[m]).filter((o) => o.status === 403 && o.capability).map((o) => o.capability!))];
  if (!caps.length) {
    if (!isPublic) out.push(`${key}: no rule — no capability check observed (trader ${obs.trader.status}, curator ${obs.curator.status}, admin ${obs.admin.status}); guard it with requireCap / route({ cap }) or add an entry to routeMatrix/expectations.ts`);
    return out;
  }
  for (const c of caps) if (!isCapability(c)) out.push(`${key}: 403 names an unknown capability ${c}`);
  for (const m of MEMBERS) {
    const lacks = caps.filter((c) => isCapability(c) && !holds(m, c));
    if (lacks.length && obs[m].status !== 403) bad(m, `403 (lacks ${lacks.join(", ")})`);
    if (!lacks.length && denied(obs[m].status)) bad(m, `not 401/403 (holds ${caps.join(", ")})`);
  }
  return out;
}
