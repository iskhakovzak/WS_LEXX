/** The memoised capital plan (lib/capital/service capitalPlan); every decision / revert drops it so the page refetches fresh. */
let drop: (() => void) | null = null;

export function onCapitalCacheDrop(fn: () => void): void {
  drop = fn;
}

export function dropCapitalCache(): void {
  drop?.();
}
