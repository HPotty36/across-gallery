/* The admin page's service worker. It does one thing: when the phone's share sheet sends photos to "Nocturne 관리"
   (a POST to share, see manifest.webmanifest), it keeps them for the page and sends the browser on to the admin page.

   Its scope is admin/, longer than the site worker's (src/sw.js, the whole site), so the admin page belongs to this
   worker. Every other request is left alone (no respondWith): it goes to the network exactly as if there were no
   worker, and nothing of the admin page is kept for offline use.

   The photos wait in the cache nocturne-share, one entry each: key share/<ms>-<number>, the photo as the body,
   Content-Type and X-Name (the file name through encodeURIComponent) as headers. The page (lib/shared.js) reads
   them back after the login and uploads them only when the person says so; the site worker leaves this cache alone.
   Plain classic script: no imports. Tested in node:vm by tests/js/admin-sw.test.js. */

const SHARE_CACHE = 'nocturne-share';
const ACCEPT = ['image/jpeg', 'image/png'];  // what the manifest asks for, and what the photo picker takes

/* Keep the usable photos of the shared form, whatever happens, then go to the admin page (303: the page is read with
   a GET, never with the POST again). A cache that cannot be written (no space) or a form that cannot be read only
   means fewer photos on the page: the person is never left on an error page. */
async function receive(request) {
  try {
    const form = await request.formData();
    const photos = form.getAll('photos').filter((f) => typeof f !== 'string' && f.size > 0 && ACCEPT.includes(f.type));
    if (photos.length > 0) {
      const cache = await caches.open(SHARE_CACHE);
      const now = Date.now();
      for (let i = 0; i < photos.length; i++) {
        const key = new URL('share/' + now + '-' + i, self.registration.scope).href;
        await cache.put(key, new Response(photos[i], {
          headers: { 'Content-Type': photos[i].type, 'X-Name': encodeURIComponent(photos[i].name) },
        }));
      }
    }
  } catch (e) {
    // nothing kept: the redirect below is the same
  }
  return Response.redirect(self.registration.scope, 303);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());  // no cache is cleaned here: a photo shared before an update must survive it
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method === 'POST' && new URL(request.url).pathname === new URL('share', self.registration.scope).pathname) {
    event.respondWith(receive(request));
  }
});
