/**
 * Coaching statistics (ALGORITHMS.md P1–P3), pure and seeded: the edge map (lib/edgeMap.ts), the plateau detector
 * (lib/plateau.ts) and the curator priority (lib/curatorLogic.ts) build on these. P4–P8 (sequential tests, CUSUM,
 * change points, projections, causal designs) plug in here when R5 / R8 / R9b / R12 / R13 land.
 * lib/stats/aggregate.ts (the /stats server aggregates) is unrelated and not re-exported.
 */
export * from "./rng";
export * from "./normal";
export * from "./bootstrap";
export * from "./shrinkage";
export * from "./multipleTesting";
