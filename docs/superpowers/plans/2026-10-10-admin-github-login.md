# Admin GitHub Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin page's pasted token + lock passphrase with a "GitHub로 로그인" button (GitHub App web flow with PKCE, code exchange in a Cloudflare Worker), keep the token only in page memory, and link the site and the admin page both ways.

**Architecture:** A DOM-free `admin/lib/auth.js` holds every login decision (PKCE, URLs, return checks, the code exchange, what to do on boot, expiry) and is unit-tested in Node; `admin/app.js` wires it to the page. `auth/worker.js` is a single-purpose Worker that swaps a code for a `ghu_` token using the App's client secret. The fake GitHub learns the authorize redirect and the Worker's `/token` so the whole flow runs locally.

**Tech Stack:** Vanilla ES modules (browser + Node 24 `node:test`), WebCrypto, Cloudflare Workers (module syntax, no build step), Python 3 standard library (`tests/fake_github.py`, `unittest`).

**Spec:** `docs/superpowers/specs/2026-10-10-admin-github-login-design.md`

## Global Constraints

- No real name anywhere in tracked files; the `workers.dev` subdomain is not a real name.
- The token is never written to localStorage, sessionStorage, cookies, a URL or a log. It lives only in the `GitHub` client object in memory.
- Browser keys: localStorage `nocturne.signedIn` = `"1"`; sessionStorage `nocturne.login` = `{state, verifier, at}`, sessionStorage `nocturne.auto` = `"1"`; old localStorage `nocturne.token` is removed on every boot.
- Admin CSP stays strict: `script-src 'self'`, no inline script or style, `connect-src https://api.github.com <Worker origin> http://127.0.0.1:*`. No `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval(`/`new Function` (static test).
- `?api=` is honoured only on a `localhost`/`127.0.0.1` page and only as `http://127.0.0.1:<port>` (existing `resolveConfig` rule).
- Colours only through the theme tokens (`--ink-dim`, `--ink`, `--lamp`, …). Admin usable at 375px wide.
- Copy (exact): `GitHub로 로그인`, `로그인`, `GitHub 계정으로 들어가요. 이 저장소에 쓸 수 있는 계정만 관리할 수 있어요.`, `로그인하는 중…`, `로그인을 취소했어요`, `로그인하지 못했어요. 잠시 뒤 다시 해 주세요`, `이 GitHub 계정으로는 관리할 수 없어요`, `로그인이 끝났어요. 다시 로그인해 주세요`, `로그아웃했어요`, `이 브라우저에서는 로그인할 수 없어요`.
- Worker accepts only Origin `https://hpotty36.github.io`; returns only `{access_token, expires_in}` on success; drops `refresh_token`.
- PC helper, Python `github_api.py`, workflows and `photos.json` are not touched.
- Tests: `node --test "tests/js/*.test.js"` and `py -m unittest discover -s tests -v`, both offline. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The callback arrives without the saved login (the phone opened it in another tab or app, or sessionStorage was cleared): the page must show `로그인하지 못했어요. 잠시 뒤 다시 해 주세요` with the button and never redirect again on its own. Pinned in Task 2 (`checkReturn(null, …)`, `bootAction` with `returned`) and checked in Task 6.
- The live page opened with a stray query (`?api=…`, `?utm=…`) or as `…/admin/index.html`: `redirect_uri` must still be exactly `https://hpotty36.github.io/nocturne/admin/`, or GitHub refuses the login. Pinned in Task 2 (`redirectUri`).
- GitHub answers a bad code with HTTP 200 and `{error}`: the Worker must answer 400 and the page must treat it as a failed login, never as a token. Pinned in Task 1 and Task 2 (`exchange`).
- Write refused with 403 after a good login (GitHub App not installed on `nocturne`): the page must say `이 GitHub 계정으로는 관리할 수 없어요`, not `로그인이 끝났어요…` (which would send the person round in circles). Pinned in Task 4 (`rejectedMessage`) and Task 3 (`reader` mode).
- Token near expiry while the tab sat in the background: on return the login screen shows before anything is typed. Pinned in Task 2 (`needsLogin` boundary) and checked in Task 6 with the fake's short `expires_in`.

---

### Task 1: Code-exchange Worker

**Files:**
- Create: `auth/worker.js`
- Test: `tests/js/auth-worker.test.js`

**Interfaces:**
- Produces: `auth/worker.js` with only a default export `{ async fetch(request, env) }` (no named exports: Cloudflare treats them as entrypoints). `env.CLIENT_ID`, `env.CLIENT_SECRET`. Route `POST|OPTIONS /token`.

