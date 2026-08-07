// Minimal service worker — enables "Add to Home Screen" installability without
// aggressive caching (network passthrough), so deploys are never served stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* let the network handle it */ });
