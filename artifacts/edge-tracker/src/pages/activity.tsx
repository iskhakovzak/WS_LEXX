/**
 * /activity — the team activity feed moved into /notifications as the «Команда» tab (design audit wave 2). Old links
 * and bookmarks land there; ?trader= / ?section= are kept (components/team/team-activity reads them).
 */
import { Redirect, useSearch } from "wouter";

export default function ActivityRedirect() {
  const p = new URLSearchParams(useSearch());
  p.set("tab", "team");
  return <Redirect to={`/notifications?${p.toString()}`} replace />;
}
