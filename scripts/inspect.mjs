import XLSX from 'xlsx';
const wb = XLSX.readFile('/home/runner/workspace/attached_assets/31206881-2026-01-30-to-2026-04-30-trades_1777924661108.xls');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
let dateHeaders = 0, headerRows = 0, tradeRows = 0, subtotalRows = 0, otherRows = 0;
const otherSamples = [];
const dateHeaderSamples = [];
rows.forEach((r, i) => {
  if (!r || r.length === 0) return;
  if (r[0] === 'Opened' && r[1] === 'Closed') { headerRows++; return; }
  if (r[0] === 'Equities') { subtotalRows++; if (subtotalRows < 5) console.log('SUBTOTAL row', i, JSON.stringify(r)); return; }
  if (typeof r[0] === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(r[0])) { dateHeaders++; if (dateHeaders <= 3) dateHeaderSamples.push([i, r]); return; }
  if (typeof r[0] === 'string' && /^\d{2}\/\d{2}\/\d{2}/.test(r[0])) { tradeRows++; return; }
  otherRows++;
  if (otherSamples.length < 8) otherSamples.push([i, r]);
});
console.log('Total rows:', rows.length);
console.log('Date headers:', dateHeaders, 'Header rows:', headerRows, 'Trade rows:', tradeRows, 'Subtotal:', subtotalRows, 'Other:', otherRows);
console.log('\nDate header samples:'); dateHeaderSamples.forEach(([i,r])=>console.log(i, JSON.stringify(r)));
console.log('\nOther row samples:'); otherSamples.forEach(([i,r])=>console.log(i, JSON.stringify(r)));
// Symbol distribution
const sym = {};
rows.forEach(r => { if (r && typeof r[0]==='string' && /^\d{2}\/\d{2}\/\d{2}/.test(r[0])) sym[r[3]]=(sym[r[3]]||0)+1; });
console.log('\nUnique symbols:', Object.keys(sym).length);
console.log('Top 15:', Object.entries(sym).sort((a,b)=>b[1]-a[1]).slice(0,15));
// Date range
const dates = new Set();
rows.forEach(r => { if (r && typeof r[0]==='string' && /^\d{2}\/\d{2}\/\d{2}/.test(r[0])) dates.add(r[0].slice(0,8)); });
const sorted = [...dates].sort();
console.log('\nDate range:', sorted[0], '-', sorted[sorted.length-1], '| trading days:', dates.size);
console.log('Sample trade row:', JSON.stringify(rows[1]));