- [ ] **Step 1: Write the failing tests** in `tests/js/auth-worker.test.js`. Import `worker from '../../auth/worker.js'`; stub GitHub with `mock.method(globalThis, 'fetch', …)` and restore after each test. Helpers: `post(body, origin = SITE)` builds `new Request('https://nocturne-auth.test/token', {method:'POST', headers:{Origin: origin, 'Content-Type':'application/json'}, body: typeof body === 'string' ? body : JSON.stringify(body)})`; `ENV = {CLIENT_ID: 'Iv-test', CLIENT_SECRET: 'shh'}`; `SITE = 'https://hpotty36.github.io'`; `GOOD = {code: 'c0de', code_verifier: 'v'.repeat(43), redirect_uri: 'https://hpotty36.github.io/nocturne/admin/'}`.
  - `other origins are refused before GitHub is asked`: Origin `https://evil.example` → 403; no Origin header → 403; `fetch` called 0 times.
  - `preflight from the site`: `OPTIONS /token` with Origin SITE → 204, `Access-Control-Allow-Origin` = SITE, `Access-Control-Allow-Methods` contains `POST`, `Access-Control-Allow-Headers` contains `Content-Type`; from elsewhere → 403.
  - `bad bodies are 400`: `'not json'`, `'[]'`, `{code:'c'}` (missing fields), `{...GOOD, code: 5}`, `{...GOOD, code: 'x'.repeat(513)}`, `{...GOOD, code: ''}` → each 400 `{error: 'bad_request'}`; `fetch` not called.
  - `the code goes to GitHub with the secret`: stub returns `Response.json({access_token: 'ghu_x', expires_in: 28800})`; assert the stub saw URL `https://github.com/login/oauth/access_token`, method POST, header `Accept: application/json`, JSON body deepEqual `{client_id: 'Iv-test', client_secret: 'shh', code: 'c0de', code_verifier: GOOD.code_verifier, redirect_uri: GOOD.redirect_uri}`.
  - `only the access token and its lifetime come back`: stub returns `{access_token: 'ghu_x', expires_in: 28800, refresh_token: 'ghr_y', refresh_token_expires_in: 15897600, scope: '', token_type: 'bearer'}` → 200, body deepEqual `{access_token: 'ghu_x', expires_in: 28800}`, raw text has no `ghr_`, headers `Access-Control-Allow-Origin` = SITE and `Cache-Control: no-store`. With no `expires_in` from GitHub → body `{access_token: 'ghu_x'}`.
  - `a GitHub error is 400`: stub returns HTTP 200 `{error: 'bad_verification_code', error_description: '…'}` → 400 `{error: 'bad_verification_code'}` with the CORS header.
  - `GitHub out of reach is 502`: stub throws `TypeError('fetch failed')`; stub returns status 500; stub returns 200 with body `'<html>'`; stub returns 200 `{}` → each 502 `{error: 'github_unreachable'}`.
  - `missing settings are 500`: `ENV` without `CLIENT_SECRET` → 500 `{error: 'not_configured'}`, `fetch` not called.
  - `other paths and methods`: `POST /` → 404; `GET /token` with Origin SITE → 405 with `Allow: POST, OPTIONS`.

- [ ] **Step 2: Run to see them fail**

Run: `node --test "tests/js/auth-worker.test.js"`
Expected: FAIL — `Cannot find module …/auth/worker.js`.

- [ ] **Step 3: Implement `auth/worker.js`**

A short header comment saying what it is and how to deploy it (paste into the Cloudflare dashboard; `CLIENT_ID` as a text variable, `CLIENT_SECRET` as a secret). Constants inside the module: `SITE = 'https://hpotty36.github.io'`, `GITHUB = 'https://github.com/login/oauth/access_token'`, `MAX_FIELD = 512`. Every response is JSON with `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, `Vary: Origin`, and `Access-Control-Allow-Origin: SITE` when the request's Origin is SITE. Order of checks: path → method → origin → settings → body → GitHub. Never log the code or the token.

- [ ] **Step 4: Run to see them pass**

Run: `node --test "tests/js/auth-worker.test.js"`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add auth/worker.js tests/js/auth-worker.test.js
git commit -m "Auth worker: swap a GitHub login code for a token"
```

---

### Task 2: Login library and config

**Files:**
- Create: `admin/lib/auth.js`
- Modify: `admin/config.js` (CONFIG + `resolveConfig`)
- Test: `tests/js/auth.test.js`, `tests/js/config.test.js`

