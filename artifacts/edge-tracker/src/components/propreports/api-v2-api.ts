/**
 * Client for the PropReports API v2 staff extras (types mirror artifacts/api-server/src/routes/propreports-api.ts and
 * lib/propreports/parse-v2.ts): report types + report download, locates, and the superuser upload tools.
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http, isApiError } from "@/lib/api/http";
import { POLL, STALE } from "@/lib/api/keys";
import { downloadBlob } from "@/lib/download";

export type ReportType = { type: string; description: string; scope: "account" | "group"; multiCurrency: boolean };
export type ReportTypesResponse = { reports: ReportType[]; modes: Record<string, string[]> };
export type ReportPreview = { type: string; from: string; to: string; header: string[]; rows: string[][]; totalRows: number; truncated: boolean };

export type LocateRow = {
  dateTime: string; account: string; qty: number; symbol: string; cost: number; locateId: string | null;
  propReportsId: string | null; accountName: string | null;
};
export type PageInfo = { current: number; total: number } | null;

export const UPLOAD_TYPES = ["fill", "adjustment", "position", "instrument", "locate", "account", "user", "payout", "document"] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];
export const UPLOAD_SEARCH_STATUSES = ["scheduling", "pending", "inProgress", "uploaded", "reconciled", "aborted", "deleted"] as const;
export type UploadSearchStatus = (typeof UPLOAD_SEARCH_STATUSES)[number];

export type UploadSummary = {
  uploadId: string; dateTime: string | null; replacementKey: string | null; fileName: string | null; fileSize: number | null;
  source: string | null; parser: string | null; status: string; comment: string | null; hasErrors: boolean; hasNotes: boolean;
};
export type UploadDetail = { uploadId: string; date: string; dataType: string; entries: number | null; status: string; deletedOn: string | null };
export type UploadMessages = { empty: boolean; text: string; sections: Array<{ title: string; body: string }> };
export type SuperuserState = { superuser: boolean | null; checkedAt: string | null; via: string | null };

export type ReportQuery = { type: string; from: string; to: string; accountId?: string; groupId?: string; mode?: string; baseCurrency?: string };
export type UploadSearchQuery = { type?: UploadType | ""; replacementKey?: string; uploadDate?: string; status?: UploadSearchStatus[]; page?: number };
export type UploadForm = {
  file: File; type: UploadType; sourceId?: string; clearingFirmId?: string; replacementKey?: string;
  processingMode?: "tradeFeeAdjustments" | ""; reconciliationMode?: "account" | "clearing" | ""; forceDuplicateProcessing?: boolean;
};

const BASE = "/api/propreports/api";
const keys = {
  all: ["propreports", "api-v2"] as const,
  reports: ["propreports", "api-v2", "reports"] as const,
  superuser: ["propreports", "api-v2", "superuser"] as const,
  locates: (q: object) => ["propreports", "api-v2", "locates", q] as const,
  uploads: (q: object) => ["propreports", "api-v2", "uploads", q] as const,
  status: (id: string) => ["propreports", "api-v2", "upload-status", id] as const,
  messages: (id: string) => ["propreports", "api-v2", "upload-messages", id] as const,
};

/** Upload is still moving through the queue (poll again). */
export const isUploadRunning = (s: string | null | undefined): boolean => /^(scheduling|pending|in ?progress)$/i.test((s ?? "").trim());

export function useReportTypes(enabled = true) {
  return useQuery({ queryKey: keys.reports, queryFn: ({ signal }) => http.get<ReportTypesResponse>(`${BASE}/reports`, { signal }), enabled, staleTime: STALE.long, retry: false });
}

export function useReportPreview(q: ReportQuery | null) {
  return useQuery({
    queryKey: ["propreports", "api-v2", "report", q],
    queryFn: ({ signal }) => http.get<ReportPreview>(`${BASE}/report`, { query: { ...q!, format: "json" }, signal }),
    enabled: !!q,
    staleTime: STALE.short,
    retry: false,
  });
}

/** Fetch the CSV through the API client (auth + error body) and hand it to the browser as a file. */
export async function downloadReport(q: ReportQuery): Promise<void> {
  const res = await http.raw(`${BASE}/report`, { query: { ...q, format: "csv" } });
  const url = URL.createObjectURL(await res.blob());
  try {
    downloadBlob(url, `propreports-${q.type}-${q.from}_${q.to}.csv`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function useLocates(q: { from: string; to: string; accountId?: string; page?: number } | null) {
  return useQuery({
    queryKey: keys.locates(q ?? {}),
    queryFn: ({ signal }) => http.get<{ from: string; to: string; locates: LocateRow[]; page: PageInfo }>(`${BASE}/locates`, { query: q ?? {}, signal }),
    enabled: !!q,
    staleTime: STALE.short,
    retry: false,
  });
}

/** A 403 on a superuser action: the server remembered "not superuser" — re-read its answer. */
export function isSuperuserRequired(err: unknown): boolean {
  return isApiError(err) && err.code === "PROPREPORTS_SUPERUSER_REQUIRED";
}

export function useRefreshSuperuser() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: keys.superuser }), [qc]);
}

export function useSuperuser(enabled = true) {
  return useQuery({ queryKey: keys.superuser, queryFn: ({ signal }) => http.get<SuperuserState>(`${BASE}/superuser`, { signal }), enabled, staleTime: STALE.long, retry: false });
}

export function useCheckSuperuser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<SuperuserState>(`${BASE}/superuser/check`),
    onSuccess: (s) => qc.setQueryData(keys.superuser, s),
  });
}

export function useUploadSearch(q: UploadSearchQuery, enabled = true) {
  return useQuery({
    queryKey: keys.uploads(q),
    queryFn: ({ signal }) => http.get<{ uploads: UploadSummary[]; page: PageInfo }>(`${BASE}/uploads`, { query: { ...q, status: q.status?.join(",") }, signal }),
    enabled,
    staleTime: STALE.short,
    retry: false,
  });
}

/** Polls while the upload is still in the queue. */
export function useUploadStatus(uploadId: string | null) {
  return useQuery({
    queryKey: keys.status(uploadId ?? ""),
    queryFn: ({ signal }) => http.get<{ summaries: UploadSummary[]; details: UploadDetail[] }>(`${BASE}/uploads/status`, { query: { uploadId: uploadId! }, signal }),
    enabled: !!uploadId,
    refetchInterval: (q) => (isUploadRunning(q.state.data?.summaries[0]?.status) ? POLL.live : false),
    retry: false,
  });
}

export function useUploadMessages(uploadId: string | null) {
  return useQuery({
    queryKey: keys.messages(uploadId ?? ""),
    queryFn: ({ signal }) => http.get<UploadMessages>(`${BASE}/uploads/${uploadId}/messages`, { signal }),
    enabled: !!uploadId,
    retry: false,
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: UploadForm) => {
      const fd = new FormData();
      fd.append("file", f.file);
      fd.append("type", f.type);
      for (const k of ["sourceId", "clearingFirmId", "replacementKey", "processingMode", "reconciliationMode"] as const) if (f[k]) fd.append(k, String(f[k]));
      if (f.forceDuplicateProcessing != null) fd.append("forceDuplicateProcessing", f.forceDuplicateProcessing ? "true" : "false");
      return http.post<{ uploads: UploadSummary[] }>(`${BASE}/upload`, fd);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}
