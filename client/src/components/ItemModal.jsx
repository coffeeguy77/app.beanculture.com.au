import React, { useMemo, useState } from 'react';
import { formatMoney, imgUrl } from '../api.js';

function makeKey(item, variationId, modifierIds, note) {
  return [item.id, variationId, [...modifierIds].sort().join(','), note].join('|');
}

// Square descriptions arrive as a run-on paragraph with known coffee labels
// (Origin, Tasting Notes, Process, ...) broken onto their own lines server-side
// (see formatDescription in catalog.js). We split that back into an intro
// paragraph plus a label->value fact list, then pull Origin and Tasting Notes
// out for special treatment (an inline origin line + pill badges) -- anything
// else (Process, Roast Profile, etc.) still renders, just as plain fact rows,
// so no information from Square is ever dropped. Items without any of these
// labels (food, retail, simple drinks) just get their intro text -- nothing
// coffee-specific is assumed to exist.
const KNOWN_LABELS = [
  'Origin Composition', 'Origin', 'Process', 'Harvest', 'Cup Profile', 'Tasting Notes',
  'Roast Profile', 'Suggested Brewing', 'Milk-based drinks', 'Milk-based', 'Body',
  'Sweetness', 'Acidity', 'Finish', 'Development', 'Style', 'Target', 'Espresso', 'Filter',
];
function parseDescription(text) {
  if (!text) return { intro: '', facts: [] };
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const introLines = [];
  const facts = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z \-/]*):\s*(.+)$/);
    const known = m && KNOWN_LABELS.some((l) => l.toLowerCase() === m[1].trim().toLowerCase());
    if (known) facts.push({ label: m[1].trim(), value: m[2].trim() });
    else if (facts.length === 0) introLines.push(line);
    else facts[facts.length - 1].value += ' ' + line;
  }
  let intro = introLines.join(' ');

  // Square doesn't always give Tasting Notes its own line -- some items run
  // it straight into the surrounding paragraph. Fall back to a looser inline
  // scan (label can appear mid-paragraph, right after a sentence boundary)
  // so the pill treatment still shows up on real-world data, and strip the
  // matched span out of the intro so it isn't shown twice.
  if (!facts.some((f) => /tasting notes/i.test(f.label))) {
    const m = intro.match(/Tasting Notes:\s*([^.]+)\.?/i);
    if (m) {
      facts.push({ label: 'Tasting Notes', value: m[1].trim() });
      intro = (intro.slice(0, m.index) + intro.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    }
  }
  return { intro, facts };
}