**Interfaces:**
- Consumes: `CONFIG`, `resolveConfig(location)` from `admin/config.js`.
- Produces (`admin/config.js`): `CONFIG` gains `clientId: 'Iv23-not-set'`, `authorize: 'https://github.com/login/oauth/authorize'`, `exchange: 'https://nocturne-auth.invalid/token'` (the two placeholders are replaced in Task 7). In test mode `resolveConfig` also sets `authorize = <api>/login/oauth/authorize` and `exchange = <api>/_auth/token`.
- Produces (`admin/lib/auth.js`, DOM-free):
  - `LOGIN_KEY = 'nocturne.login'`, `AUTO_KEY = 'nocturne.auto'`, `SIGNED_IN_KEY = 'nocturne.signedIn'`, `OLD_TOKEN_KEY = 'nocturne.token'`
  - `LOGIN_MAX_AGE_MS = 600_000`, `DEFAULT_LIFETIME_S = 28_800`, `RENEW_BEFORE_MS = 900_000`
  - `MESSAGES = {starting: '로그인하는 중…', cancelled: '로그인을 취소했어요', failed: '로그인하지 못했어요. 잠시 뒤 다시 해 주세요', notAllowed: '이 GitHub 계정으로는 관리할 수 없어요', expired: '로그인이 끝났어요. 다시 로그인해 주세요', loggedOut: '로그아웃했어요', noStorage: '이 브라우저에서는 로그인할 수 없어요'}`
  - `class LoginError extends Error` (name `'LoginError'`)
  - `base64url(bytes: Uint8Array): string` (no padding)
  - `challengeFor(verifier: string): Promise<string>` — base64url(SHA-256(verifier as ASCII))
  - `newLogin(now: number): {state: string, verifier: string, at: number}` — state from 16, verifier from 32 `crypto.getRandomValues` bytes
  - `saveLogin(storage, login): boolean`; `takeLogin(storage): {state, verifier, at} | null` (always removes the key; null for missing, unparsable or wrongly shaped values, or when storage throws)
  - `remember(storage, key, value): boolean`, `recall(storage, key): string | null`, `forget(storage, key): void` — each swallows storage exceptions
  - `redirectUri(location, config): string`
  - `authorizeUrl(config, {state, challenge, redirect}): string`
  - `readReturn(location): {code: string|null, state: string|null, error: string|null} | null` — null when the query has neither `code` nor `error`
  - `checkReturn(saved, got, now): {code, verifier} | {message}`
  - `exchange(config, {code, verifier, redirect}, {fetch = globalThis.fetch, now = Date.now()} = {}): Promise<{token: string, expiresAt: number}>` — throws `LoginError(MESSAGES.failed)`
  - `bootAction({returned, signedIn, autoTried}): 'return' | 'auto' | 'button'`
  - `needsLogin(expiresAt: number, now: number): boolean`

- [ ] **Step 1: Write the failing tests**

`tests/js/config.test.js`: extend `CONFIG values` with the three new keys and values above; add `test mode points the login at the fake` — `resolveConfig(new URL('http://localhost:8000/admin/?api=http://127.0.0.1:8790'))` gives `authorize === 'http://127.0.0.1:8790/login/oauth/authorize'` and `exchange === 'http://127.0.0.1:8790/_auth/token'`; for `https://hpotty36.github.io/nocturne/admin/?api=http://127.0.0.1:8790` and for `http://localhost:8000/admin/?api=http://localhost:8790` they equal `CONFIG.authorize` / `CONFIG.exchange`.

