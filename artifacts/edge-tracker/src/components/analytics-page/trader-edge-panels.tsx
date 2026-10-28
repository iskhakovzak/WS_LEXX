import { EdgeMapPanel } from "@/components/shared/edge-map/edge-verdicts";
import { CatalystEdgePanel } from "@/components/shared/strategy/catalyst-edge-panel";
import { SessionFlowPanel } from "@/components/shared/session-flow/flow-panel";
import { IdeasPanel } from "@/components/shared/session-flow/ideas-panel";

/**
 * The «Эдж» tab's panels about ONE trader's book (own, or the trader a staff member picked): the edge map verdicts
 * (roadmap R4), the catalyst slice and the session flow (re-entries, chase, give-back, green-to-red, timing).
 */
export function TraderEdgePanels({ trader, from, to }: { trader: string | null; from: string | null; to: string | null }) {
  return (
    <>
      <EdgeMapPanel trader={trader} />
      <CatalystEdgePanel trader={trader} from={from} to={to} />
      <SessionFlowPanel trader={trader} from={from} to={to} />
      <IdeasPanel trader={trader} from={from} to={to} />
    </>
  );
}
