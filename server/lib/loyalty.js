// Square Loyalty: read the program's reward tiers, look up a customer's points
// balance by phone, and redeem points against an order (create a loyalty reward
// tied to order_id; Square auto-redeems when the order is paid via Square).

const { squareFetch, LOCATION_ID, idem } = require('./squareClient');
const { normalizePhone } = require('./customers');

let programCache = { data: null, at: 0 };

async function getProgram() {
  const now = Date.now();
  if (programCache.data && now - programCache.at < 5 * 60 * 1000) return programCache.data;
  try {
    const data = await squareFetch('/v2/loyalty/programs/main');
    const p = data.program;
    if (!p || p.status !== 'ACTIVE') {
      programCache = { data: { active: false, tiers: [], terminology: null }, at: now };
      return programCache.data;
    }
    const tiers = (p.reward_tiers || []).map((t) => ({
      id: t.id,
      name: t.name,
      points: t.points,
    }));
    const out = {
      active: true,
      programId: p.id,
      terminology: p.terminology || { one: 'Point', other: 'Points' },
      tiers,
    };
    programCache = { data: out, at: now };
    return out;
  } catch (e) {
    // Loyalty not enabled or not permitted — degrade gracefully.
    return { active: false, tiers: [], terminology: null, error: e.message };
  }
}

async function getAccountByPhone(phone) {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  try {
    const data = await squareFetch('/v2/loyalty/accounts/search', {
      method: 'POST',
      body: { query: { mappings: [{ phone_number: e164 }] }, limit: 1 },
    });
    const acct = (data.loyalty_accounts || [])[0];
    if (!acct) return null;
    return { id: acct.id, balance: acct.balance || 0, customerId: acct.customer_id };
  } catch {
    return null;
  }
}

// Combined view for the app: balance + which tiers the customer can afford.
async function getCustomerLoyalty(phone) {
  const [program, account] = await Promise.all([getProgram(), getAccountByPhone(phone)]);
  if (!program.active) return { active: false };
  return {
    active: true,
    terminology: program.terminology,
    balance: account ? account.balance : 0,
    accountId: account ? account.id : null,
    tiers: program.tiers.map((t) => ({
      ...t,
      affordable: account ? account.balance >= t.points : false,
    })),
  };
}

async function createReward({ loyaltyAccountId, rewardTierId, orderId }) {
  const data = await squareFetch('/v2/loyalty/rewards', {
    method: 'POST',
    body: {
      idempotency_key: idem(),
      reward: {
        loyalty_account_id: loyaltyAccountId,
        reward_tier_id: rewardTierId,
        order_id: orderId,
      },
    },
  });
  return data.reward;
}

async function deleteReward(rewardId) {
  try {
    await squareFetch(`/v2/loyalty/rewards/${rewardId}`, { method: 'DELETE' });
  } catch {
    /* best-effort cleanup */
  }
}

// Count reward redemptions per loyalty account. Redemptions are sparse, so we
// fetch only REDEEM_REWARD events (cheap), unlike point-accumulation events which
// are far too many to page through for every member. Best-effort + capped.
async function redemptionCounts() {
  const counts = new Map(); // accountId -> { count, last }
  let cursor;
  let pages = 0;
  try {
    do {
      const data = await squareFetch('/v2/loyalty/events/search', {
        method: 'POST',
        body: { query: { filter: { type_filter: { types: ['REDEEM_REWARD'] } } }, limit: 30, ...(cursor ? { cursor } : {}) },
      });
      const evs = data.events || data.loyalty_events || [];
      for (const e of evs) {
        const id = e.loyalty_account_id;
        if (!id) continue;
        const c = counts.get(id) || { count: 0, last: null };
        c.count++;
        if (!c.last || (e.created_at && e.created_at > c.last)) c.last = e.created_at;
        counts.set(id, c);
      }
      cursor = data.cursor;
      pages++;
    } while (cursor && pages < 300);
  } catch { /* best-effort — the list still works without redemption counts */ }
  return counts;
}