`tests/js/auth.test.js` (a Map-backed storage stub `store()` with `getItem/setItem/removeItem`, and `brokenStore()` whose methods throw):
  - `challenge matches RFC 7636`: `await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'`.
  - `new logins are random and url-safe`: two `newLogin(5)` calls differ; `state` length 22, `verifier` length 43, both `/^[A-Za-z0-9_-]+$/`; `at === 5`.
  - `saved login is taken once`: `saveLogin(s, L)` true → `takeLogin(s)` deepEqual L → second `takeLogin(s)` null. `takeLogin` null for `'not json'`, `'{"state":1}'`, missing key; `saveLogin(brokenStore(), L) === false`, `takeLogin(brokenStore()) === null`; `remember/recall/forget` on `brokenStore()` do not throw (`recall` → null).
  - `redirect is the bare admin address`: with `config = resolveConfig(url)` each time — `https://hpotty36.github.io/nocturne/admin/?code=a&state=b` → `https://hpotty36.github.io/nocturne/admin/`; `…/admin/?api=http://127.0.0.1:8790&utm=x` → `https://hpotty36.github.io/nocturne/admin/`; `…/admin/index.html` → `https://hpotty36.github.io/nocturne/admin/`; `http://localhost:8000/admin/?api=http%3A%2F%2F127.0.0.1%3A8790&code=a&state=b` → `http://localhost:8000/admin/?api=http%3A%2F%2F127.0.0.1%3A8790`; `http://localhost:8000/admin/?api=http://localhost:9` → `http://localhost:8000/admin/`.
  - `authorize URL`: `new URL(authorizeUrl(CONFIG, {state:'s', challenge:'c', redirect:'https://hpotty36.github.io/nocturne/admin/'}))` has origin+path `https://github.com/login/oauth/authorize` and params exactly `{client_id: CONFIG.clientId, redirect_uri: 'https://hpotty36.github.io/nocturne/admin/', state: 's', code_challenge: 'c', code_challenge_method: 'S256'}`.
  - `reading the return`: `?code=a&state=b` → `{code:'a', state:'b', error:null}`; `?error=access_denied&state=b` → `{code:null, state:'b', error:'access_denied'}`; `?api=x` → null; no query → null.
  - `checking the return`: `saved = {state:'s', verifier:'v', at:1000}`; `(saved, {code:'k', state:'s', error:null}, 1000 + 600_000)` → `{code:'k', verifier:'v'}`; `(null, …)` → `{message: MESSAGES.failed}`; state `'t'` → failed; `now = 1000 + 600_001` → failed; `{code:null, state:'s', error:'access_denied'}` → `{message: MESSAGES.cancelled}`; error `'redirect_uri_mismatch'` → failed; `{code:null, state:'s', error:null}` → failed.
  - `exchange success`: fake fetch records its call and returns `Response.json({access_token:'ghu_x', expires_in: 100})`; result `{token:'ghu_x', expiresAt: now + 100_000}`; the call was `POST config.exchange`, `Content-Type: application/json`, body deepEqual `{code:'k', code_verifier:'v', redirect_uri:'r'}`. Without `expires_in` (or `expires_in: 'x'`, `0`) → `expiresAt = now + 28_800_000`.
  - `exchange failures`: fetch rejects; status 400 `{error:'bad_verification_code'}`; status 502; 200 with `'<html>'`; 200 `{}`; 200 `{access_token: 'has space'}` → each rejects with `LoginError` whose message is `MESSAGES.failed`.
  - `what to do on boot`: `{returned:true, signedIn:true, autoTried:false}` → `'return'`; `{returned:true, signedIn:false, autoTried:true}` → `'return'`; `{returned:false, signedIn:true, autoTried:false}` → `'auto'`; `{returned:false, signedIn:true, autoTried:true}` → `'button'`; `{returned:false, signedIn:false, autoTried:false}` → `'button'`.
  - `renewal window`: `needsLogin(10_000_000, 10_000_000 - 900_001) === false`; `needsLogin(10_000_000, 10_000_000 - 900_000) === true`; `needsLogin(10_000_000, 10_000_001) === true`.

- [ ] **Step 2: Run to see them fail**

Run: `node --test "tests/js/auth.test.js" "tests/js/config.test.js"`
Expected: FAIL — module `admin/lib/auth.js` not found; CONFIG values differ.

- [ ] **Step 3: Implement**

`admin/config.js`: add the three keys (comment that `clientId` and `exchange` are set at rollout from the GitHub App and the Worker) and, inside the existing test-mode branch, derive `authorize` and `exchange` from the accepted local origin.

`admin/lib/auth.js`: header comment in the style of the other `lib/` files (what it decides, that it never stores the token). `redirectUri`: `location.origin + pathname` with a trailing `index.html` cut off, plus `?api=<config.api>` (URL-encoded via `URLSearchParams`) only when `config.api !== CONFIG.api`. `exchange`: `fetch(config.exchange, {method:'POST', headers:{'Content-Type':'application/json'}, body, signal: AbortSignal.timeout(30_000)})`; accept only `response.ok` + JSON object + `access_token` matching `/^[\x21-\x7e]+$/`; `expires_in` used only when a positive finite number. `checkReturn` order: saved missing / state differs / `now - saved.at > LOGIN_MAX_AGE_MS` → failed; then `error` (`access_denied` → cancelled, else failed); then missing code → failed.

- [ ] **Step 4: Run to see them pass**

Run: `node --test "tests/js/*.test.js"`
Expected: PASS (whole JS suite; nothing else uses the new keys yet).

- [ ] **Step 5: Commit**

```bash
git add admin/lib/auth.js admin/config.js tests/js/auth.test.js tests/js/config.test.js
git commit -m "Admin: login library (PKCE, return checks, code exchange) and login config"
```

---

### Task 3: Fake GitHub login

**Files:**
- Modify: `tests/fake_github.py`
- Test: `tests/test_fake_github.py`

