import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// src/sw.js is run as it is, before the build fills it in: its decisions are plain function declarations,
// and it only adds service worker listeners when it runs as one.
const ctx = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../../src/sw.js', import.meta.url), 'utf8'), ctx);
const S = 'https://hpotty36.github.io/nocturne/';

test('route', () => {
  const cases = [
    [S, 'navigate', 'page'], [S + 'index.html', 'navigate', 'page'], [S + '#river', 'navigate', 'page'],
    [S + '?lang=ko', 'navigate', 'page'],  // the English page's link to the Korean one
    [S + 'en/', 'navigate', 'page'], [S + 'en/index.html', 'navigate', 'page'], [S + 'en', 'navigate', 'pass'],
    [S, 'cors', 'pass'],
    [S + 'admin', 'navigate', 'pass'], [S + 'admin/', 'navigate', 'pass'],
    [S + 'admin/?code=abc&state=xyz', 'navigate', 'pass'], [S + 'admin/app.js', 'no-cors', 'pass'],
    [S + 'manifest.webmanifest', 'cors', 'shell'], [S + 'icons/icon-192.png', 'no-cors', 'shell'],
    [S + 'photos/thumb/a1.jpg?v=0123abcd', 'no-cors', 'thumb'], [S + 'photos/full/a1.jpg?v=0123abcd', 'no-cors', 'full'],
    ['https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400&display=swap', 'cors', 'font-css'],
    ['https://fonts.gstatic.com/s/notoserifkr/v1/a.woff2', 'cors', 'font-file'],
    ['https://api.github.com/repos/x/y', 'cors', 'pass'], ['https://hpotty36.github.io/other/', 'navigate', 'pass'],
    [S + 'sw.js', 'same-origin', 'pass'], [S + 'tests/x.html', 'navigate', 'pass'],
  ];
  for (const [url, mode, want] of cases) assert.equal(ctx.route(url, S, mode), want, `${mode} ${url}`);
});

test('stale', () => {
  const photos = [{ thumb: 'photos/thumb/a1.jpg?v=aaaaaaaa', full: 'photos/full/a1.jpg?v=bbbbbbbb' }];
  const cached = [S + 'photos/thumb/a1.jpg?v=aaaaaaaa', S + 'photos/thumb/a1.jpg?v=00000000',
                  S + 'photos/full/zz.jpg?v=cccccccc', S + 'photos/full/a1.jpg?v=bbbbbbbb'];
  assert.deepEqual([...ctx.stale(cached, photos, S)], [S + 'photos/thumb/a1.jpg?v=00000000', S + 'photos/full/zz.jpg?v=cccccccc']);
});

test('storable', () => {
  assert.equal(ctx.storable({ ok: true, type: 'basic' }), true);
  assert.equal(ctx.storable({ ok: true, type: 'cors' }), true);
  for (const r of [{ ok: false, type: 'basic' }, { ok: true, type: 'opaque' }, { ok: true, type: 'opaqueredirect' }])
    assert.equal(ctx.storable(r), false, JSON.stringify(r));
});

// The install step, run as a service worker would run it: the template with its constants filled in, in a context
// with stand-ins for the worker scope, the caches and the network.
const template = readFileSync(new URL('../../src/sw.js', import.meta.url), 'utf8');
const PHOTOS = [{ thumb: 'photos/thumb/a1.jpg?v=aaaaaaaa', full: 'photos/full/a1.jpg?v=bbbbbbbb' },
                { thumb: 'photos/thumb/n1.jpg?v=cccccccc', full: 'photos/full/n1.jpg?v=dddddddd' }];

async function install({ cover, cached = {}, network = () => ({ ok: true, type: 'basic' }) }) {
  const stores = new Map(Object.entries(cached).map(([name, urls]) => [name, new Map(urls.map((u) => [u, { ok: true, old: true }]))]));
  const fetched = [];
  const deleted = [];
  const listeners = {};
  let skipped = false;
  const keyOf = (key) => (typeof key === 'string' ? key : key.url);
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async (key) => store.get(keyOf(key)),
        put: async (key, res) => { store.set(keyOf(key), res); },
        addAll: async (requests) => { for (const r of requests) store.set(r.url, { ok: true }); },
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async (key) => store.delete(keyOf(key)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => { deleted.push(name); return stores.delete(name); },
  };
  const source = template.replace("'__VERSION__'", "'test'").replace('[/*__PHOTOS__*/]', JSON.stringify(PHOTOS))
    .replace("'' /*__COVER__*/", JSON.stringify(cover));
  const ctx = vm.createContext({
    URL, Promise, setTimeout, clearTimeout, caches, ServiceWorkerGlobalScope: class {},
    Response: { error: () => ({ ok: false, type: 'error' }) },
    Request: class { constructor(url) { this.url = url; } },
    fetch: async (url) => { fetched.push(url); return network(url); },
    self: { registration: { scope: S }, addEventListener: (type, fn) => { listeners[type] = fn; },
            skipWaiting: async () => { skipped = true; }, clients: { claim: async () => {} } },
  });
  vm.runInContext(source, ctx);
  let done;
  listeners.install({ waitUntil: (p) => { done = p; } });
  await done;
  const urls = (name) => [...(stores.get(name) || new Map()).keys()];
  return { fetched, skipped, thumbs: urls('nocturne-thumbs'), full: urls('nocturne-full'), stores, listeners, deleted };
}

