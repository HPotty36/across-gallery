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