**Interfaces:**
- Produces: `GET /login/oauth/authorize` → 302; `POST /_auth/token` → JSON; control `PUT /_fake/login {mode, expires_in?}`; Python `FakeGitHub.set_login(mode, expires_in=28800)`. Modes `ok` (default), `deny`, `down`, `reader`. `handle()` may now return `(302, Redirect(location))` where `Redirect` is a module-level `str` subclass; the HTTP handler sends it as a `Location` header with an empty body.

- [ ] **Step 1: Write the failing tests** (new `FakeLoginTests` in `tests/test_fake_github.py`; call `self.fake.handle` directly; RFC 7636 pair `VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'`, `CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'`; `BACK = 'http://localhost:8000/admin/?api=http%3A%2F%2F127.0.0.1%3A8790'`):
  - `test_authorize_sends_the_browser_back_with_a_code`: authorize with `client_id=x, redirect_uri=BACK, state=s1, code_challenge=CHALLENGE, code_challenge_method=S256` → status 302, `isinstance(payload, Redirect)`, payload starts with `BACK + '&'`, its query has `state == 's1'`, a non-empty `code`, and still `api == 'http://127.0.0.1:8790'`. With `redirect_uri=http://localhost:8000/admin/` the code follows `?`.
  - `test_authorize_needs_a_redirect_and_s256`: no `redirect_uri` → 400; `code_challenge_method=plain` → 400; no `code_challenge` → 400.
  - `test_token_needs_the_matching_verifier_and_works_once`: code from authorize; POST `/_auth/token` `{code, code_verifier: VERIFIER, redirect_uri: BACK}` → 200 `{"access_token": "test-token", "expires_in": 28800}`; same again → 400 `{"error": "bad_verification_code"}`; a fresh code with verifier `'x' * 43` → 400; unknown code → 400; no Authorization header needed.
  - `test_login_modes`: `set_login('deny')` → authorize redirects with `error=access_denied` and the state, no code; `set_login('down')` → token 502 `{"error": "github_unreachable"}`; `set_login('reader')` → `GET /repos/{R}` (with AUTH) has `permissions.push is False`; `set_login('ok', expires_in=900)` → token answer has `expires_in == 900` and push is True again. Via HTTP-less control: `handle('PUT', '/_fake/login', {}, b'{"mode":"nope"}')` → 400.
  - extend `FakeHttpTests` with `test_login_over_http`: an opener that does not follow redirects (`urllib.request.build_opener` with a `HTTPRedirectHandler` whose `redirect_request` returns None) gets 302 and a `Location` header for authorize; `POST /_auth/token` over HTTP returns JSON with `Access-Control-Allow-Origin: *`.

- [ ] **Step 2: Run to see them fail**

Run: `py -m unittest discover -s tests -p "test_fake_github.py" -v`
Expected: FAIL — `ImportError: cannot import name 'Redirect'` / `AttributeError: set_login`.

- [ ] **Step 3: Implement** in `tests/fake_github.py`: login state on `FakeGitHub` (`_login_mode`, `_expires_in`, `_codes: {code: challenge}`, under `self._lock`); in `handle`, route the two login paths before the `/repos/` check without auth and without logging them in `requests`; `reader` makes the repo JSON's `permissions.push` False; codes from `secrets.token_urlsafe(16)`; the challenge check is `base64.urlsafe_b64encode(sha256(verifier)).rstrip(b"=")`; codes are popped on first use whatever the outcome; `_send` takes extra headers so `_serve` can send `Location`. Mention the login routes in the module docstring.

- [ ] **Step 4: Run to see them pass**

Run: `py -m unittest discover -s tests -v`
Expected: PASS (whole Python suite).

- [ ] **Step 5: Commit**

```bash
git add tests/fake_github.py tests/test_fake_github.py
git commit -m "Fake GitHub: login redirect, token exchange and login modes"
```

---

### Task 4: Admin page on GitHub login

**Files:**
- Modify: `admin/index.html`, `admin/app.js`, `admin/admin.css`, `admin/lib/github.js:21` (`AUTH_MESSAGE`)
- Delete: `admin/lib/vault.js`, `tests/js/vault.test.js`
- Test: `tests/test_admin_static.py`, `tests/js/github.test.js:23`, `tests/js/github.fake.test.js:115`, `tests/js/auth.test.js`

**Interfaces:**
- Consumes: everything Task 2 exports from `admin/lib/auth.js`; `GitHub`, `AuthError`, `GitHubError` from `admin/lib/github.js`; `canPush(repo)`.
- Produces: `rejectedMessage(status: number): string` exported from `admin/lib/auth.js` (added in this task): `401` → `MESSAGES.expired`, anything else (`403`) → `MESSAGES.notAllowed`.

