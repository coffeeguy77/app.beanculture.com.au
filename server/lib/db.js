// Tiny persistence layer for admin-editable settings.
// Stores a single JSON blob in Postgres and keeps an in-memory cache so
// getSettings() can stay synchronous. Degrades gracefully with no DATABASE_URL.

let pool = null;
let cache = {};
let ready = false;

async function init() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db] DATABASE_URL not set — admin settings will not persist.');
    return;
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
      max: 3,
    });
    await pool.query(
      'CREATE TABLE IF NOT EXISTS app_settings (id text primary key, data jsonb not null default \'{}\'::jsonb)'
    );
    const r = await pool.query("SELECT data FROM app_settings WHERE id = 'main'");
    cache = (r.rows[0] && r.rows[0].data) || {};
    ready = true;
    console.log('[db] connected; settings overrides loaded');
  } catch (e) {
    console.error('[db] init failed:', e.message);
    pool = null;
  }
}

function getOverrides() {
  return cache || {};
}

async function saveOverrides(obj) {
  cache = obj || {};
  if (!pool) throw new Error('No database configured (DATABASE_URL missing)');
  await pool.query(
    "INSERT INTO app_settings (id, data) VALUES ('main', $1) ON CONFLICT (id) DO UPDATE SET data = $1",
    [cache]
  );
}

module.exports = { init, getOverrides, saveOverrides, get enabled() { return !!pool; } };
