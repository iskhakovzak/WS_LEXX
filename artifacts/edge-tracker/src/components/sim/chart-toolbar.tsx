/**
 * The row over the game chart: timeframe (keys 1–4) + the daily panel (Д), how far the forming candle is, the overlay
 * chips (levels, VWAP / MA), and on series games the decisions «Не торгую (T)» (only while flat with no trade yet)
 * and «Пропустить (N)».
 */
import { Ban, Layers, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip, Segmented } from "@/components/ds";
import { simI18n } from "@/i18n/ns/simulator";
import type { ChartToggles } from "./sim-chart";
import type { DisplayTf } from "./tf-model";

const noFocus = (e: { preventDefault: () => void }) => e.preventDefault();

export function ChartToolbar({
  tfs, tf, setTf, fine, intraday, canDaily, showDaily, toggleDaily, forming, toggles, setToggles, onNoTrade, onSkip,
}: {
  tfs: readonly DisplayTf[];
  tf: DisplayTf | null;
  setTf: (tf: DisplayTf) => void;
  fine: boolean;
  intraday: boolean;
  canDaily: boolean;
  showDaily: boolean;
  toggleDaily: () => void;
  /** The forming candle (null on the base tf / after the finish). */
  forming: { have: number; need: number } | null;
  toggles: ChartToggles;
  setToggles: (v: ChartToggles) => void;
  /** Present only when «Не торгую» is possible right now. */
  onNoTrade?: (() => void) | null;
  onSkip?: (() => void) | null;
}) {
  const { t } = simI18n.useT();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tfs.length > 1 && tf && (
        <Segmented
          size="sm" ariaLabel={t("tf.label")} value={tf}
          onChange={(v) => setTf(v as DisplayTf)}
          options={tfs.map((x, i) => ({ value: x, label: x, title: fine ? t("tf.keyHint", { tf: x, key: String(i + 1) }) : x }))}
        />
      )}
      {canDaily && <FilterChip size="sm" active={showDaily} onClick={toggleDaily} title={t("tf.dailyHint")}>{t("tf.daily")}</FilterChip>}
      {forming && tf && (
        <span className="px-1 text-2xs tabular-nums text-muted-foreground" title={t("tf.formingHint")} data-testid="sim-forming">
          {t("tf.forming", { tf, have: forming.have, need: forming.need })}
        </span>
      )}
      <div className="flex items-center gap-1">
        <FilterChip size="sm" active={toggles.levels} onClick={() => setToggles({ ...toggles, levels: !toggles.levels })}><Layers aria-hidden="true" className="h-3.5 w-3.5" />{t("chart.levels")}</FilterChip>
        {intraday
          ? <FilterChip size="sm" active={toggles.vwap} onClick={() => setToggles({ ...toggles, vwap: !toggles.vwap })}>{t("chart.vwap")}</FilterChip>
          : <FilterChip size="sm" active={toggles.ma} onClick={() => setToggles({ ...toggles, ma: !toggles.ma })}>{t("chart.ma")}</FilterChip>}
      </div>
      {(onNoTrade || onSkip) && (
        <div className="ml-auto flex items-center gap-1.5">
          {onNoTrade && (
            <Button onPointerDown={noFocus} variant="outline" size="sm" onClick={onNoTrade} aria-keyshortcuts="T" title={t("flow.noTradeHint", { key: "T" })} data-testid="sim-no-trade">
              <Ban aria-hidden="true" /> {t("flow.noTrade")}{fine && <span className="text-2xs text-muted-foreground">T</span>}
            </Button>
          )}
          {onSkip && (
            <Button onPointerDown={noFocus} variant="ghost" size="sm" onClick={onSkip} aria-keyshortcuts="N" title={t("flow.skipHint", { key: "N" })} data-testid="sim-skip">
              <SkipForward aria-hidden="true" /> {t("flow.skip")}{fine && <span className="text-2xs text-muted-foreground">N</span>}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