- [ ] **Step 1: Write the failing tests**
  - `tests/test_admin_static.py`: `LABELS` drops `"잠금 비밀번호"` and `"토큰을 다시 넣어 주세요"` and gains `"GitHub로 로그인"`, `"로그인하는 중…"`, `"로그인을 취소했어요"`, `"로그인하지 못했어요. 잠시 뒤 다시 해 주세요"`, `"이 GitHub 계정으로는 관리할 수 없어요"`, `"로그인이 끝났어요. 다시 로그인해 주세요"`, `"로그아웃했어요"`. `test_csp_and_no_inline` asserts `connect-src https://api.github.com {origin} http://127.0.0.1:*;` where `origin` is the scheme+host of the `exchange: '…'` value read from `admin/config.js` with a regex (so the CSP and config can never drift). New `test_no_stored_token`: `admin/lib/vault.js` does not exist; no admin `.js` contains `seal(`; `'nocturne.token'` occurs exactly once across admin `.js` files, in `admin/lib/auth.js` (the `OLD_TOKEN_KEY` constant). New `test_site_link_opens_a_new_tab`: `admin/index.html` contains `<a class="mark" href="../" target="_blank" rel="noopener">Nocturne</a>`.
  - `tests/js/github.test.js` `AUTH` and `tests/js/github.fake.test.js:115` expect `'로그인이 끝났어요. 다시 로그인해 주세요'`.
  - `tests/js/auth.test.js`, new test `why GitHub said no`: `rejectedMessage(401) === MESSAGES.expired`, `rejectedMessage(403) === MESSAGES.notAllowed`.

- [ ] **Step 2: Run to see them fail**

Run: `py -m unittest discover -s tests -p "test_admin_static.py" -v` and `node --test "tests/js/*.test.js"`
Expected: FAIL — labels missing, CSP lacks the Worker origin, `rejectedMessage` missing, auth message differs.

- [ ] **Step 3: Implement**
  - `admin/lib/github.js`: `AUTH_MESSAGE = '로그인이 끝났어요. 다시 로그인해 주세요'`. `admin/lib/auth.js`: add `rejectedMessage`.
  - `admin/index.html`: CSP `connect-src` gains the Worker origin (`https://nocturne-auth.invalid` until Task 7). Remove the `setup` and `unlock` sections. Add the `login` section — `<section class="gate" id="login" aria-labelledby="login-title" hidden>` with `h2.gate-title#login-title` "로그인", `p.gate-note` (the copy above), `button.btn.btn-main#login-start type="button"` "GitHub로 로그인", `p.msg#login-msg role="status" aria-live="polite"`. Brand link becomes the exact markup in the static test.
  - `admin/app.js` (keep the tabs, site status and `__nocturne` hook as they are; rewrite the header comment for the new model):
    - module state: `client`, `expiresAt`.
    - `show(screen)` over `['login', 'desk']`; `openLogin(message = '', isError = false)` shows it, says the message, focuses `#login-start`, clears its `aria-disabled`.
    - `startLogin()`: sets `aria-disabled="true"` on the button (ignore clicks while set); `newLogin(Date.now())`; if `!saveLogin(sessionStorage, login)` → `openLogin(MESSAGES.noStorage, true)`; else `location.assign(authorizeUrl(config, {state, challenge: await challengeFor(verifier), redirect: redirectUri(location, config)}))`.
    - `finishLogin(got)`: `history.replaceState(null, '', redirectUri(location, config))`; `checkReturn(takeLogin(sessionStorage), got, Date.now())`; on `{message}` → `openLogin(message, true)`; else boot line says `MESSAGES.starting`, `exchange(...)`, `new GitHub({token, api: config.api})`, `canPush(config.repo)` false → `openLogin(MESSAGES.notAllowed, true)`; success → `remember(localStorage, SIGNED_IN_KEY, '1')`, `forget(sessionStorage, AUTO_KEY)`, set `expiresAt`, `enter(github)`. Errors: `LoginError` → its message; `AuthError` → `MESSAGES.failed`; other `GitHubError` → its message. None of these clears `AUTO_KEY`.
    - `call()`'s rejection hook becomes `tokenRejected(status)` → `lock(); openLogin(rejectedMessage(status), true)`.
    - `visibilitychange`: when visible, `client` set and `needsLogin(expiresAt, Date.now())` → `lock(); openLogin(MESSAGES.expired, true)`.
    - logout: `forget(localStorage, SIGNED_IN_KEY)`, `lock()`, `openLogin(MESSAGES.loggedOut)`.
    - start: `forget(localStorage, OLD_TOKEN_KEY)`; `got = readReturn(location)`; `bootAction({returned: got !== null, signedIn: recall(localStorage, SIGNED_IN_KEY) === '1', autoTried: recall(sessionStorage, AUTO_KEY) === '1'})` → `'return'`: `finishLogin(got)`; `'auto'`: `remember(sessionStorage, AUTO_KEY, '1')`, boot line `MESSAGES.starting`, `startLogin()`; `'button'`: `openLogin()`.
  - `admin/admin.css`: style the button and message directly inside `.gate` (button `min-width: 8rem`, full width under the existing narrow breakpoint as `.gate-form .btn-main` does; message `margin-top: 16px`); delete rules that no longer match any element (`.token-field`, `.gate-form`, `.gate-alt`, and any others the removed sections used — grep each selector in `admin/`).
  - `git rm admin/lib/vault.js tests/js/vault.test.js`.

