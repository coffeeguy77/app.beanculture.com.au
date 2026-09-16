// Waiter split-billing math (pure, unit-testable). The table is ONE Square order;
// this turns the billing "overlay" (group tabs, shared tabs, line→tab assignment,
// weighted parties) plus the order's live line amounts into what each group /
// person owes — with every division landing exactly on the cents, so the sum of
// all shares always equals the tab total.
//
// Overlay shape (stored as waiter_sessions.data):
//   {
//     table, locationId, mode: 'groups',
//     groups: [ { id, name, people } ],
//     shared: [ { id, name, mode: 'parts'|'pct',
//                 parties: [ { id, ref, name, weight } ] } ],   // ref = a group id, or null for an ad-hoc diner
//     assign: { [lineUid]: tabId },                              // tabId is a group id or a shared id
//     addedBy:{ [lineUid]: waiterName },                         // who added each line (attribution)
//     paidByPayer: { [payerId]: cents }                          // how much a group/guest has paid so far
//   }
// paidByPayer holds a running total per payer (not a boolean) so a single group
// can settle across several payments — e.g. part cash + part card — and we always
// know what's left on their share.

// Largest-remainder allocation: split `total` (integer cents) across the given
// integer/float `weights` so the parts are whole cents that sum EXACTLY to total.
// Zero or empty weights → everything (if any) is unallocated by returning []'s
// caller-handled remainder; here we just return zeros.
function allocate(total, weights) {
  const t = Math.max(0, Math.round(total));
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const n = w.length;
  if (n === 0) return [];
  if (sum <= 0) { const a = new Array(n).fill(0); return a; } // no weights → nobody owes
  const raw = w.map((x) => (t * x) / sum);
  const floor = raw.map((x) => Math.floor(x));
  let used = floor.reduce((a, b) => a + b, 0);
  let left = t - used;
  // Hand out the leftover cents to the largest fractional remainders first.
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floor.slice();
  for (let k = 0; k < order.length && left > 0; k++) { out[order[k].i] += 1; left -= 1; }
  return out;
}

