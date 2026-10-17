export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  value = Number(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always",
  }).format(value);
}

export function downloadBlob(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        values.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    values.push(cur);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? "").trim(); });
    return obj;
  });
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "0%";
  value = Number(value);
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  // Date-only strings are UTC midnight to Date(); read them as local dates so the day doesn't shift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateString);
  // Intl.format throws RangeError on an invalid date, which would crash the whole page.
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "0";
  return new Intl.NumberFormat("en-US").format(Number(value));
}