test('install keeps every thumbnail and the cover, so the first page shows offline', async () => {
  const r = await install({ cover: PHOTOS[0].full });
  assert.deepEqual(r.thumbs, PHOTOS.map((p) => S + p.thumb));
  assert.deepEqual(r.full, [S + PHOTOS[0].full]);  // the cover only, not every full-size copy
  assert.deepEqual(r.fetched, [S + PHOTOS[0].thumb, S + PHOTOS[1].thumb, S + PHOTOS[0].full]);
  assert.equal(r.skipped, true);
});

test('install does not fetch what is already kept, and takes no cover when there is none', async () => {
  const again = await install({ cover: PHOTOS[0].full, cached: { 'nocturne-thumbs': PHOTOS.map((p) => S + p.thumb), 'nocturne-full': [S + PHOTOS[0].full] } });
  assert.deepEqual(again.fetched, []);
  assert.equal(again.stores.get('nocturne-full').get(S + PHOTOS[0].full).old, true);  // the kept copy is left as it is
  const none = await install({ cover: '' });
  assert.deepEqual(none.full, []);
  assert.deepEqual(none.fetched, PHOTOS.map((p) => S + p.thumb));
});

test('a cover that cannot be had never fails the install', async () => {
  const coverUrl = S + PHOTOS[0].full;
  for (const network of [(url) => { if (url === coverUrl) throw new Error('offline'); return { ok: true, type: 'basic' }; },
                         (url) => (url === coverUrl ? { ok: false, type: 'basic' } : { ok: true, type: 'basic' }),
                         (url) => (url === coverUrl ? { ok: true, type: 'opaque' } : { ok: true, type: 'basic' })]) {
    const r = await install({ cover: PHOTOS[0].full, network });
    assert.deepEqual(r.full, []);  // nothing wrong is kept ...
    assert.deepEqual(r.thumbs, PHOTOS.map((p) => S + p.thumb));  // ... and the rest went on
    assert.equal(r.skipped, true);
  }
});

test("activate drops this site's old caches but keeps nocturne-share (the admin page's shared photos) and other sites'", async () => {
  const r = await install({ cover: '', cached: { 'nocturne-share': [S + 'admin/share/1-0'], 'nocturne-old': [S + 'x'], other: [S + 'y'] } });
  let done;
  r.listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual(r.deleted, ['nocturne-old']);
  assert.deepEqual([...r.stores.get('nocturne-share').keys()], [S + 'admin/share/1-0']);  // the shared photo is still there
  assert.ok(r.stores.has('other'));
  for (const name of ['nocturne-page', 'nocturne-thumbs', 'nocturne-full']) assert.ok(r.stores.has(name), name);
});

// A page request, as the fetch listener sees it. `answer` is what the network gives for it. Resolves to the response the
// page gets, with what the network answer was cloned into the cache (nothing, when the worker keeps nothing).
async function openPage(answer, cached) {
  const request = { url: S, method: 'GET', mode: 'navigate' };
  const r = await install({ cover: '', network: (what) => (what === request ? answer : { ok: true, type: 'basic' }) });
  if (!cached) r.stores.get('nocturne-page').delete(S);  // install kept the page; this device has no copy
  const before = r.stores.get('nocturne-page').get(S);
  const pending = [];
  let reply;
  r.listeners.fetch({ request, waitUntil: (p) => pending.push(p), respondWith: (p) => { reply = p; } });
  const response = await reply;
  await Promise.all(pending);
  return { response, before, after: r.stores.get('nocturne-page').get(S) };
}

test('page opaqueredirect is passed through', async () => {
  // a moved site: the network answers with a redirect the worker must not follow; the browser does
  const moved = { ok: false, type: 'opaqueredirect', clone() { throw new Error('a redirect is never kept'); } };
  const withCopy = await openPage(moved, true);
  assert.equal(withCopy.response, moved);  // returned as it is, not the old copy
  assert.equal(withCopy.after, withCopy.before);  // and nothing was put into nocturne-page
  const without = await openPage(moved, false);
  assert.equal(without.response, moved);
  assert.equal(without.after, undefined);
});

test('page: an error page from the network still gives way to the copy on the device', async () => {
  const broken = { ok: false, type: 'basic', status: 500, clone() { throw new Error('an error page is never kept'); } };
  const r = await openPage(broken, true);
  assert.equal(r.response, r.before);
  assert.equal(r.after, r.before);
});

test('page: a good answer is returned and refreshes the copy', async () => {
  const fresh = { ok: true, type: 'basic', clone() { return { copy: true }; } };
  const r = await openPage(fresh, true);
  assert.equal(r.response, fresh);
  assert.deepEqual(r.after, { copy: true });
});