// Turn the overlay + the live Square order into the full split state.
//   order: Square order with line_items [{uid,total_money}], tenders [{amount_money,note}],
//          total_money.
function computeSession(overlay, order) {
  const ov = overlay || {};
  const groups = Array.isArray(ov.groups) ? ov.groups : [];
  const shared = Array.isArray(ov.shared) ? ov.shared : [];
  const assign = ov.assign || {};
  const addedBy = ov.addedBy || {};
  // Per-payer running total already paid (cents). Back-compat: an old boolean
  // `paid` map is read as "fully paid" for those payers.
  const paidByPayer = ov.paidByPayer || {};
  const legacyPaid = ov.paid || {};
  const paidAmountOf = (id, owed) => {
    if (paidByPayer[id] != null) return Math.max(0, Math.round(paidByPayer[id]));
    if (legacyPaid[id]) return owed;
    return 0;
  };
  const currency = (order && order.total_money && order.total_money.currency) || 'AUD';
  const lineItems = (order && order.line_items) || [];

  // Line amount by uid (net of discounts) and the label for display.
  const lineAmt = {};
  const lines = lineItems.map((li) => {
    const amt = (li.total_money && li.total_money.amount) || 0;
    if (li.uid) lineAmt[li.uid] = amt;
    return {
      uid: li.uid || '', name: li.name || 'Item', variation: li.variation_name || '',
      quantity: li.quantity || '1', amount: amt, tabId: assign[li.uid] || '',
      by: addedBy[li.uid] || '',
      modifiers: (li.modifiers || []).map((m) => m.name).filter(Boolean),
    };
  });

  const sumFor = (tabId) => lineItems.reduce((s, li) => s + (assign[li.uid] === tabId ? ((li.total_money && li.total_money.amount) || 0) : 0), 0);

  // Each group's own items.
  const groupItems = {};
  for (const g of groups) groupItems[g.id] = sumFor(g.id);

  // Shared tabs → allocate each tab's total across its parties by weight (parts)
  // or percentage. A party that references a group adds to that group's bill; an
  // ad-hoc party (no ref) is its own payer.
  const groupSharedShare = {};
  for (const g of groups) groupSharedShare[g.id] = 0;
  const sharedOut = shared.map((sh) => {
    const total = sumFor(sh.id);
    const parties = Array.isArray(sh.parties) ? sh.parties : [];
    const weights = parties.map((p) => (sh.mode === 'pct' ? (Number(p.weight) || 0) : (Number(p.weight) || 0)));
    const amounts = allocate(total, weights);
    const outParties = parties.map((p, i) => {
      const amount = amounts[i] || 0;
      if (p.ref && groupSharedShare[p.ref] != null) groupSharedShare[p.ref] += amount;
      const g = groups.find((x) => x.id === p.ref);
      const pAmt = p.ref ? 0 : paidAmountOf(p.id, amount); // guests pay their own; group-parties settle via the group
      return { id: p.id, ref: p.ref || null, name: p.name || (g ? g.name : 'Guest'), weight: Number(p.weight) || 0, amount, paidAmount: pAmt, remaining: Math.max(0, amount - pAmt), paid: !p.ref && amount > 0 && pAmt >= amount };
    });
    return { id: sh.id, name: sh.name || 'Shared', mode: sh.mode || 'parts', total, parties: outParties };
  });

  // Ad-hoc parties (across all shared tabs) become their own payers.
  const adhoc = [];
  for (const sh of sharedOut) for (const p of sh.parties) if (!p.ref) adhoc.push({ id: p.id, name: p.name, amount: p.amount, paidAmount: p.paidAmount, remaining: p.remaining, sharedId: sh.id, paid: p.paid });

  const groupsOut = groups.map((g) => {
    const owed = (groupItems[g.id] || 0) + (groupSharedShare[g.id] || 0);
    const pAmt = paidAmountOf(g.id, owed);
    return {
      id: g.id, name: g.name || 'Group', people: Number(g.people) || 1,
      itemsTotal: groupItems[g.id] || 0,
      sharedShare: groupSharedShare[g.id] || 0,
      owed,
      paidAmount: pAmt,
      remaining: Math.max(0, owed - pAmt),
      paid: owed > 0 && pAmt >= owed,
    };
  });

  // Reflect settlement onto each shared tab: an ad-hoc guest pays their own share
  // directly; a group-party is covered as its group pays down (proportionally, so
  // the shared tab's "left" shrinks with each payment, and reads fully paid once
  // the group has settled). Also roll each shared tab up into a paidTotal / left.
  const groupById = {};
  for (const g of groupsOut) groupById[g.id] = g;
  for (const sh of sharedOut) {
    let shPaid = 0;
    for (const p of (sh.parties || [])) {
      if (p.ref) {
        const g = groupById[p.ref];
        const frac = g && g.owed > 0 ? Math.min(1, g.paidAmount / g.owed) : 0;
        p.paidAmount = Math.min(p.amount, Math.round(p.amount * frac));
        p.remaining = Math.max(0, p.amount - p.paidAmount);
        p.paid = !!(g && g.paid);
      }
      shPaid += p.paidAmount || 0;
    }
    sh.paidTotal = shPaid;
    sh.remaining = Math.max(0, sh.total - shPaid);
    sh.paid = sh.total > 0 && shPaid >= sh.total;
  }

  // Items not assigned to any tab yet — must be handled before the tab is settled.
  const assignedIds = new Set([...groups.map((g) => g.id), ...shared.map((s) => s.id)]);
  const unassignedTotal = lineItems.reduce((s, li) => s + (assignedIds.has(assign[li.uid]) ? 0 : ((li.total_money && li.total_money.amount) || 0)), 0);

  const total = (order && order.total_money && order.total_money.amount) || 0;
  const tenders = (order && order.tenders) || [];
  const tenderPaid = tenders.reduce((s, t) => s + ((t.amount_money && t.amount_money.amount) || 0), 0);
  // Partial split payments (cash or card) are now taken as STANDALONE captures, so
  // they aren't Square tenders — the running total each payer has paid lives in the
  // overlay (paidByPayer). Sum what every payer has paid: groups (which also cover
  // their group-ref shares) plus ad-hoc shared guests. Fall back to tenders for a
  // table settled in one linked full payment, whichever is greater (never both).
  const collected = groupsOut.reduce((s, g) => s + (g.paidAmount || 0), 0) + adhoc.reduce((s, a) => s + (a.paidAmount || 0), 0);
  const paidAmount = Math.min(total, Math.max(tenderPaid, collected));

  return {
    currency, total, paid: paidAmount, remaining: Math.max(0, total - paidAmount),
    state: (order && order.state) || 'OPEN',
    groups: groupsOut, shared: sharedOut, adhoc, lines, unassignedTotal,
    payments: tenders.map((t) => ({ amount: (t.amount_money && t.amount_money.amount) || 0, tender: (t.type || '').toLowerCase(), name: (t.note || '').replace(/^(Grp|Split):\s*/i, '') || '' })),
  };
}

// The full amount a payer (group id or ad-hoc party id) is responsible for.
function owedFor(session, payerId) {
  const g = session.groups.find((x) => x.id === payerId);
  if (g) return g.owed;
  const a = session.adhoc.find((x) => x.id === payerId);
  if (a) return a.amount;
  return 0;
}

// What a payer still has LEFT to pay right now (owed minus what they've paid so
// far) — this is the cap on the next payment, and supports part-cash/part-card.
function remainingFor(session, payerId) {
  const g = session.groups.find((x) => x.id === payerId);
  if (g) return g.remaining;
  const a = session.adhoc.find((x) => x.id === payerId);
  if (a) return a.remaining;
  return 0;
}

module.exports = { allocate, computeSession, owedFor, remainingFor };
