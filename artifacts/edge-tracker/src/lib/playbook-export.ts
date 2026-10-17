import JSZip from "jszip";

export type ExportEntry = {
  id: number;
  name: string;
  folder: string | null;
  setupType: string | null;
  conditions: string | null;
  checklist: string | null;
  notes: string | null;
  confidenceLevel: number | null;
  screenshotUrl: string | null;
  screenshotNotes: string | null;
  tags: string | null;
  createdAt: string;
  parentId: number | null;
  ticker: string | null;
  marketCap: string | null;
  float: string | null;
  adv: string | null;
  atr: number | null;
  relativeVolume: number | null;
  beta: number | null;
  shortInterest: number | null;
  sector: string | null;
  longName: string | null;
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
}

function parseScreenshots(rawUrl: string | null, rawNotes: string | null): { url: string; note: string }[] {
  if (!rawUrl) return [];
  const urls = rawUrl.split("\n").map(u => u.trim()).filter(Boolean);
  let notes: string[] = [];
  if (rawNotes) {
    try { notes = JSON.parse(rawNotes); } catch { notes = []; }
  }
  return urls.map((url, i) => ({ url, note: notes[i] ?? "" }));
}

function renderFundamentalsTable(e: ExportEntry): string {
  const rows: [string, string][] = [];
  if (e.ticker) rows.push(["Тикер", e.longName ? `${e.ticker} — ${e.longName}` : e.ticker]);
  if (e.sector) rows.push(["Сектор", e.sector]);
  if (e.marketCap) rows.push(["Market Cap", e.marketCap]);
  if (e.float) rows.push(["Float", e.float]);
  if (e.adv) rows.push(["ADV", e.adv]);
  if (e.atr != null) rows.push(["ATR", String(e.atr)]);
  if (e.relativeVolume != null) rows.push(["Rel. Volume", `${e.relativeVolume}x`]);
  if (e.beta != null) rows.push(["Beta", String(e.beta)]);
  if (e.shortInterest != null) rows.push(["Short Interest", `${e.shortInterest}%`]);
  if (!rows.length) return "";
  return `| Параметр | Значение |\n| --- | --- |\n${rows.map(([k, v]) => `| ${k} | ${v} |`).join("\n")}\n`;
}

function renderChecklist(raw: string | null): string {
  if (!raw?.trim()) return "";
  const items = raw.split("\n").map(l => l.trim()).filter(Boolean);
  return items.map(item => `- [ ] ${item.replace(/^[-•*]\s*/, "")}`).join("\n");
}