- [ ] **Step 4: Run to see them pass**

Run: `node --test "tests/js/*.test.js"` and `py -m unittest discover -s tests -v`
Expected: PASS (both suites).

- [ ] **Step 5: Commit**

```bash
git add -A admin tests
git commit -m "Admin: GitHub login replaces the pasted token and lock passphrase"
```

---

### Task 5: Site footer link and docs

**Files:**
- Modify: `src/template.html` (footer markup ~line 446, `.foot` CSS ~line 313), `CLAUDE.md`, `README.md:6`
- Test: `tests/test_build.py`

**Interfaces:** none (markup and docs).

- [ ] **Step 1: Write the failing test** `test_footer_links_to_the_admin_page` in `tests/test_build.py`: the built page's `<footer class="foot">…</footer>` block contains `· <a class="foot-admin" href="admin/">관리</a></p>` at the end of its last `<p>`.

- [ ] **Step 2: Run to see it fail**

Run: `py -m unittest discover -s tests -p "test_build.py" -v`
Expected: FAIL on the new test only.

- [ ] **Step 3: Implement**
  - `src/template.html`: append ` · <a class="foot-admin" href="admin/">관리</a>` to the last footer line; CSS `.foot a { color: var(--ink-dim); text-underline-offset: 3px; }` and `.foot a:hover { color: var(--ink); }` (focus keeps the global `--lamp` outline).
  - `CLAUDE.md` per spec §6: structure (`auth/worker.js`; `lib/` list gains `auth`, loses `vault`); "관리 페이지를 컴퓨터에서만 시험하기" (no token or passphrase: press "GitHub로 로그인" and the fake lets you in; `PUT /_fake/login` modes for failure checks); "토큰 만들기" becomes **관리 페이지 로그인 준비** (GitHub App table from spec §1, installing it on `nocturne`, Worker in the Cloudflare dashboard with `CLIENT_ID`/`CLIENT_SECRET`, where Client ID and Worker URL go: `admin/config.js` and the CSP in `admin/index.html`) and **PC 도우미 토큰** (the current PC steps, Contents Read and write only); "문제가 생기면" gains 로그인이 안 될 때 (Worker answering? `curl` check from Task 7; App installed on `nocturne`; a new client secret must also go into the Worker; phone browser logged in to github.com; `이 GitHub 계정으로는 관리할 수 없어요` right after login usually means the App is not installed on `nocturne`) and "토큰이 만료되면" keeps only the PC helper part; "알아둘 것": the admin token is an 8-hour `ghu_` token kept only in memory, and the `hpotty36.github.io` same-origin note now concerns only `nocturne.signedIn` and the Worker's CORS. Remove every mention of 잠금 비밀번호 and the admin's sealed token.
  - `README.md:6`: "(GitHub로 로그인, 이 저장소에 쓸 수 있는 계정만)".

- [ ] **Step 4: Run to see it pass**

