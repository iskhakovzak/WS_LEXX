/**
 * /integrations «API» tab (staff, broker API configured): PropReports reports + download, locates, and — for a
 * superuser token — uploads to PropReports. Mounted by pages/integrations.tsx with one line.
 */
import type { AccountMapping } from "./api";
import { LocatesPanel, ReportsPanel } from "./api-v2-reports";
import { SuperuserUploads } from "./api-v2-uploads";

export default function ApiV2Panel({ accounts, canSync }: { accounts: AccountMapping[]; canSync: boolean }) {
  return (
    <div className="space-y-4">
      <ReportsPanel accounts={accounts} />
      <LocatesPanel accounts={accounts} />
      <SuperuserUploads canSync={canSync} />
    </div>
  );
}