function renderScreenshots(rawUrl: string | null, rawNotes: string | null, embed: boolean): string {
  const shots = parseScreenshots(rawUrl, rawNotes);
  if (!shots.length) return "";
  if (embed) {
    return shots.map(s => s.note ? `![${s.note}](${s.url})\n*${s.note}*` : `![скриншот](${s.url})`).join("\n\n");
  }
  return shots.map(s => s.note ? `- [${s.note}](${s.url})` : `- ${s.url}`).join("\n");
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Split entries into top-level parents + children map. Children whose parent is missing
 *  (e.g. parent was deleted) are treated as top-level so they are not silently dropped. */
function splitHierarchy(entries: ExportEntry[]): { parents: ExportEntry[]; childrenMap: Map<number, ExportEntry[]> } {
  const ids = new Set(entries.map(e => e.id));
  const parents = entries.filter(e => !e.parentId || !ids.has(e.parentId));
  const childrenMap = new Map<number, ExportEntry[]>();
  for (const e of entries) {
    if (e.parentId && ids.has(e.parentId)) {
      if (!childrenMap.has(e.parentId)) childrenMap.set(e.parentId, []);
      childrenMap.get(e.parentId)!.push(e);
    }
  }
  return { parents, childrenMap };
}

/** Folder names in the user's display order (if given), then any remaining ones. */
function orderFolders(parents: ExportEntry[], folderOrder?: string[]): string[] {
  const present = Array.from(new Set(parents.map(e => e.folder).filter(Boolean))) as string[];
  if (!folderOrder?.length) return present;
  const ordered = folderOrder.filter(f => present.includes(f));
  return [...ordered, ...present.filter(f => !ordered.includes(f))];
}

// ── Standard Markdown export (single file) ─────────────────────────────────

function renderEntryMd(e: ExportEntry, level: number): string {
  const h = "#".repeat(level);
  const lines: string[] = [];

  lines.push(`${h} ${e.name}`);
  lines.push("");

  const meta: string[] = [];
  if (e.setupType) meta.push(`**Тип:** ${e.setupType}`);
  if (e.confidenceLevel != null) meta.push(`**Уверенность:** ${e.confidenceLevel}%`);
  if (e.tags) {
    const chips = e.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (chips.length) meta.push(`**Теги:** ${chips.map(t => `\`${t}\``).join(" ")}`);
  }
  meta.push(`**Добавлен:** ${fmtDate(e.createdAt)}`);
  if (meta.length) { lines.push(meta.join("  \n")); lines.push(""); }

  const fund = renderFundamentalsTable(e);
  if (fund) { lines.push(fund); }

  if (e.conditions?.trim()) {
    lines.push(`**Условия входа:**`);
    lines.push(e.conditions.trim());
    lines.push("");
  }

  const cl = renderChecklist(e.checklist);
  if (cl) {
    lines.push(`**Чеклист:**`);
    lines.push(cl);
    lines.push("");
  }

  if (e.notes?.trim()) {
    lines.push(`**Заметки:**`);
    lines.push(e.notes.trim());
    lines.push("");
  }

  const shots = renderScreenshots(e.screenshotUrl, e.screenshotNotes, false);
  if (shots) {
    lines.push(`**Скриншоты:**`);
    lines.push(shots);
    lines.push("");
  }

  return lines.join("\n");
}

export function generatePlaybookMarkdown(entries: ExportEntry[], folderOrder?: string[]): string {
  const { parents, childrenMap } = splitHierarchy(entries);
  const folders = orderFolders(parents, folderOrder);
  const unfiled = parents.filter(e => !e.folder);
  const now = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  const out: string[] = [];
  out.push("# WS_LEXX — Плейбук");
  out.push(`> Экспортировано: ${now} · Всего: ${parents.length} ${plural(parents.length, "сетап", "сетапа", "сетапов")} · Дочерних: ${entries.length - parents.length}`);
  out.push("");
  out.push("---");
  out.push("");

  function appendFolder(folderName: string | null, items: ExportEntry[]) {
    if (folderName) { out.push(`## 📁 ${folderName}`); out.push(""); }
    else if (folders.length > 0) { out.push(`## 📂 Без папки`); out.push(""); }
    const seen = new Set<number>();
    function appendWithChildren(e: ExportEntry, level: number) {
      if (seen.has(e.id)) return; // guard against parent cycles
      seen.add(e.id);
      out.push(renderEntryMd(e, Math.min(level, 6)));
      for (const child of childrenMap.get(e.id) || []) appendWithChildren(child, level + 1);
    }
    for (const parent of items) {
      appendWithChildren(parent, 3);
      out.push("---");
      out.push("");
    }
  }

  for (const folder of folders) appendFolder(folder, parents.filter(e => e.folder === folder));
  if (unfiled.length) appendFolder(null, unfiled);

  return out.join("\n");
}

// ── Notion ZIP export ───────────────────────────────────────────────────────

