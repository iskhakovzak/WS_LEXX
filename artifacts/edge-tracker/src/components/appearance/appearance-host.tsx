/** Mounts the «Вид» dialog (a lazy chunk, fetched on the first open) and the background layer. Rendered by the layout. */
import * as React from "react";
import { useAppearance } from "@/contexts/appearance-context";
import { appearanceI18n } from "@/i18n/ns/appearance";
import { BackdropLayer } from "./backdrop-layer";

const AppearanceDialog = React.lazy(() => appearanceI18n.ready().then(() => import("./appearance-dialog")));

export function AppearanceHost() {
  const { open } = useAppearance();
  const [mounted, setMounted] = React.useState(open);
  React.useEffect(() => { if (open) setMounted(true); }, [open]);
  return (
    <>
      <BackdropLayer />
      {mounted && (
        <React.Suspense fallback={null}>
          <AppearanceDialog />
        </React.Suspense>
      )}
    </>
  );
}

export { GuardMeter } from "./guard-meter";
