import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, resolveConfig } from '../../admin/config.js';
import {
  LOGIN_KEY, AUTO_KEY, SIGNED_IN_KEY, OLD_TOKEN_KEY, LOGIN_MAX_AGE_MS, DEFAULT_LIFETIME_S, RENEW_BEFORE_MS, MESSAGES,
  LoginError, base64url, challengeFor, newLogin, saveLogin, takeLogin, remember, recall, forget, redirectUri,
  authorizeUrl, readReturn, checkReturn, exchange, bootAction, needsLogin, rejectedMessage,
} from '../../admin/lib/auth.js';

const at = (href) => new URL(href);
const URL_SAFE = /^[A-Za-z0-9_-]+$/;

/** A Map-backed stand-in for localStorage / sessionStorage. */
function store() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

/** Storage that refuses everything, like a browser with site data blocked. */
function brokenStore() {
  const boom = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

/** Passes assert.rejects only for our own LoginError carrying exactly `message`. */
const loginError = (message) => (e) => {
  assert.ok(e instanceof LoginError, `not a LoginError: ${e}`);
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'LoginError');
  assert.equal(e.message, message);
  return true;
};

test('keys, limits and messages', () => {
  assert.equal(LOGIN_KEY, 'nocturne.login');
  assert.equal(AUTO_KEY, 'nocturne.auto');
  assert.equal(SIGNED_IN_KEY, 'nocturne.signedIn');
  assert.equal(OLD_TOKEN_KEY, 'nocturne.token');
  assert.equal(LOGIN_MAX_AGE_MS, 600_000);
  assert.equal(DEFAULT_LIFETIME_S, 28_800);
  assert.equal(RENEW_BEFORE_MS, 900_000);
  assert.deepEqual({ ...MESSAGES }, {
    starting: '로그인하는 중…',
    cancelled: '로그인을 취소했어요',
    failed: '로그인하지 못했어요. 잠시 뒤 다시 해 주세요',
    notAllowed: '이 GitHub 계정으로는 관리할 수 없어요',
    expired: '로그인이 끝났어요. 다시 로그인해 주세요',
    loggedOut: '로그아웃했어요',
    noStorage: '이 브라우저에서는 로그인할 수 없어요',
  });
});

test('base64url has no padding and no + or /', () => {
  assert.equal(base64url(new Uint8Array([0xfb, 0xff, 0xfe])), '-__-');
  assert.equal(base64url(new Uint8Array([1])), 'AQ');
  assert.equal(base64url(new Uint8Array([])), '');
});