function renderEntryNotion(e: ExportEntry, level: number, childrenMap: Map<number, ExportEntry[]>, seen: Set<number> = new Set()): string {
  seen.add(e.id);
  const h = "#".repeat(Math.min(level, 6));
  const lines: string[] = [];

  lines.push(`${h} ${e.name}`);
  lines.push("");

  // Meta block
  const meta: string[] = [];
  if (e.setupType) meta.push(`**Тип сетапа:** ${e.setupType}`);
  if (e.confidenceLevel != null) meta.push(`**Уверенность:** ${e.confidenceLevel}%`);
  if (e.ticker) meta.push(`**Тикер:** ${e.longName ? `${e.ticker} — ${e.longName}` : e.ticker}`);
  if (e.sector) meta.push(`**Сектор:** ${e.sector}`);
  if (e.tags) {
    const chips = e.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (chips.length) meta.push(`**Теги:** ${chips.map(t => `\`${t}\``).join(" ")}`);
  }
  meta.push(`**Добавлен:** ${fmtDate(e.createdAt)}`);
  if (meta.length) { lines.push(meta.join("  \n")); lines.push(""); }

  // Fundamentals table
  const fund = renderFundamentalsTable(e);
  if (fund) { lines.push("### 📊 Фундаментал"); lines.push(""); lines.push(fund); }

  // Conditions
  if (e.conditions?.trim()) {
    lines.push("### 📋 Условия входа");
    lines.push("");
    lines.push(e.conditions.trim());
    lines.push("");
  }

  // Checklist
  const cl = renderChecklist(e.checklist);
  if (cl) {
    lines.push("### ✅ Чеклист");
    lines.push("");
    lines.push(cl);
    lines.push("");
  }

  // Notes
  if (e.notes?.trim()) {
    lines.push("### 💡 Заметки");
    lines.push("");
    lines.push(e.notes.trim());
    lines.push("");
  }

  // Screenshots — embedded as images for Notion
  const shots = parseScreenshots(e.screenshotUrl, e.screenshotNotes);
  if (shots.length) {
    lines.push("### 🖼 Скриншоты");
    lines.push("");
    for (const { url, note } of shots) {
      lines.push(`![${note || "скриншот"}](${url})`);
      if (note) lines.push(`*${note}*`);
      lines.push("");
    }
  }

  // Children inline (within same page)
  const children = childrenMap.get(e.id) || [];
  if (children.length) {
    lines.push("---");
    lines.push("");
    for (const child of children) {
      if (seen.has(child.id)) continue; // guard against parent cycles
      lines.push(renderEntryNotion(child, level + 1, childrenMap, seen));
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function generateNotionZip(entries: ExportEntry[], folderOrder?: string[]): Promise<Blob> {
  const zip = new JSZip();
  const { parents, childrenMap } = splitHierarchy(entries);
  const folders = orderFolders(parents, folderOrder);
  const unfiled = parents.filter(e => !e.folder);
  const now = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const totalChildren = entries.length - parents.length;

  // Index page
  const indexLines: string[] = [];
  indexLines.push("# WS_LEXX — Плейбук");
  indexLines.push("");
  indexLines.push(`> Экспортировано: ${now}`);
  indexLines.push(`> Папок: ${folders.length} · Сетапов: ${parents.length} · Дочерних: ${totalChildren}`);
  indexLines.push("");
  indexLines.push("## Папки");
  indexLines.push("");
  for (const f of folders) {
    const count = parents.filter(e => e.folder === f).length;
    const childCount = parents.filter(e => e.folder === f).reduce((acc, p) => acc + (childrenMap.get(p.id)?.length ?? 0), 0);
    indexLines.push(`- **${f}** — ${count} ${plural(count, "сетап", "сетапа", "сетапов")}${childCount ? ` (+ ${childCount} дочерних)` : ""}`);
  }
  if (unfiled.length) {
    indexLines.push(`- **Без папки** — ${unfiled.length} ${plural(unfiled.length, "сетап", "сетапа", "сетапов")}`);
  }
  zip.file("Playbook.md", indexLines.join("\n"));

  // One .md file per folder
  function buildFolderPage(folderName: string | null, items: ExportEntry[]): string {
    const title = folderName ? `📁 ${folderName}` : "📂 Без папки";
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`*${items.length} ${plural(items.length, "сетап", "сетапа", "сетапов")} ·${items.reduce((acc, p) => acc + (childrenMap.get(p.id)?.length ?? 0), 0)} дочерних*`);
    lines.push("");
    lines.push("---");
    lines.push("");
    for (const parent of items) {
      lines.push(renderEntryNotion(parent, 2, childrenMap));
      lines.push("---");
      lines.push("");
    }
    return lines.join("\n");
  }

  // Unique file names (case-insensitive): a folder named "Playbook" or two folders differing only
  // by "/" vs ":" must not overwrite each other or the index page.
  const usedNames = new Set<string>(["playbook"]);
  function uniqueName(base: string): string {
    const root = base.trim() || "Папка";
    let name = root;
    let i = 2;
    while (usedNames.has(name.toLowerCase())) name = `${root} (${i++})`;
    usedNames.add(name.toLowerCase());
    return `${name}.md`;
  }
  for (const folder of folders) {
    const items = parents.filter(e => e.folder === folder);
    const safe = folder.replace(/[/\\:*?"<>|]/g, "_");
    zip.file(uniqueName(safe), buildFolderPage(folder, items));
  }
  if (unfiled.length) {
    zip.file(uniqueName("Без папки"), buildFolderPage(null, unfiled));
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

// ── Download helpers ────────────────────────────────────────────────────────

export function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  triggerDownload(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
