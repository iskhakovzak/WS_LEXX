/**
 * PropReports accuracy block — the ONE component CORE mounts (pages/integrations.tsx, admin «Данные»):
 *   import ReconcileBrokerPanel from "@/components/propreports/reconcile-broker";
 *   <ReconcileBrokerPanel />
 * Staff (propreports.read.team): the nightly per-account reconciliation (acknowledge with propreports.sync) and the
 * desk's broker adjustments. Everyone else: their own broker adjustments only.
 */
import { useAuth } from "@/contexts/auth-context";
import { BrokerReconcileDays } from "./reconcile-broker-panel";
import { BrokerAdjustmentsCard } from "./reconcile-broker-adjustments";

export default function ReconcileBrokerPanel() {
  const { can } = useAuth();
  const staff = can("propreports.read.team");
  return (
    <div className="grid gap-4">
      {staff && <BrokerReconcileDays canAcknowledge={can("propreports.sync")} />}
      <BrokerAdjustmentsCard trader={null} />
    </div>
  );
}

export { BrokerReconcileDays, BrokerAdjustmentsCard };
