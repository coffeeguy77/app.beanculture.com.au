import React, { useMemo } from 'react';
import { formatMoney, imgUrl } from '../api.js';
import { useItemConfig } from '../hooks/useItemConfig.js';

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

export default function ItemModal({ item, currency, onClose, onAdd, isFree }) {
  // Selection / validation / pricing / cart-item build all come from the shared
  // hook, so the customer sheet and the staff POS produce identical results.
  const {
    variationId, setVariationId, variation,
    selected, toggleModifier,
    unmetGroups, unitPrice,
    qty, setQty, note, setNote,
    buildCartItem,
  } = useItemConfig(item);

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
    onAdd(buildCartItem());
  }

  let sectionNum = 0;
  // An item is only "customisable" if it offers a size choice or at least one
  // real add-on group. Plain items (e.g. Porridge) shouldn't be told to
  // "choose your options" — the Notes field covers any special request.
  const hasOptions = item.variations.length > 1 || (item.modifierGroups || []).some((g) => (g.modifiers || []).length > 0);

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
              {!isFree && Number.isFinite(minPrice) && <div className="sheet-from-price">From {formatMoney(minPrice, currency)}</div>}
              {isFree && <div className="sheet-from-price">Complimentary</div>}
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
              <h3>{hasOptions ? `Customise your ${(item.name || 'item').toLowerCase()}` : `Add ${item.name || 'item'} to your order`}</h3>
              {hasOptions
                ? <p>Choose your options and make it yours.</p>
                : <p>Nothing to choose here — add a note below if you'd like it a certain way.</p>}
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
                        {!isFree && <span className="ccard-price">{formatMoney(v.price, currency)}</span>}
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
              const hint = (group.selectionType === 'SINGLE' || group.max === 1)
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
                          {!isFree && mod.price > 0 && <span className="ccard-price">+{formatMoney(mod.price, currency)}</span>}
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
            {isFree ? 'Add to order' : `Add to order · ${formatMoney(unitPrice * qty, currency)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
