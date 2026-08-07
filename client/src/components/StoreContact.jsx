import React from 'react';

// Storefront contact block: address + tap-to-call + directions. Button taps are
// tracked so the owner can see how many people ask for directions / call.
export default function StoreContact({ contact, onTrack }) {
  if (!contact || (!contact.address && !contact.phone && !contact.mapsUrl)) return null;
  const address = contact.address || '';
  const mapsUrl = contact.mapsUrl
    || (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '');
  const dirUrl = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : mapsUrl;
  const tel = (contact.phone || '').replace(/[^\d+]/g, '');
  const pin = (
    <span className="contact-ic" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-6.5-5.6-6.5-10A6.5 6.5 0 0 1 18.5 11c0 4.4-6.5 10-6.5 10Z" /><circle cx="12" cy="11" r="2.3" /></svg>
    </span>
  );

  return (
    <section className="store-contact">
      <div className="group-title">Find us</div>
      {address ? (
        <a className="contact-line" href={mapsUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('contact_map')}>
          {pin}<span>{address}</span>
        </a>
      ) : mapsUrl ? (
        <a className="contact-line" href={mapsUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('contact_map')}>
          {pin}<span>View on Google Maps</span>
        </a>
      ) : null}
      <div className="contact-actions">
        {tel && (
          <a className="btn ghost" href={`tel:${tel}`} onClick={() => onTrack && onTrack('contact_phone')}>Call</a>
        )}
        {(dirUrl) && (
          <a className="btn" href={dirUrl} target="_blank" rel="noreferrer" onClick={() => onTrack && onTrack('contact_dir')}>Directions</a>
        )}
      </div>
    </section>
  );
}
