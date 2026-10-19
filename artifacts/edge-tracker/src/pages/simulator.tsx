/**
 * /simulator moved into «Тренажёр» (/trainer). Old links keep working: the same query and hash go to /trainer
 * (`?game=`, `?own=`), and the older «Что если» links (?r=…, ?p=…, ?trader=…, #fees) go to /what-if.
 */
import * as React from "react";
import { useLocation, useSearch } from "wouter";
import { simulatorTarget } from "@/components/sim/trainer-api";

export default function SimulatorRedirect() {
  const [, navigate] = useLocation();
  const search = useSearch();
  React.useEffect(() => { navigate(simulatorTarget(search, window.location.hash), { replace: true }); }, [search, navigate]);
  return null;
}
