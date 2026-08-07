// Signed Cloudinary upload (no SDK). Works once CLOUDINARY_CLOUD_NAME/API_KEY/
// API_SECRET are set in Railway. Accepts a data URI (base64) from the admin.
const crypto = require('crypto');

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME || '';
const KEY = process.env.CLOUDINARY_API_KEY || '';
const SECRET = process.env.CLOUDINARY_API_SECRET || '';
const FOLDER = process.env.CLOUDINARY_FOLDER || 'beanculture';

function configured() {
  return !!(CLOUD && KEY && SECRET);
}

async function upload(dataUri, subfolder) {
  if (!configured()) {
    throw new Error('Cloudinary is not configured (set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).');
  }
  if (!dataUri) throw new Error('No image provided');
  const folder = subfolder ? `${FOLDER}/${subfolder}` : FOLDER;
  const timestamp = Math.floor(Date.now() / 1000);
  // Signature = sha1 of alphabetically-sorted signed params + api_secret.
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${SECRET}`)
    .digest('hex');

  const body = new URLSearchParams();
  body.set('file', dataUri);
  body.set('api_key', KEY);
  body.set('timestamp', String(timestamp));
  body.set('folder', folder);
  body.set('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
    method: 'POST',
    body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Cloudinary upload failed (${res.status})`);
  return j.secure_url;
}

module.exports = { upload, configured };
