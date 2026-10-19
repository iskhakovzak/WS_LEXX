/**
 * «Серия из 10» context: the result views rendered inside the game screen (ResultSummary, OwnResultSummary) read the
 * series progress, the no-trade verdict and «Дальше: серия из 10» from here, so the game screen needs no extra
 * props. Outside a provider (tests, other pages) everything is off and the views behave as before.
 */
import * as React from "react";
import { usePersistentState } from "@/components/ds";
import type { NoTradeVerdict, SeriesState } from "./series-api";
import { choiceOf, type FreeTf, type SeriesChoice } from "./series-model";
import type { Difficulty } from "./api";

export type SeriesCtx = {
  series: SeriesState | null;
  /** The no-trade verdict of a game decided with «Не торгую» in this session. */
  verdictOf: (gameId: number) => NoTradeVerdict | null;
  /** Start a new series with the remembered level / bar size (the end of «Задача дня», «Мои дни», a summary). */
  startSeries: () => void;
  starting: boolean;
};

const Ctx = React.createContext<SeriesCtx | null>(null);
export const SeriesProvider = Ctx.Provider;
export const useSeriesCtx = () => React.useContext(Ctx);

const LEVEL_KEY = "sim.level";
const TF_KEY = "trainer.freeTf";

function stored(key: string): unknown {
  try {
    const raw = localStorage.getItem(`ws_lexx.${key}`);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The remembered choice read at call time (the home card may have changed it since this page mounted). */
export const readSeriesChoice = (): SeriesChoice => choiceOf(stored(LEVEL_KEY), stored(TF_KEY));

/** The last free-play choice (level + bar size), shared by the home card and «Дальше: серия из 10». */
export function useSeriesChoice(): { choice: SeriesChoice; level: Difficulty; tf: FreeTf; setLevel: (v: Difficulty) => void; setTf: (v: FreeTf) => void } {
  const [levelRaw, setLevel] = usePersistentState<Difficulty>(LEVEL_KEY, "easy");
  const [tfRaw, setTf] = usePersistentState<FreeTf>(TF_KEY, "5m");
  const choice = choiceOf(levelRaw, tfRaw);
  return { choice, level: choice.difficulty, tf: choice.tf ?? "1d", setLevel, setTf };
}
