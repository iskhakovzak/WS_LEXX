import pg from 'pg';
const { Pool } = pg;

const SUPABASE_URL = 'https://egrxucyrgcqaubjnzzxs.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY environment variable is not set');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function dbQuery(sql) {
  const { rows } = await pool.query(sql);
  return rows;
}

function cleanRow(row) {
  const r = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) r[k] = v.toISOString();
    else r[k] = v;
  }
  return r;
}

async function sbInsert(table, rows) {
  if (!rows.length) { console.log(`  ${table}: пусто, пропускаем`); return 0; }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map(cleanRow);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(batch)
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`  ОШИБКА ${table} batch ${i}: ${err.substring(0, 250)}`);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ✓ ${table}: ${inserted} записей`);
  return inserted;
}

async function main() {
  console.log('🚀 Начинаем миграцию Replit → Supabase...\n');

  const tables = [
    'users',
    'trades',
    'market_events',
    'research',
    'daily_feed',
    'discussions',
    'comments',
    'watchlist',
    'playbook',
    'playbook_trade_ideas',
    'activity_log',
    'trade_reactions',
    'trade_reviews',
    'trading_errors',
    'big7_levels',
    'big7_catalysts',
    'trader_ratings',
    'war_room_sessions',
    'war_room_levels',
  ];

  let total = 0;
  for (const t of tables) {
    try {
      const rows = await dbQuery(`SELECT * FROM ${t} ORDER BY id`);
      const n = await sbInsert(t, rows);
      total += n;
    } catch (e) {
      console.error(`  ОШИБКА чтения ${t}: ${e.message}`);
    }
  }

  await pool.end();
  console.log(`\n✅ Готово! Перенесено ${total} записей суммарно.`);
}

main().catch(console.error);
