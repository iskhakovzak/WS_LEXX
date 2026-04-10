/**
 * WS_LEXX Database Migration: Replit PostgreSQL → Supabase
 * Run: node artifacts/backups/migrate_to_supabase.mjs
 */

import pg from 'pg';
const { Pool } = pg;

const SUPABASE_URL = 'https://egrxucyrgcqaubjnzzxs.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REPLIT_DB = process.env.DATABASE_URL;

if (!SERVICE_KEY || !REPLIT_DB) {
  console.error('Set SUPABASE_SERVICE_KEY and DATABASE_URL env vars');
  process.exit(1);
}

const pool = new Pool({ connectionString: REPLIT_DB });

async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function sbInsert(table, rows, idField = 'id') {
  if (!rows.length) { console.log(`  ${table}: empty, skipping`); return; }
  
  // Insert in batches of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
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
      console.error(`  ERROR inserting into ${table}: ${err.substring(0, 200)}`);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ✓ ${table}: ${inserted} rows`);
}

async function resetSequence(table) {
  // After inserting with explicit IDs, reset the serial sequence
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/setval`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sequence_name: `${table}_id_seq` })
  });
}

async function main() {
  console.log('🚀 Starting migration from Replit → Supabase...\n');

  const tables = [
    { name: 'users', sql: 'SELECT * FROM users ORDER BY id' },
    { name: 'trades', sql: 'SELECT * FROM trades ORDER BY id' },
    { name: 'market_events', sql: 'SELECT * FROM market_events ORDER BY id' },
    { name: 'research', sql: 'SELECT * FROM research ORDER BY id' },
    { name: 'daily_feed', sql: 'SELECT * FROM daily_feed ORDER BY id' },
    { name: 'discussions', sql: 'SELECT * FROM discussions ORDER BY id' },
    { name: 'comments', sql: 'SELECT * FROM comments ORDER BY id' },
    { name: 'watchlist', sql: 'SELECT * FROM watchlist ORDER BY id' },
    { name: 'playbook', sql: 'SELECT * FROM playbook ORDER BY id' },
    { name: 'playbook_trade_ideas', sql: 'SELECT * FROM playbook_trade_ideas ORDER BY id' },
    { name: 'activity_log', sql: 'SELECT * FROM activity_log ORDER BY id' },
    { name: 'trade_reactions', sql: 'SELECT * FROM trade_reactions ORDER BY id' },
    { name: 'trade_reviews', sql: 'SELECT * FROM trade_reviews ORDER BY id' },
    { name: 'trading_errors', sql: 'SELECT * FROM trading_errors ORDER BY id' },
    { name: 'big7_levels', sql: 'SELECT * FROM big7_levels ORDER BY id' },
    { name: 'big7_catalysts', sql: 'SELECT * FROM big7_catalysts ORDER BY id' },
    { name: 'trader_ratings', sql: 'SELECT * FROM trader_ratings ORDER BY id' },
    { name: 'war_room_sessions', sql: 'SELECT * FROM war_room_sessions ORDER BY id' },
    { name: 'war_room_levels', sql: 'SELECT * FROM war_room_levels ORDER BY id' },
  ];

  for (const t of tables) {
    try {
      const rows = await query(t.sql);
      // Convert dates to ISO strings
      const cleaned = rows.map(row => {
        const r = {};
        for (const [k, v] of Object.entries(row)) {
          if (v instanceof Date) r[k] = v.toISOString();
          else r[k] = v;
        }
        return r;
      });
      await sbInsert(t.name, cleaned);
    } catch (e) {
      console.error(`  ERROR reading ${t.name}: ${e.message}`);
    }
  }

  // Reset sequences
  console.log('\n🔧 Resetting sequences...');
  for (const t of tables) {
    try {
      const rows = await query(`SELECT MAX(id) as maxid FROM ${t.name}`);
      const maxId = rows[0]?.maxid;
      if (maxId) {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/setval_seq`, {
          method: 'POST',
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tbl: t.name, val: maxId + 1 })
        });
      }
    } catch {}
  }

  await pool.end();
  console.log('\n✅ Migration complete!');
}

main().catch(console.error);