// Every customer enrolled in the Square loyalty program, joined with their
// Square customer record (name / phone / email / join date) plus loyalty stats
// (points, lifetime earned, points redeemed, reward redemptions) — for the admin
// "Users" view. Read-only.
async function listLoyaltyUsers() {
  const accounts = [];
  let cursor;
  do {
    const data = await squareFetch('/v2/loyalty/accounts/search', {
      method: 'POST',
      body: { query: {}, limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const a of data.loyalty_accounts || []) accounts.push(a);
    cursor = data.cursor;
  } while (cursor && accounts.length < 5000);

  const ids = [...new Set(accounts.map((a) => a.customer_id).filter(Boolean))];
  const custMap = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const data = await squareFetch('/v2/customers/bulk-retrieve', {
        method: 'POST', body: { customer_ids: chunk },
      });
      for (const [id, r] of Object.entries(data.responses || {})) if (r.customer) custMap.set(id, r.customer);
    } catch { /* keep going — a failed chunk just means thinner detail */ }
  }

  const redeem = await redemptionCounts();

  const users = accounts.map((a) => {
    const c = custMap.get(a.customer_id) || {};
    const name = [c.given_name, c.family_name].filter(Boolean).join(' ').trim() || (c.company_name || '').trim() || (c.nickname || '').trim();
    const phone = c.phone_number || a.mapping?.phone_number || '';
    const balance = a.balance || 0;
    const lifetime = a.lifetime_points || 0;
    const rc = redeem.get(a.id) || { count: 0, last: null };
    return {
      id: a.id,
      customerId: a.customer_id || null,
      name,
      phone,
      email: c.email_address || '',
      points: balance,
      lifetimePoints: lifetime,
      redeemedPoints: Math.max(0, lifetime - balance),
      redemptions: rc.count,
      lastRedeemedAt: rc.last,
      enrolledAt: a.enrolled_at || c.created_at || null,
    };
  });
  users.sort((a, b) => new Date(b.enrolledAt || 0) - new Date(a.enrolledAt || 0));
  return users;
}

// Signup trend for the dashboard: how many customers enrolled in loyalty per day
// over the window, plus the total member count. Only needs enrolled_at, so it
// skips the customer bulk-retrieve that listLoyaltyUsers does.
async function signupStats(days = 30) {
  const accounts = [];
  let cursor;
  do {
    const data = await squareFetch('/v2/loyalty/accounts/search', {
      method: 'POST',
      body: { query: {}, limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const a of data.loyalty_accounts || []) accounts.push(a);
    cursor = data.cursor;
  } while (cursor && accounts.length < 10000);

  const since = Date.now() - days * 86400000;
  const dayMap = new Map();
  let inRange = 0;
  for (const a of accounts) {
    if (!a.enrolled_at) continue;
    if (new Date(a.enrolled_at).getTime() < since) continue;
    inRange++;
    const day = new Date(a.enrolled_at).toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const daily = [...dayMap.entries()].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day));
  return { totalMembers: accounts.length, newInRange: inRange, daily };
}

// Enroll a phone number in the loyalty program (idempotent). Returns
// { id, balance, customerId, existed } or null if the program is inactive.
async function enrollAccount({ phone, customerId }) {
  const program = await getProgram();
  if (!program.active || !program.programId) return null;
  const existing = await getAccountByPhone(phone);
  if (existing) return { id: existing.id, balance: existing.balance, customerId: existing.customerId, existed: true };
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  try {
    const data = await squareFetch('/v2/loyalty/accounts', {
      method: 'POST',
      body: { idempotency_key: idem(), loyalty_account: {
        program_id: program.programId,
        mapping: { phone_number: e164 },
        ...(customerId ? { customer_id: customerId } : {}),
      } },
    });
    const a = data.loyalty_account;
    return a ? { id: a.id, balance: a.balance || 0, customerId: a.customer_id, existed: false } : null;
  } catch (e) { console.error('[loyalty] enroll failed', e.message); return null; }
}

// Grant (or deduct) points on a loyalty account (best-effort).
async function adjustPoints({ accountId, points, reason }) {
  if (!accountId || !points) return false;
  try {
    await squareFetch(`/v2/loyalty/accounts/${accountId}/adjust`, {
      method: 'POST',
      body: { idempotency_key: idem(), adjust_points: { points, reason: String(reason || 'Bonus').slice(0, 120) } },
    });
    return true;
  } catch (e) { console.error('[loyalty] adjust failed', e.message); return false; }
}

module.exports = { getProgram, getAccountByPhone, getCustomerLoyalty, createReward, deleteReward, listLoyaltyUsers, signupStats, enrollAccount, adjustPoints };
