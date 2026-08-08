// Upload an image to the Square Catalog and attach it to an item as its primary
// image. Square's CreateCatalogImage endpoint is multipart/form-data (a JSON
// `request` part + the raw `image` file), so it can't go through the JSON-only
// squareFetch — we build the multipart body here with the global fetch/FormData.

const ENV = (process.env.SQUARE_ENV || 'production').toLowerCase();
const BASE_URL =
  ENV === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
const SQUARE_VERSION = process.env.SQUARE_VERSION || '2025-04-16';
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || '';

// data:[<mime>][;base64],<data>  ->  { buffer, mime }
function dataUriToBuffer(dataUri) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUri || '');
  if (!m) throw new Error('Invalid image data.');
  const mime = m[1] || 'image/jpeg';
  const buffer = m[2]
    ? Buffer.from(m[3], 'base64')
    : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { buffer, mime };
}

// Rough client-side-style guard so we fail fast with a friendly message rather
// than sending a huge body to Square.
const MAX_BYTES = 15 * 1024 * 1024; // Square's limit is 15MB

async function uploadItemImage({ objectId, dataUri, caption, primary = true, idempotencyKey }) {
  if (!ACCESS_TOKEN) throw new Error('Square is not configured (no access token).');
  if (!dataUri) throw new Error('No image provided.');
  const { buffer, mime } = dataUriToBuffer(dataUri);
  if (!/^image\//.test(mime)) throw new Error('That file is not an image.');
  if (buffer.length > MAX_BYTES) throw new Error('Image is too large (max 15MB).');
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';

  const request = {
    idempotency_key: idempotencyKey || `img_${objectId || 'x'}_${Date.now()}`,
    // Attaching to an existing item + marking primary replaces the shown image.
    ...(objectId ? { object_id: objectId, is_primary: !!primary } : {}),
    image: { type: 'IMAGE', id: '#new_image', image_data: { caption: caption || '' } },
  };

  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('image', new Blob([buffer], { type: mime }), `image.${ext}`);

  const res = await fetch(`${BASE_URL}/v2/catalog/images`, {
    method: 'POST',
    headers: {
      'Square-Version': SQUARE_VERSION,
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      Accept: 'application/json',
      // NOTE: do NOT set Content-Type — fetch sets the multipart boundary itself.
    },
    body: form,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = json && json.errors && json.errors[0];
    let detail = err ? (err.detail || err.code) : `Upload failed (HTTP ${res.status})`;
    if (err && (err.code === 'FORBIDDEN' || err.code === 'INSUFFICIENT_SCOPES')) {
      detail = 'Square denied the upload — the access token is missing the ITEMS_WRITE permission. Add it in the Square app’s OAuth scopes / token.';
    }
    throw new Error(detail);
  }
  const img = json.image || {};
  return { id: img.id, url: img.image_data?.url || null };
}

module.exports = { uploadItemImage };
