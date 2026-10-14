import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../auth/worker.js';

const SITE = 'https://hpotty36.github.io';
const ENV = { CLIENT_ID: 'Iv-test', CLIENT_SECRET: 'shh' };
const GOOD = { code: 'c0de', code_verifier: 'v'.repeat(43), redirect_uri: 'https://hpotty36.github.io/nocturne/admin/' };
const GITHUB = 'https://github.com/login/oauth/access_token';

const post = (body, origin = SITE) => new Request('https://nocturne-auth.test/token', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

// Stub GitHub: `reply` is a Response, or a function that returns one (or throws).
const stubGithub = (reply) => mock.method(globalThis, 'fetch', async () => (typeof reply === 'function' ? reply() : reply));

afterEach(() => mock.restoreAll());

test('other origins are refused before GitHub is asked', async () => {
  const github = stubGithub(Response.json({ access_token: 'ghu_x' }));
  const evil = await worker.fetch(post(GOOD, 'https://evil.example'), ENV);
  assert.equal(evil.status, 403);
  const none = await worker.fetch(new Request('https://nocturne-auth.test/token', { method: 'POST', body: JSON.stringify(GOOD) }), ENV);
  assert.equal(none.status, 403);
  assert.equal(github.mock.callCount(), 0);
});

test('preflight from the site', async () => {
  const res = await worker.fetch(new Request('https://nocturne-auth.test/token', { method: 'OPTIONS', headers: { Origin: SITE } }), ENV);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
  const other = await worker.fetch(new Request('https://nocturne-auth.test/token', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), ENV);
  assert.equal(other.status, 403);
});

test('bad bodies are 400', async () => {
  const github = stubGithub(Response.json({ access_token: 'ghu_x' }));
  for (const body of ['not json', '[]', { code: 'c' }, { ...GOOD, code: 5 }, { ...GOOD, code: 'x'.repeat(513) }, { ...GOOD, code: '' }]) {
    const res = await worker.fetch(post(body), ENV);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), { error: 'bad_request' });
  }
  assert.equal(github.mock.callCount(), 0);
});

test('the code goes to GitHub with the secret', async () => {
  const github = stubGithub(Response.json({ access_token: 'ghu_x', expires_in: 28800 }));
  await worker.fetch(post(GOOD), ENV);
  assert.equal(github.mock.callCount(), 1);
  const [url, init] = github.mock.calls[0].arguments;
  assert.equal(url, GITHUB);
  assert.equal(init.method, 'POST');
  assert.equal(new Headers(init.headers).get('Accept'), 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    client_id: 'Iv-test',
    client_secret: 'shh',
    code: 'c0de',
    code_verifier: GOOD.code_verifier,
    redirect_uri: GOOD.redirect_uri,
  });
});

test('only the access token and its lifetime come back', async () => {
  stubGithub(Response.json({
    access_token: 'ghu_x', expires_in: 28800, refresh_token: 'ghr_y', refresh_token_expires_in: 15897600, scope: '', token_type: 'bearer',
  }));
  const res = await worker.fetch(post(GOOD), ENV);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { access_token: 'ghu_x', expires_in: 28800 });
  assert.ok(!text.includes('ghr_'));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Vary'), 'Origin');
  assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');

  mock.restoreAll();
  stubGithub(Response.json({ access_token: 'ghu_x', token_type: 'bearer' }));
  const bare = await worker.fetch(post(GOOD), ENV);
  assert.equal(bare.status, 200);
  assert.deepEqual(await bare.json(), { access_token: 'ghu_x' });
});

test('a GitHub error is 400', async () => {
  stubGithub(Response.json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }));
  const res = await worker.fetch(post(GOOD), ENV);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'bad_verification_code' });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
});

test('a GitHub error is 400 whatever its HTTP status', async () => {
  // an unknown client_id (the numeric App ID pasted instead of the Client ID) is HTTP 404 {"error":"Not Found"}
  for (const status of [404, 401, 500]) {
    mock.restoreAll();
    stubGithub(Response.json({ error: 'Not Found' }, { status }));
    const res = await worker.fetch(post(GOOD), ENV);
    assert.equal(res.status, 400, String(status));
    assert.deepEqual(await res.json(), { error: 'Not Found' });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  }
});

test('GitHub out of reach is 502', async () => {
  const replies = [
    () => { throw new TypeError('fetch failed'); },
    () => new Response('oops', { status: 500 }),
    () => new Response('<html>', { status: 404 }),
    () => new Response('<html>', { status: 200 }),
    () => Response.json({}),
    () => Response.json({}, { status: 500 }),
    () => Response.json({ error: 5 }),
    () => Response.json([{ error: 'x' }]),
    () => Response.json({ access_token: 'ghu_x' }, { status: 500 }),
  ];
  for (const reply of replies) {
    mock.restoreAll();
    stubGithub(reply);
    const res = await worker.fetch(post(GOOD), ENV);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'github_unreachable' });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  }
});

test('missing settings are 500', async () => {
  const github = stubGithub(Response.json({ access_token: 'ghu_x' }));
  const res = await worker.fetch(post(GOOD), { CLIENT_ID: 'Iv-test' });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'not_configured' });
  assert.equal(github.mock.callCount(), 0);
});

test('other paths and methods', async () => {
  const github = stubGithub(Response.json({ access_token: 'ghu_x' }));
  const root = await worker.fetch(new Request('https://nocturne-auth.test/', { method: 'POST', headers: { Origin: SITE }, body: JSON.stringify(GOOD) }), ENV);
  assert.equal(root.status, 404);
  const get = await worker.fetch(new Request('https://nocturne-auth.test/token', { headers: { Origin: SITE } }), ENV);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('Allow'), 'POST, OPTIONS');
  assert.equal(github.mock.callCount(), 0);
});

test('the module exposes only a default export', async () => {
  const mod = await import('../../auth/worker.js');
  assert.deepEqual(Object.keys(mod), ['default']);
});