Run: `py -m unittest discover -s tests -v`
Expected: PASS. Also `grep -n "잠금 비밀번호\|vault" CLAUDE.md README.md` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/template.html tests/test_build.py CLAUDE.md README.md
git commit -m "Site: footer link to the admin page; docs for GitHub login"
```

---

### Task 6: Local end-to-end check (controller, in the browser pane)

**Files:** none changed unless a check fails (then fix in the owning task's files, re-run its tests, commit `Fix: …`).

- [ ] **Step 1:** Start `py tests\fake_github.py --port 8790 --seed` and `py tests\browser\serve.py --port 8000` in the background. Open `http://localhost:8000/admin/?api=http://127.0.0.1:8790`.
- [ ] **Step 2: First login.** Expected: login screen with the button; click → back on the admin page, desk visible, both tabs load, address bar shows `…/admin/?api=…` without `code`/`state`; `localStorage['nocturne.signedIn'] === '1'`; no key holds `test-token` (`JSON.stringify({...localStorage, ...sessionStorage})` lacks it).
- [ ] **Step 3: Reload.** Expected: "로그인하는 중…" then the desk with no click.
- [ ] **Step 4: Logout, then reload.** Expected: "로그아웃했어요"; after reload the button, no automatic redirect.
- [ ] **Step 5: Failure modes** via `curl -X PUT http://127.0.0.1:8790/_fake/login -d "{\"mode\":\"deny\"}"` (then `down`, `reader`), clicking the button each time. Expected messages: `로그인을 취소했어요`, `로그인하지 못했어요. 잠시 뒤 다시 해 주세요`, `이 GitHub 계정으로는 관리할 수 없어요`. After `down`: set `signedIn` by a successful login first, switch to `down`, reload → one automatic try, the failed message, and a further reload shows the button without redirecting (no loop).
- [ ] **Step 6: Lost session.** Mode `ok`. Get a callback URL without going through the page: `curl -s -o /dev/null -w "%{redirect_url}" "http://127.0.0.1:8790/login/oauth/authorize?client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fadmin%2F%3Fapi%3Dhttp%253A%252F%252F127.0.0.1%253A8790&state=zz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"`, open it in a new tab (fresh sessionStorage). Expected: `로그인하지 못했어요. 잠시 뒤 다시 해 주세요` with the button, no redirect, `code` gone from the address bar.
- [ ] **Step 7: Expiry.** `{"mode":"ok","expires_in":900}`, log in, switch to another tab and back (or dispatch `visibilitychange` after `Object.defineProperty(document, 'visibilityState', {value: 'visible'})`) → login screen with `로그인이 끝났어요. 다시 로그인해 주세요`.
- [ ] **Step 8: Links and width.** "Nocturne" opens the site in a new tab; `py scripts\build.py` then the site footer shows "관리" linking to `admin/`. At 375×812 the login screen and button fit without horizontal scroll. No CSP errors in the console.
- [ ] **Step 9:** Stop both servers; delete `index.html` if built. Run both test suites once more. Expected: PASS.

---

### Task 7: Rollout (with the user)

**Files:**
- Modify: `admin/config.js` (`clientId`, `exchange`), `admin/index.html` (CSP origin), `tests/js/config.test.js` (CONFIG values)

- [ ] **Step 1 (user):** Cloudflare free account; pick a `workers.dev` subdomain that is not a real name.
- [ ] **Step 2 (user):** Create the GitHub App with the values in spec §1, install it on `nocturne` only, note the Client ID, generate a client secret.
- [ ] **Step 3 (user):** Cloudflare dashboard → create a Worker named `nocturne-auth` → paste `auth/worker.js` → deploy → add `CLIENT_ID` (text) and `CLIENT_SECRET` (secret) → deploy. The secret is typed by the user only.
- [ ] **Step 4: Check the Worker.**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://nocturne-auth.<sub>.workers.dev/token -H "Origin: https://evil.example"`
Expected: `403`.
Run: `curl -s -X POST https://nocturne-auth.<sub>.workers.dev/token -H "Origin: https://hpotty36.github.io" -H "Content-Type: application/json" -d "{\"code\":\"x\",\"code_verifier\":\"y\",\"redirect_uri\":\"https://hpotty36.github.io/nocturne/admin/\"}"`
Expected: `{"error":"bad_verification_code"}` (`{"error":"Not Found"}` means `CLIENT_ID` is wrong: use the Client ID `Iv23…`, not the numeric App ID; `incorrect_client_credentials` means the secret (or the ID) is wrong; `not_configured` means a variable is missing; `github_unreachable` means the Worker could not reach GitHub).
- [ ] **Step 5:** Put the Client ID and `https://nocturne-auth.<sub>.workers.dev/token` into `admin/config.js`, the origin into the CSP, the values into `tests/js/config.test.js`. Run both suites (PASS); `grep -rn "not-set\|nocturne-auth.invalid" admin tests` prints nothing. Commit `Admin: GitHub App client ID and auth worker address`.
- [ ] **Step 6:** Ask the user, then merge `admin-login` into `main` and push. Watch `site.yml` finish (`gh run list -R HPotty36/nocturne -L 3`).
- [ ] **Step 7 (user + controller):** Log in on the PC and the Android phone. Confirm: second visit needs no click; GitHub does not ask again; the GitHub app on the phone does not grab the login page; uploading one photo still works. Right after the deploy GitHub Pages may serve the old admin files from cache for up to 10 minutes: a page stuck at "불러오는 중…" then needs a reload (or 10 minutes' wait), not a fix.
- [ ] **Step 8 (user):** Delete the old admin fine-grained token on GitHub (the PC helper's token stays).
