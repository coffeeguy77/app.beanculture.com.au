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

module.exports = { getProgram, getAccountByPhone, getCustomerLoyalty, createReward, deleteReward };