export default function ItemModal({ item, currency, onClose, onAdd }) {
  const firstAvail = item.variations.find((v) => !v.soldOut) || item.variations[0];
  const [variationId, setVariationId] = useState(firstAvail?.id);
  // Preset tiles arrive with default-on options; seed the selection from them.
  const [selected, setSelected] = useState(() => {
    const init = {};
    const d = item.defaults || {};
    for (const gid of Object.keys(d)) init[gid] = new Set(d[gid]);
    return init;
  });
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const variation = item.variations.find((v) => v.id === variationId) || firstAvail;

  function toggleModifier(group, mod) {
    setSelected((prev) => {
      const cur = new Set(prev[group.id] || []);
      if (group.selectionType === 'SINGLE') {
        // Pill behaviour: tapping the already-chosen option deselects it back
        // to "none picked" instead of being stuck once chosen, like a radio
        // button would be. Required groups (group.min > 0) are enforced at
        // Add-to-cart time instead, so a customer can still freely clear their
        // pick and reconsider while the sheet is open.
        if (cur.has(mod.id)) cur.clear();
        else { cur.clear(); cur.add(mod.id); }
      } else if (cur.has(mod.id)) cur.delete(mod.id);
      else {
        if (group.max > 0 && cur.size >= group.max) return prev;
        cur.add(mod.id);
      }
      return { ...prev, [group.id]: cur };
    });
  }

  // Groups the customer hasn't satisfied yet (min selections not met) -- used
  // to block Add-to-cart and to flag the offending group inline.
  const unmetGroups = (item.modifierGroups || []).filter((group) => {
    const need = group.min || 0;
    if (need <= 0) return false;
    const have = (selected[group.id]?.size) || 0;
    return have < need;
  });

  const { modifierIds, modifierNames, modifierPrice } = useMemo(() => {
    const ids = [], names = [];
    let price = 0;
    for (const group of item.modifierGroups || []) {
      const chosen = selected[group.id];
      if (!chosen) continue;
      for (const mod of group.modifiers) {
        if (chosen.has(mod.id)) { ids.push(mod.id); names.push(mod.name); price += mod.price || 0; }
      }
    }
    return { modifierIds: ids, modifierNames: names, modifierPrice: price };
  }, [selected, item]);

  const unitPrice = (variation?.price || 0) + modifierPrice;

  const { intro, facts } = useMemo(() => parseDescription(item.description), [item.description]);
  const originFact = facts.find((f) => /^origin/i.test(f.label));
  const tastingFact = facts.find((f) => /tasting notes/i.test(f.label));
  const otherFacts = facts.filter((f) => f !== originFact && f !== tastingFact);
  const originList = originFact ? originFact.value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const tastingList = tastingFact ? tastingFact.value.split(',').map((s) => s.trim().replace(/^and\s+/i, '')).filter(Boolean) : [];

  const minPrice = Math.min(...item.variations.map((v) => v.price ?? Infinity));

  // Persistent footer summary: variation + up to two configured picks, so the
  // customer always sees roughly what they're about to add without the footer
  // wrapping onto multiple lines.
  const summaryParts = [];
  if (item.variations.length > 1 && variation) summaryParts.push(variation.name || item.name);
  for (const group of item.modifierGroups || []) {
    if (summaryParts.length >= 3) break;
    const chosen = selected[group.id];
    if (!chosen || chosen.size === 0) continue;
    const names = group.modifiers.filter((m) => chosen.has(m.id)).map((m) => m.name);
    if (names.length) summaryParts.push(names.join(' + '));
  }
  const footerSummary = summaryParts.join(' · ');

  function handleAdd() {
    // Locked modifiers (from a preset) are always applied and hidden; their
    // price is already baked into the variation price, so only add their ids.
    const lockIds = item.lockedModifierIds || [];
    const lockNames = item.lockedModifierNames || [];
    const allIds = [...modifierIds, ...lockIds];
    const allNames = [...modifierNames, ...lockNames];
    onAdd({
      key: makeKey(item, variationId, allIds, note),
      itemId: item.presetSourceItemId || item.id, itemName: item.name,
      category: item.category || null,
      image: item.image || null,
      variationId, variationName: variation?.name || '',
      modifierIds: allIds, modifierNames: allNames, unitPrice, quantity: qty, note: note.trim(),
    });
  }

  let sectionNum = 0;

  return (
    <div className="backdrop item-backdrop" onClick={onClose}>
      <div className="sheet item-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>

        <div className="sheet-main">
          <div className="sheet-left">
            {item.image && <img className="sheet-img" src={imgUrl(item.image, 720)} alt="" decoding="async" />}
            <div className="sheet-left-body">
              {item.category && <div className="sheet-eyebrow">{item.category}</div>}
              <h2>{item.name}</h2>
              {Number.isFinite(minPrice) && <div className="sheet-from-price">From {formatMoney(minPrice, currency)}</div>}
              {intro && <p className="sheet-desc">{intro}</p>}
              {originList.length > 0 && <p className="sheet-origin">{originList.join(' · ')}</p>}
              {tastingList.length > 0 && (
                <div className="sheet-tasting">
                  <div className="sheet-tasting-label">Tasting notes</div>
                  <div className="sheet-tasting-pills">
                    {tastingList.map((t) => <span key={t} className="tasting-pill">{t}</span>)}
                  </div>
                </div>
              )}
              {otherFacts.length > 0 && (
                <dl className="sheet-facts">
                  {otherFacts.map((f) => (
                    <div key={f.label} className="sheet-fact">
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>

          <div className="sheet-right">
            <div className="sheet-right-head">
              <h3>Customise your {(item.name || 'item').toLowerCase()}</h3>
              <p>Choose your options and make it yours.</p>
            </div>

            {item.variations.length > 1 && (() => {
              sectionNum += 1;
              return (
                <div className="cgroup">
                  <div className="cgroup-title">
                    <span className="cgroup-num">{sectionNum}</span>
                    <span className="cgroup-name">Choose a size</span>
                    <span className="cgroup-req">Required</span>
                  </div>
                  <div className="cgroup-grid">
                    {item.variations.map((v) => (
                      <button type="button" key={v.id} disabled={v.soldOut}
                        className={`ccard ${variationId === v.id ? 'on' : ''} ${v.soldOut ? 'disabled' : ''}`}
                        onClick={() => setVariationId(v.id)}>
                        {variationId === v.id && <span className="ccard-check">✓</span>}
                        <span className="ccard-name">{v.name || item.name}{v.soldOut ? ' — Sold out' : ''}</span>
                        <span className="ccard-price">{formatMoney(v.price, currency)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {[...(item.modifierGroups || [])].sort((a, b) => ((b.min || 0) > 0 ? 1 : 0) - ((a.min || 0) > 0 ? 1 : 0)).map((group) => {
              sectionNum += 1;
              const num = sectionNum;
              const required = (group.min || 0) > 0;
              const have = (selected[group.id]?.size) || 0;
              const unmet = required && have < group.min;
              const hint = group.selectionType === 'SINGLE'
                ? 'Choose one'
                : group.max > 0 ? `Choose up to ${group.max}` : '';
              return (
                <div key={group.id} className="cgroup">
                  <div className="cgroup-title">
                    <span className="cgroup-num">{num}</span>
                    <span className="cgroup-name">{group.name}</span>
                    {required
                      ? <span className="cgroup-req">Required</span>
                      : group.selectionType !== 'SINGLE' && hint && <span className="cgroup-hint">{hint}</span>}
                  </div>
                  <div className="cgroup-grid">
                    {group.modifiers.map((mod) => {
                      const chosen = (selected[group.id] || new Set()).has(mod.id);
                      return (
                        <button type="button" key={mod.id} className={`ccard ${chosen ? 'on' : ''}`}
                          onClick={() => toggleModifier(group, mod)}>
                          {chosen && <span className="ccard-check">✓</span>}
                          <span className="ccard-name">{mod.name}</span>
                          {mod.price > 0 && <span className="ccard-price">+{formatMoney(mod.price, currency)}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {unmet && <p className="cgroup-warn">Select at least {group.min === 1 ? 'one' : group.min}</p>}
                </div>
              );
            })}

            <label className="field sheet-notes">
              <span>Notes (optional)</span>
              <textarea className="notes-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="sheet-footer">
          <div className="stepper">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">+</button>
          </div>
          <div className="sheet-footer-mid">
            {footerSummary && <span className="sheet-footer-summary">{footerSummary}</span>}
            {unmetGroups.length > 0 && (
              <span className="sheet-footer-warn">Choose {unmetGroups.map((g) => g.name).join(', ')}</span>
            )}
          </div>
          <button className="btn sheet-footer-add" onClick={handleAdd} disabled={unmetGroups.length > 0}>
            Add to order · {formatMoney(unitPrice * qty, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
