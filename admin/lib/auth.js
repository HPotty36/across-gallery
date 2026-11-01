// "GitHub로 로그인" without a page: the decisions of the login (PKCE codes, the redirect address, checking what GitHub
// sent back, trading the code for a token at the Worker, when to log in again). DOM-free ES module for browsers and
// Node 24; storage, `fetch` and the clock are passed in. It never stores the token: exchange() hands it to the caller,
// who keeps it in memory only (storage here holds just the login in progress and two flags).

import { CONFIG } from '../config.js';
import { AuthError, GitHubError } from './github.js';

export const LOGIN_KEY = 'nocturne.login'; // sessionStorage: {state, verifier, at} of the login in progress
export const AUTO_KEY = 'nocturne.auto'; // sessionStorage: the automatic sign-in was already tried in this tab
export const SIGNED_IN_KEY = 'nocturne.signedIn'; // localStorage: this browser has logged in before
export const OLD_TOKEN_KEY = 'nocturne.token'; // localStorage: the sealed token of the old paste-a-token login, removed on boot

export const LOGIN_MAX_AGE_MS = 600_000; // a login must come back within this long after it started
export const DEFAULT_LIFETIME_S = 28_800; // token lifetime when the Worker does not say
export const RENEW_BEFORE_MS = 900_000; // log in again this long before the token ends
const EXCHANGE_TIMEOUT_MS = 30_000;
const TOKEN_FORMAT = /^[\x21-\x7e]+$/; // printable ASCII without spaces: all a GitHub token is, and all a header may hold

export const MESSAGES = Object.freeze({
  starting: '로그인하는 중…',
  cancelled: '로그인을 취소했어요',
  failed: '로그인하지 못했어요. 잠시 뒤 다시 해 주세요',
  notAllowed: '이 GitHub 계정으로는 관리할 수 없어요',
  notInstalled: 'GitHub App이 nocturne 저장소에 설치되어 있지 않아요',
  expired: '로그인이 끝났어요. 다시 로그인해 주세요',
  loggedOut: '로그아웃했어요',
  noStorage: '이 브라우저에서는 로그인할 수 없어요',
});

export class LoginError extends Error {
  /** The login did not work; the message is for the person (one of MESSAGES), never a detail from the network. */
  constructor(message) {
    super(message);
    this.name = 'LoginError';
  }
}

/** URL-safe base64 without padding (RFC 4648 section 5), as PKCE and `state` want it. */
export function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** The PKCE S256 challenge of a verifier: base64url(SHA-256(verifier as ASCII)). */
export async function challengeFor(verifier) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function randomText(byteCount) {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(byteCount)));
}

/** A fresh login in progress started at `now` (ms): a 22-character state and a 43-character PKCE verifier. */
export function newLogin(now) {
  return { state: randomText(16), verifier: randomText(32), at: now };
}

/** Keep `value` under `key`. False when the storage refuses (blocked site data, private window). */
export function remember(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** What is kept under `key`, or null when nothing is or the storage refuses. */
export function recall(storage, key) {
  try {
    return storage.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Remove `key`; a storage that refuses is ignored. */
export function forget(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // nothing to remove from a storage we cannot use
  }
}

/** Keep the login in progress until GitHub sends the person back. False when it could not be kept. */
export function saveLogin(storage, login) {
  return remember(storage, LOGIN_KEY, JSON.stringify({ state: login.state, verifier: login.verifier, at: login.at }));
}

/** The saved login, removing it so it can be used once. Null when there is none, it is damaged, or the storage refuses. */
export function takeLogin(storage) {
  const text = recall(storage, LOGIN_KEY);
  forget(storage, LOGIN_KEY);
  let login = null;
  try {
    login = JSON.parse(text);
  } catch {
    return null;
  }
  const ok = login !== null && typeof login === 'object' && !Array.isArray(login)
    && typeof login.state === 'string' && login.state !== '' && typeof login.verifier === 'string' && login.verifier !== ''
    && typeof login.at === 'number' && Number.isFinite(login.at);
  return ok ? { state: login.state, verifier: login.verifier, at: login.at } : null;
}

/**
 * Where GitHub sends the person back to: this admin page without any code, state, or other query. GitHub compares it
 * with the callback URL registered for the app, so it must be the same every time. Only the test-mode `?api=` stays.
 */
export function redirectUri(location, config) {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  if (config.api === CONFIG.api) return base;
  return `${base}?${new URLSearchParams({ api: config.api })}`;
}

/** The GitHub page that asks the person to allow the login. */
export function authorizeUrl(config, { state, challenge, redirect }) {
  const url = new URL(config.authorize);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** What GitHub sent back in the address, or null when the page was not opened by a login (no `code`, no `error`). */
export function readReturn(location) {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (code === null && error === null) return null;
  return { code, state: params.get('state'), error };
}

/**
 * Whether what came back belongs to the login we started: `{code, verifier}` to go on with, or `{message}` to show.
 * A missing, mismatched or old login is a failure before anything GitHub said is believed, so a stranger's link cannot
 * make the page look cancelled either.
 */
export function checkReturn(saved, got, now) {
  if (!saved || got.state !== saved.state || now - saved.at > LOGIN_MAX_AGE_MS) return { message: MESSAGES.failed };
  if (got.error) return { message: got.error === 'access_denied' ? MESSAGES.cancelled : MESSAGES.failed };
  if (!got.code) return { message: MESSAGES.failed };
  return { code: got.code, verifier: saved.verifier };
}

/**
 * Trade the login code for a token at the Worker. Anything but a successful answer with a usable token is a failed
 * login (LoginError); the reason from the network is not shown. `expiresAt` is in ms, like `now`.
 */
export async function exchange(config, { code, verifier, redirect }, { fetch = globalThis.fetch, now = Date.now() } = {}) {
  let answer;
  try {
    const response = await fetch(config.exchange, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    answer = await response.json();
  } catch {
    throw new LoginError(MESSAGES.failed);
  }
  const token = answer?.access_token;
  if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) throw new LoginError(MESSAGES.failed);
  const seconds = Number.isFinite(answer.expires_in) && answer.expires_in > 0 ? answer.expires_in : DEFAULT_LIFETIME_S;
  return { token, expiresAt: now + seconds * 1000 };
}

/**
 * What the page does when it opens: finish a login that just came back ('return'), try signing in again once for
 * someone who has logged in before ('auto'), or show the login button ('button').
 */
export function bootAction({ returned, signedIn, autoTried }) {
  if (returned) return 'return';
  return signedIn && !autoTried ? 'auto' : 'button';
}

/** True from RENEW_BEFORE_MS before the token ends (and after): time to log in again. */
export function needsLogin(expiresAt, now) {
  return expiresAt - now <= RENEW_BEFORE_MS;
}

/**
 * What to say when GitHub turns the token down while the page works: 401, the login has ended; 403, the login worked
 * but this account may not write here (usually the app is not installed on the repository), so logging in again
 * would not help.
 */
export function rejectedMessage(status) {
  return status === 401 ? MESSAGES.expired : MESSAGES.notAllowed;
}

/**
 * What to say when a login fails after GitHub sent the person back (the code exchange or the first look at the
 * repository). A new token GitHub refuses at once is a failed login, not an ended one; a 403 is an account that may
 * not write here. Other GitHub errors say what went wrong (offline, rate limit); anything else is a plain failure.
 */
export function loginFailureMessage(error) {
  if (error instanceof LoginError) return error.message;
  if (error instanceof AuthError) return error.status === 403 ? MESSAGES.notAllowed : MESSAGES.failed;
  if (error instanceof GitHubError) return error.message;
  return MESSAGES.failed;
}