test('challenge matches RFC 7636', async () => {
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('new logins are random and url-safe', () => {
  const a = newLogin(5);
  const b = newLogin(5);
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  for (const login of [a, b]) {
    assert.equal(login.state.length, 22);
    assert.equal(login.verifier.length, 43);
    assert.match(login.state, URL_SAFE);
    assert.match(login.verifier, URL_SAFE);
    assert.equal(login.at, 5);
  }
});

test('saved login is taken once', () => {
  const s = store();
  const login = { state: 'abc', verifier: 'def', at: 1234 };
  assert.equal(saveLogin(s, login), true);
  assert.deepEqual(takeLogin(s), login);
  assert.equal(takeLogin(s), null);
  assert.equal(s.getItem(LOGIN_KEY), null);
});

test('a saved login that is missing, unparsable or the wrong shape is null, and is removed', () => {
  assert.equal(takeLogin(store()), null);
  for (const text of ['not json', '{"state":1}', '{"state":"a","verifier":"b"}', '{"state":"a","verifier":"b","at":"1"}', 'null', '[]', '"x"']) {
    const s = store();
    s.setItem(LOGIN_KEY, text);
    assert.equal(takeLogin(s), null, text);
    assert.equal(s.getItem(LOGIN_KEY), null, text);
  }
});

test('storage that throws never throws out of the library', () => {
  const broken = brokenStore();
  const login = { state: 'a', verifier: 'b', at: 1 };
  assert.equal(saveLogin(broken, login), false);
  assert.equal(takeLogin(broken), null);
  assert.equal(remember(broken, 'k', 'v'), false);
  assert.equal(recall(broken, 'k'), null);
  assert.doesNotThrow(() => forget(broken, 'k'));
});

test('a saved login is removed even when reading it fails', () => {
  const removed = [];
  const readFails = { getItem: () => { throw new DOMException('blocked', 'SecurityError'); }, setItem: () => {}, removeItem: (key) => removed.push(key) };
  assert.equal(takeLogin(readFails), null);
  assert.deepEqual(removed, [LOGIN_KEY]);
});

test('remember, recall and forget', () => {
  const s = store();
  assert.equal(recall(s, SIGNED_IN_KEY), null);
  assert.equal(remember(s, SIGNED_IN_KEY, '1'), true);
  assert.equal(recall(s, SIGNED_IN_KEY), '1');
  forget(s, SIGNED_IN_KEY);
  assert.equal(recall(s, SIGNED_IN_KEY), null);
});

test('redirect is the bare admin address', () => {
  const of = (href) => redirectUri(at(href), resolveConfig(at(href)));
  assert.equal(of('https://hpotty36.github.io/nocturne/admin/?code=a&state=b'), 'https://hpotty36.github.io/nocturne/admin/');
  assert.equal(of('https://hpotty36.github.io/nocturne/admin/?api=http://127.0.0.1:8790&utm=x'), 'https://hpotty36.github.io/nocturne/admin/');
  assert.equal(of('https://hpotty36.github.io/nocturne/admin/index.html'), 'https://hpotty36.github.io/nocturne/admin/');
  assert.equal(
    of('http://localhost:8000/admin/?api=http%3A%2F%2F127.0.0.1%3A8790&code=a&state=b'),
    'http://localhost:8000/admin/?api=http%3A%2F%2F127.0.0.1%3A8790',
  );
  assert.equal(of('http://localhost:8000/admin/?api=http://localhost:9'), 'http://localhost:8000/admin/');
});

test('authorize URL', () => {
  const redirect = 'https://hpotty36.github.io/nocturne/admin/';
  const url = new URL(authorizeUrl(CONFIG, { state: 's', challenge: 'c', redirect }));
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: CONFIG.clientId,
    redirect_uri: redirect,
    state: 's',
    code_challenge: 'c',
    code_challenge_method: 'S256',
  });
});

test('authorize URL follows the fake in test mode', () => {
  const config = resolveConfig(at('http://localhost:8000/admin/?api=http://127.0.0.1:8790'));
  const url = new URL(authorizeUrl(config, { state: 's', challenge: 'c', redirect: 'http://localhost:8000/admin/' }));
  assert.equal(url.origin + url.pathname, 'http://127.0.0.1:8790/login/oauth/authorize');
});

test('reading the return', () => {
  assert.deepEqual(readReturn(at('https://x.test/admin/?code=a&state=b')), { code: 'a', state: 'b', error: null });
  assert.deepEqual(readReturn(at('https://x.test/admin/?error=access_denied&state=b')), { code: null, state: 'b', error: 'access_denied' });
  assert.equal(readReturn(at('https://x.test/admin/?api=x')), null);
  assert.equal(readReturn(at('https://x.test/admin/')), null);
});

test('checking the return', () => {
  const saved = { state: 's', verifier: 'v', at: 1000 };
  const ok = { code: 'k', state: 's', error: null };
  assert.deepEqual(checkReturn(saved, ok, 1000 + 600_000), { code: 'k', verifier: 'v' });
  assert.deepEqual(checkReturn(null, ok, 1000), { message: MESSAGES.failed });
  assert.deepEqual(checkReturn(saved, { ...ok, state: 't' }, 1000), { message: MESSAGES.failed });
  assert.deepEqual(checkReturn(saved, { ...ok, state: null }, 1000), { message: MESSAGES.failed });
  assert.deepEqual(checkReturn(saved, ok, 1000 + 600_001), { message: MESSAGES.failed });
  assert.deepEqual(checkReturn(saved, { code: null, state: 's', error: 'access_denied' }, 1000), { message: MESSAGES.cancelled });
  assert.deepEqual(checkReturn(saved, { code: null, state: 's', error: 'redirect_uri_mismatch' }, 1000), { message: MESSAGES.failed });
  assert.deepEqual(checkReturn(saved, { code: null, state: 's', error: null }, 1000), { message: MESSAGES.failed });
});

