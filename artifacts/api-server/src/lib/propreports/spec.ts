/**
 * PropReports API v2 reference data (vendor docs, page 589971, checked 2026-10-19) — one place the client, the routes
 * and the staff UI read action names, page sizes, optionalFields and error meaning from.
 */

export type ApiAction =
  | "version" | "accounts" | "groups" | "fills" | "positions" | "adjustments" | "reports" | "report" | "locates"
  | "instruments" | "profiles" | "upload" | "uploadStatus" | "uploadMessages" | "uploadSearch";

export interface ActionSpec {
  /** superuser-only on the PropReports side (403 otherwise) */
  superuser: boolean;
  /** rows per page when paginated (the body ends with `Page X/Y`); null = not paginated */
  pageSize: number | null;
  /** requires accountId XOR groupId */
  scope: "required" | "optional" | "none";
  /** startDate + endDate required */
  dateRange: boolean;
  /** response body format */
  format: "csv" | "text" | "csv-sections";
}

export const ACTIONS: Record<ApiAction, ActionSpec> = {
  version: { superuser: false, pageSize: null, scope: "none", dateRange: false, format: "text" },
  accounts: { superuser: false, pageSize: 50_000, scope: "optional", dateRange: false, format: "csv" },
  groups: { superuser: false, pageSize: null, scope: "none", dateRange: false, format: "csv" },
  fills: { superuser: false, pageSize: 50_000, scope: "required", dateRange: true, format: "csv" },
  positions: { superuser: false, pageSize: 10_000, scope: "required", dateRange: true, format: "csv" },
  adjustments: { superuser: false, pageSize: 50_000, scope: "required", dateRange: true, format: "csv" },
  reports: { superuser: false, pageSize: null, scope: "none", dateRange: false, format: "csv" },
  report: { superuser: false, pageSize: null, scope: "required", dateRange: true, format: "csv" },
  locates: { superuser: false, pageSize: 50_000, scope: "required", dateRange: true, format: "csv" },
  instruments: { superuser: true, pageSize: null, scope: "optional", dateRange: false, format: "csv" },
  profiles: { superuser: true, pageSize: 50_000, scope: "none", dateRange: false, format: "csv" },
  upload: { superuser: true, pageSize: null, scope: "none", dateRange: false, format: "csv" },
  uploadStatus: { superuser: true, pageSize: null, scope: "none", dateRange: false, format: "csv-sections" },
  uploadMessages: { superuser: true, pageSize: null, scope: "none", dateRange: false, format: "text" },
  uploadSearch: { superuser: true, pageSize: 25, scope: "none", dateRange: false, format: "csv" },
};

/** Who may ask for an optional column. Unauthorized / unknown fields are dropped silently by the server. */
export type FieldLevel = "all" | "permissioned" | "superuser";

export const OPTIONAL_FIELDS = {
  accounts: {
    accountName: "permissioned", clearingName: "permissioned", aggregationUnit: "permissioned", clearingFirmName: "permissioned",
    source: "permissioned", closeDate: "permissioned", creationDate: "permissioned", status: "permissioned",
    activationDate: "permissioned", suspensionDate: "permissioned", deactivationDate: "permissioned", groups: "permissioned",
  },
  fills: {
    currency: "all", multiplier: "all", isin: "all", cusip: "all", sedol: "all", listingExchange: "all", tape: "all",
    liquidity: "all", fillId: "all", propReportsId: "all",
    accountName: "permissioned", clearingName: "permissioned", aggregationUnit: "permissioned", source: "permissioned",
    execBroker: "superuser", contra: "superuser", internalRoute: "superuser", internalLiquidity: "superuser",
    internalContra: "superuser", capacity: "superuser",
  },
  positions: { accountName: "permissioned", clearingName: "permissioned", aggregationUnit: "permissioned" },
  adjustments: { propReportsId: "all", accountName: "permissioned", clearingName: "permissioned", aggregationUnit: "permissioned", source: "permissioned" },
  locates: { propReportsId: "all", accountName: "permissioned", clearingName: "permissioned", aggregationUnit: "permissioned", source: "permissioned" },
  /** v1.22.37+ */
  instruments: { closeSource: "superuser", isComplete: "superuser" },
} as const satisfies Partial<Record<ApiAction, Record<string, FieldLevel>>>;

export type OptionalFieldAction = keyof typeof OPTIONAL_FIELDS;
export type OptionalField<A extends OptionalFieldAction> = keyof (typeof OPTIONAL_FIELDS)[A] & string;

/** Comma list for `optionalFields`, de-duplicated; unknown names are dropped (the server would drop them anyway). */
export function optionalFieldsParam<A extends OptionalFieldAction>(action: A, fields: ReadonlyArray<OptionalField<A> | string>): string | undefined {
  const known = OPTIONAL_FIELDS[action] as Record<string, FieldLevel>;
  const list = [...new Set(fields.map((f) => f.trim()).filter((f) => f in known))];
  return list.length ? list.join(",") : undefined;
}

/** What an HTTP status from api.php means for us (v2 returns real status codes; v1 always said 500). */
export type ApiErrorKind = "badRequest" | "auth" | "forbidden" | "notFound" | "method" | "rateLimited" | "unavailable" | "server" | "network";

export function classifyStatus(status: number): ApiErrorKind {
  if (status === 0) return "network";
  if (status === 400) return "badRequest";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 405) return "method";
  if (status === 429) return "rateLimited";
  if (status === 503) return "unavailable";
  return status >= 500 ? "server" : "badRequest";
}

/** Retrying the same request may help (rate limit, maintenance, transient 5xx, dropped connection). */
export const isRetryable = (kind: ApiErrorKind): boolean => kind === "rateLimited" || kind === "unavailable" || kind === "server" || kind === "network";

/** `YYYY-MM-DD` (v2 date format; v1 used M/D/YYYY). */
export const isYmd = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const LEVEL_RANK: Record<FieldLevel, number> = { all: 0, permissioned: 1, superuser: 2 };

/** Every optional field of `action` the given access level may ask for (in the order the docs list them). */
export function fieldsUpTo<A extends OptionalFieldAction>(action: A, level: FieldLevel): Array<OptionalField<A>> {
  const known = OPTIONAL_FIELDS[action] as Record<string, FieldLevel>;
  return Object.keys(known).filter((f) => LEVEL_RANK[known[f]] <= LEVEL_RANK[level]) as Array<OptionalField<A>>;
}

/** Keep only the fields `level` may request (the server drops the others silently anyway). */
export function allowedFields(action: OptionalFieldAction, fields: readonly string[], level: FieldLevel): string[] {
  const known = OPTIONAL_FIELDS[action] as Record<string, FieldLevel>;
  return fields.filter((f) => f in known && LEVEL_RANK[known[f]] <= LEVEL_RANK[level]);
}

export const isFieldLevel = (s: string): s is FieldLevel => s === "all" || s === "permissioned" || s === "superuser";
