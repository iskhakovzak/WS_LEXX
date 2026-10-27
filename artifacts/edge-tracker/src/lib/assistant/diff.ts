/**
 * Word-level diff for «✦ Помочь» suggestions (pure): which words the suggestion keeps, drops and adds, so the person
 * sees the change before accepting it. LCS over tokens (words + whitespace); big inputs fall back to a coarse
 * «everything replaced» diff to stay fast.
 */

export type DiffPart = { kind: "same" | "add" | "del"; text: string };

const MAX_CELLS = 1_500_000;

export function tokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (!a.length && !b.length) return [];
  if (a.length * b.length > MAX_CELLS) return [...(before ? [{ kind: "del" as const, text: before }] : []), ...(after ? [{ kind: "add" as const, text: after }] : [])];
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { push("same", a[i]!); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { push("del", a[i]!); i++; }
    else { push("add", b[j]!); j++; }
  }
  while (i < m) push("del", a[i++]!);
  while (j < n) push("add", b[j++]!);
  return out;
}

/** True when the suggestion changes nothing but whitespace. */
export function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}