test('a cancelled login with the wrong state or too old is a failure, not a cancel', () => {
  const saved = { state: 's', verifier: 'v', at: 1000 };
  const denied = { code: null, state: 't', error: 'access_denied' };
  assert.deepEqual(checkReturn(saved, denied, 1000), { message: MESSAGES.failed });
  assert.deepEqual(checkReturn(saved, { ...denied, state: 's' }, 1000 + 600_001), { message: MESSAGES.failed });
  assert.deepEqual(checkReturn(null, { ...denied, state: 's' }, 1000), { message: MESSAGES.failed });
});

/** A fetch that records its call and answers with `answer(url, init)`. */
function fakeFetch(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { fetch, calls };
}

test('exchange success', async () => {
  const { fetch, calls } = fakeFetch(() => Response.json({ access_token: 'ghu_x', expires_in: 100 }));
  const got = await exchange(CONFIG, { code: 'k', verifier: 'v', redirect: 'r' }, { fetch, now: 5_000 });
  assert.deepEqual(got, { token: 'ghu_x', expiresAt: 5_000 + 100_000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CONFIG.exchange);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: 'k', code_verifier: 'v', redirect_uri: 'r' });
});

test('exchange uses the default lifetime when expires_in is missing or not a positive number', async () => {
  for (const body of [{ access_token: 'ghu_x' }, { access_token: 'ghu_x', expires_in: 'x' }, { access_token: 'ghu_x', expires_in: 0 },
    { access_token: 'ghu_x', expires_in: -5 }, { access_token: 'ghu_x', expires_in: null }]) {
    const { fetch } = fakeFetch(() => Response.json(body));
    const got = await exchange(CONFIG, { code: 'k', verifier: 'v', redirect: 'r' }, { fetch, now: 7 });
    assert.deepEqual(got, { token: 'ghu_x', expiresAt: 7 + 28_800_000 }, JSON.stringify(body));
  }
});

test('exchange reads the current time when none is given', async () => {
  const { fetch } = fakeFetch(() => Response.json({ access_token: 'ghu_x', expires_in: 100 }));
  const before = Date.now();
  const got = await exchange(CONFIG, { code: 'k', verifier: 'v', redirect: 'r' }, { fetch });
  assert.ok(got.expiresAt >= before + 100_000 && got.expiresAt <= Date.now() + 100_000);
});

test('exchange failures', async () => {
  const answers = {
    'fetch rejects': () => Promise.reject(new TypeError('Failed to fetch')),
    '400 with an error': () => Response.json({ error: 'bad_verification_code' }, { status: 400 }),
    '403': () => Response.json({ error: 'forbidden' }, { status: 403 }),
    '502': () => Response.json({ error: 'github_unreachable' }, { status: 502 }),
    '200 but html': () => new Response('<html>', { status: 200 }),
    '200 but empty object': () => Response.json({}),
    '200 but a list': () => Response.json([{ access_token: 'ghu_x' }]),
    '200 but null': () => Response.json(null),
    '200 but a token with a space': () => Response.json({ access_token: 'has space' }),
    '200 but an empty token': () => Response.json({ access_token: '' }),
    '200 but a token that is not text': () => Response.json({ access_token: 5 }),
    '400 even with a token': () => Response.json({ access_token: 'ghu_x' }, { status: 400 }),
  };
  for (const [name, answer] of Object.entries(answers)) {
    const { fetch } = fakeFetch(answer);
    await assert.rejects(exchange(CONFIG, { code: 'k', verifier: 'v', redirect: 'r' }, { fetch, now: 1 }), loginError(MESSAGES.failed), name);
  }
});

test('what to do on boot', () => {
  assert.equal(bootAction({ returned: true, signedIn: true, autoTried: false }), 'return');
  assert.equal(bootAction({ returned: true, signedIn: false, autoTried: true }), 'return');
  assert.equal(bootAction({ returned: false, signedIn: true, autoTried: false }), 'auto');
  assert.equal(bootAction({ returned: false, signedIn: true, autoTried: true }), 'button');
  assert.equal(bootAction({ returned: false, signedIn: false, autoTried: false }), 'button');
});

test('renewal window', () => {
  assert.equal(needsLogin(10_000_000, 10_000_000 - 900_001), false);
  assert.equal(needsLogin(10_000_000, 10_000_000 - 900_000), true);
  assert.equal(needsLogin(10_000_000, 10_000_001), true);
});

test('why GitHub said no', () => {
  assert.equal(rejectedMessage(401), MESSAGES.expired);
  assert.equal(rejectedMessage(403), MESSAGES.notAllowed);
});
