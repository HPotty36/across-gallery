import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// admin/sw.js is run the way a service worker runs it, in node:vm with stand-ins for the worker scope and the
// caches: the share POST is turned into cached files and a 303 back to the admin page, everything else is left
// alone (no respondWith). Request, Response, FormData and File are Node's own.
const source = readFileSync(new URL('../../admin/sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://x.test/nocturne/admin/';

/** A worker with the cache `nocturne-share` in memory (or one whose caches.open always rejects). */
function boot({ broken = false } = {}) {
  const listeners = {};
  const entries = new Map(); // key -> Response
  const calls = { skipped: 0, claimed: 0, opened: [] };
  const caches = {
    async open(name) {
      calls.opened.push(name);
      if (broken) throw new Error('no space left');
      return {
        put: async (key, response) => { entries.set(String(key?.url ?? key), response); },
      };
    },
  };
  const ctx = vm.createContext({
    URL, Response, caches,
    self: {
      registration: { scope: SCOPE },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: async () => { calls.skipped += 1; },
      clients: { claim: async () => { calls.claimed += 1; } },
    },
  });
  vm.runInContext(source, ctx);

  /** Fires a fetch event; resolves to the response given to respondWith, or null when it was not called. */
  async function fetchEvent(request) {
    let answer = null;
    listeners.fetch({ request, respondWith: (p) => { answer = p; } });
    return answer === null ? null : answer;
  }
  return { listeners, entries, calls, fetchEvent };
}

const file = (name, type, bytes = 'x') => new File([bytes], name, { type });

function sharePost(files, url = `${SCOPE}share`) {
  const form = new FormData();
  for (const f of files) form.append('photos', f);
  return new Request(url, { method: 'POST', body: form });
}

test('a share POST keeps the JPEG and PNG files and answers 303 to the admin page', async () => {
  const w = boot();
  const answer = await w.fetchEvent(sharePost([
    file('a.jpg', 'image/jpeg', 'jpeg bytes'), file('b.png', 'image/png', 'png bytes'),
    file('c.heic', 'image/heic', 'heic bytes'), file('empty.jpg', 'image/jpeg', ''),
  ]));
  assert.notEqual(answer, null, 'respondWith was called');
  const response = await answer;
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), SCOPE);

  const keys = [...w.entries.keys()];
  assert.equal(keys.length, 2);
  for (const key of keys) assert.match(key, /^https:\/\/x\.test\/nocturne\/admin\/share\/\d+-\d$/);
  const kept = [...w.entries.values()];
  assert.deepEqual(kept.map((r) => decodeURIComponent(r.headers.get('X-Name'))), ['a.jpg', 'b.png']);
  assert.deepEqual(kept.map((r) => r.headers.get('Content-Type')), ['image/jpeg', 'image/png']);
  assert.deepEqual(await Promise.all(kept.map((r) => r.text())), ['jpeg bytes', 'png bytes']);
  assert.deepEqual(w.calls.opened, ['nocturne-share']);
});

test('the file name is kept whole, whatever it holds', async () => {
  const w = boot();
  await (await w.fetchEvent(sharePost([file('한 강 100%.jpg', 'image/jpeg')])));
  const [kept] = [...w.entries.values()];
  assert.equal(kept.headers.get('X-Name'), encodeURIComponent('한 강 100%.jpg'));  // header-safe: ASCII only
  assert.equal(decodeURIComponent(kept.headers.get('X-Name')), '한 강 100%.jpg');
});

test('other requests are left alone: no respondWith', async () => {
  const w = boot();
  for (const request of [
    new Request(SCOPE),                                          // the admin page itself
    new Request(`${SCOPE}share`),                                // a GET of the share address
    new Request(`${SCOPE}other`, { method: 'POST', body: 'x' }), // a POST somewhere else
    new Request('https://x.test/nocturne/share', { method: 'POST', body: 'x' }),  // the site's own address
    new Request('https://api.github.com/repos/x/y', { method: 'POST', body: '{}' }),
  ]) {
    assert.equal(await w.fetchEvent(request), null, `${request.method} ${request.url}`);
  }
  assert.equal(w.entries.size, 0);
  assert.deepEqual(w.calls.opened, []);  // no cache was even opened
});

test('a cache that cannot be written still gets the 303', async () => {
  const w = boot({ broken: true });
  const response = await (await w.fetchEvent(sharePost([file('a.jpg', 'image/jpeg')])));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), SCOPE);
  assert.equal(w.entries.size, 0);
});

test('a body that is not a form still gets the 303', async () => {
  const w = boot();
  const request = new Request(`${SCOPE}share`, { method: 'POST', body: 'not a form', headers: { 'Content-Type': 'text/plain' } });
  const response = await (await w.fetchEvent(request));
  assert.equal(response.status, 303);
  assert.equal(w.entries.size, 0);
});

test('a share with nothing usable keeps nothing', async () => {
  const w = boot();
  const response = await (await w.fetchEvent(sharePost([file('c.heic', 'image/heic'), file('d.gif', 'image/gif')])));
  assert.equal(response.status, 303);
  assert.equal(w.entries.size, 0);
});

test('install takes over at once, activate claims the pages and touches no cache', async () => {
  const w = boot();
  let installing, activating;
  w.listeners.install({ waitUntil: (p) => { installing = p; } });
  w.listeners.activate({ waitUntil: (p) => { activating = p; } });
  await Promise.all([installing, activating]);
  assert.equal(w.calls.skipped, 1);
  assert.equal(w.calls.claimed, 1);
  assert.deepEqual(w.calls.opened, []);
});
