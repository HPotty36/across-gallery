# Admin Redesign, Install and Share Implementation Plan (part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin page the site's black one-serif look, let people edit the English texts and see per-language AI badges, make the admin page installable on its own with an Android "share → Nocturne 관리" upload, and clear the small defects part 1 deferred.

**Architecture:** The admin page stays a static, CSP-locked ES-module app under `admin/`. Look = `admin/admin.css` rewritten on the site's five tokens plus small markup changes in the two views. English editing extends `admin/lib/gallery.js` (`saveEdits`, `badges`) and the two views. Install/share = a static `admin/manifest.webmanifest`, inverted icons in `admin/icons/`, a tiny `admin/sw.js` (scope `admin/`) that only turns the share POST into cached files plus a 303, and `admin/lib/shared.js` that the page uses to offer them. Cleanup touches `src/template.html`, `src/sw.js`, `scripts/build.py`, `scripts/pc_helper.py`, `scripts/worker.py`, `scripts/curator.py`.

**Tech Stack:** Plain ES modules (no build step), CSS, Python 3 unittest, `node --test` (Node 24), Pillow.

**Spec:** `docs/superpowers/specs/2026-11-02-admin-redesign-share-design.md` (Korean). Read the section your task names.

## Global Constraints

- No external scripts; the admin CSP in `admin/index.html` stays byte-for-byte the same; no inline scripts or `style=` attributes in admin HTML; no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval(`/`new Function` anywhere in `admin/**/*.js`.
- Photo and AI text reaches the page only through `textContent` and `value`.
- The token lives only in memory (`app.js` `client`); never in storage, URLs or logs.
- Every Korean label listed in `tests/test_admin_static.py` `LABELS` keeps existing verbatim.
- Admin tokens = site tokens exactly: `color-scheme: dark; --ground: #000; --wall: #111; --ink: #ebe9e4; --ink-dim: #8f8c86; --rule: #262624;` — no `--lamp`, no `--lb-*`, no light theme, no other colour literals in `admin/admin.css` except inside `color-mix(...)` with tokens.
- One font: `"Noto Serif KR"` 400 via `https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400&display=swap` with `crossorigin` on the stylesheet link. Sizes only 14px, 13px, 12px, and 16px for `input, select, textarea`. No `font-style: italic`, `letter-spacing`, `text-transform`, `font-weight` other than 400.
- 375px wide must work: no horizontal scroll; buttons and inputs at least 44px tall.
- photos.json key order for new keys: `file, title, alt, title_en, alt_en, date, camera, ai`; existing keys change in place. Canonical text format via `serialize` (JS) / `dumps_data` (Python).
- Korean copy is short and plain. New exact strings: `영어 제목`, `영어 설명`, ` · AI` (label suffix), badges `대표 사진`, `확인 필요`, `AI 한국어`, `AI 영어`, `다듬기 대기`; share copy `공유한 사진 {n}장`, `올리기`, `버리기`, `공유한 사진 {n}장이 기다리고 있어요. 로그인하면 올릴 수 있어요`.
- Commits: author/committer identity is already configured in the repo; end every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `node --test "tests/js/*.test.js"` (never a bare folder) and `py -m unittest discover -s tests`. On this PC a few socket-based Python tests may fail with WinError 10054/10014; if so run the Python suite in WSL with `bash <scratchpad>/wsl-tests.sh` as the controller tells you, or report the exact failing names.

## Review Focus

1. A person clears an English field and saves → the key disappears and the English page falls back to Korean; a person who never touched an absent English field sends nothing. (Task 2 tests)
2. A share launch while logged out, then a failed or cancelled login → the shared photos are still offered after the next login, and nothing is uploaded without 올리기. (Task 3 `shared.test.js`, browser step)
3. The site service worker updates after a share and must not delete `nocturne-share`. (Task 3 `sw.test.js`)
4. A share of a HEIC/GIF/empty file mixed with JPEGs → only the JPEG/PNG files are kept, the page still gets a 303. (Task 3 `admin-sw.test.js`)
5. 375px with long Korean titles and the two new English fields → no horizontal scroll, buttons reachable. (Task 1/2 browser steps, controller)

---

### Task 1: Admin look (one serif, black, no accent)

Spec: §1 (all of it). Files:
- Rewrite: `admin/admin.css`
- Modify: `admin/index.html` (font link only: replace the three-family link with the one-family link from Global Constraints, add `crossorigin` to it; keep preconnects; keep everything else)
- Modify: `admin/views/exhibit.js` (room head: drop `room-num` and `room-en`; room options without numerals; tags rendered as one text line), `admin/views/queue.js` (room options without numerals), `admin/lib/gallery.js` (delete `roman` and its table; nothing else uses it — check `grep -rn roman admin tests/js`)
- Modify: `tests/test_admin_static.py`, `tests/js/gallery.test.js` (drop roman tests), any `tests/js/*` asserting the removed markup
- Test: `tests/test_admin_static.py`

Interfaces:
- Produces (markup classes Task 2/3 rely on): `.field` (label + control), `.field-wide`, `.row-fields`, `.btn`, `.btn-main`, `.btn-quiet`, `.msg`, `.msg.is-error`, `.q-drop`, `.q-actions`, `.tags` (now a `<p class="tags">` whose text is the badges joined by `" · "`; `대표 사진` and `확인 필요` each in a `<span class="tag-strong">`, the rest plain text nodes, separators plain text), `.tab[aria-selected="true"]` with a `::before` bullet.

- [ ] **Step 1: Failing tests** in `tests/test_admin_static.py`:
  - `test_tokens_match_site`: parse the first `:root { … }` block of `src/template.html` and of `admin/admin.css`; extract `color-scheme` and every `--name: value;` for `--ground --wall --ink --ink-dim --rule`; assert equal and that the admin block has no other custom property whose value is a colour (`#…`, `rgb`, `hsl`).
  - `test_one_font_no_ornament`: `admin.css` contains none of `Cormorant`, `IBM Plex`, `--lamp`, `--lb-`, `prefers-color-scheme`, `data-theme`, `italic`, `letter-spacing`, `text-transform`, `font-weight: 500`, `animation`, `@keyframes`, `border-radius: 2px`; every `font-size:` value is one of `12px`, `13px`, `14px`, `16px`.
  - `test_font_link`: `admin/index.html` contains `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400&display=swap" crossorigin>` and not `Cormorant`.
- [ ] **Step 2:** Run `py -m unittest tests.test_admin_static -v` → the three fail.
- [ ] **Step 3: Implement.** CSS per spec §1 (bar 52px no border; page max 920px, edge `clamp(16px, 3vw, 40px)`; tabs text-only with outdented `•` like the site's `.rooms-side .is-here::before` — copy that technique from `src/template.html`; site status as text, failed in `--ink`; rules only between rooms/rows/cards; buttons square 1px; inputs `--wall` bg, 1px `--rule` border with `--ink-dim` bottom, 16px; labels 12px `--ink-dim`; badges line 12px; drop zone 1px solid `--rule`, `--ink` while `.is-over`; q-state text only (delete `::before` dots and the `breathe` animation); keep the existing responsive rules at 600px/719px adapted; keep `prefers-reduced-motion` for transitions; focus `2px solid var(--ink)` offset 3px). Remove the `.site-dot` span from `admin/index.html` and the code that styles it if any JS references it (`grep -n site-dot admin`). Room head becomes `<div class="room-head"><h2>name</h2> <span class="room-count">7점</span></div>`.
- [ ] **Step 4:** `py -m unittest tests.test_admin_static -v` and `node --test "tests/js/*.test.js"` pass (update JS tests that asserted roman numerals, `room-num`, `room-en` or `li.tag`).
- [ ] **Step 5: Browser check** (fake GitHub, see CLAUDE.md "관리 페이지를 컴퓨터에서만 시험하기"; `run_worker.py` to publish one upload): login screen, 새 사진 with one card, 전시 중 at 375px and 1280px; no horizontal scroll at 375px (`document.documentElement.scrollWidth <= innerWidth`); screenshots into `tests/browser/out/admin/` (git-ignored). If the local server cannot listen (WinError 10014), say so in the report and skip this step.
- [ ] **Step 6: Commit** `Admin: the site's black room and one serif`.

### Task 2: English texts and per-language badges

Spec: §2. Files:
- Modify: `admin/lib/gallery.js` (`saveEdits`, `badges`), `admin/views/exhibit.js` (`editsFor`, two fields, ` · AI` label marks, badges line), `admin/views/queue.js` (manual form fields, `QueueStore.publish`)
- Test: `tests/js/gallery.test.js`, `tests/js/exhibit.test.js`, `tests/js/queueview.test.js`, `tests/test_admin_static.py` (`LABELS` gains `영어 제목`, `영어 설명`, `AI 한국어`, `AI 영어`, `다듬기 대기`)

Interfaces:
- Consumes: Task 1 markup (`.field`, `.field-wide`, `.row-fields`, `<p class="tags">` with `.tag-strong`).
- Produces: `saveEdits(data, name, changes)` accepts keys `room, title, alt, title_en, alt_en`; `badges(photo) -> string[]` in the order `확인 필요, AI 한국어, AI 영어, 다듬기 대기`; `editsFor(shown, typed)` with `shown`/`typed` holding `room, title, alt, title_en, alt_en` (absent English = `''`); `QueueStore.publish(key, {room, title, alt, title_en, alt_en})`.

- [ ] **Step 1: Failing tests.**
  - `gallery.test.js`:
    - `saveEdits english replaces in place`: photo with `title_en` → change → same key position, value trimmed by caller, `ai.fields` loses `title_en`, `confidence` gone.
    - `saveEdits english empty deletes the key`: `{alt_en: ''}` → `'alt_en' in photo === false`; `ai.fields` loses `alt_en`; `serialize` output has no `alt_en`.
    - `saveEdits english added in order`: photo `{file,title,alt,date,ai}` + `{title_en:'A', alt_en:'B'}` → `Object.keys(photo)` is `['file','title','alt','title_en','alt_en','date','ai']`.
    - `saveEdits english absent and empty is no change`: photo without English + `{title_en: ''}` → photo unchanged, `ai` unchanged except `confidence` removed.
    - `saveEdits korean still required`: `{title: '  '}` throws `GalleryError` `제목과 설명을 채워 주세요`; `{title_en: 5}` throws `GalleryError`.
    - `badges`: no ai → `[]`; `{fields:['title','alt','title_en','alt_en'], model:'claude-opus-5-5', confidence:0.5}` → `['확인 필요','AI 한국어','AI 영어']`; `{fields:['title_en'], model:'gemma4:e4b-it-qat'}` → `['AI 영어','다듬기 대기']`; `{fields:[], model:'gemma4:e4b-it-qat', confidence: 0.9}` → `[]`.
  - `exhibit.test.js`: `editsFor` sends a changed `title_en` trimmed; sends `alt_en: ''` when it was `'x'` and is cleared; sends nothing for `shown.title_en === ''` and `typed.title_en === '  '`.
  - `queueview.test.js` (find the existing 직접 입력해서 게시 test and extend it): with `title_en: ' T '` and `alt_en: ''` the published entry is `{file, title, alt, title_en: 'T', date?, camera?}` in that key order, no `alt_en`.
- [ ] **Step 2:** Run them → fail.
- [ ] **Step 3: Implement.** `gallery.js`: `EDITABLE = ['room','title','alt','title_en','alt_en']`, `REQUIRED = ['title','alt']`, `OPTIONAL = ['title_en','alt_en']`; type check every given text key is a string; an optional key given as `''` (after the caller's trim) means "delete if present, else no change"; insert a new optional key right after `alt` (or after `title_en` for `alt_en` when `title_en` exists) by rebuilding the photo object's key order in place (keep the same object identity: delete and re-add keys after it); `changed` = keys whose stored value really changed (including deletion). Keep the function's "check everything before changing anything" property. `exhibit.js`: two more fields (`영어 제목` input, `영어 설명` textarea rows 2, both `field-wide`) after 설명; `row.shown`/fill logic covers them (absent → `''`); each field label is `<label>` text + optional `<span class="ai-mark"> · AI</span>` when that key is in `photo.ai.fields`; the badges line from `badges(photo)` with `대표 사진` first when cover. `queue.js`: same two fields in `buildForm`; `publish` adds non-empty trimmed `title_en`/`alt_en` after `alt`.
- [ ] **Step 4:** All JS tests and `tests.test_admin_static` pass.
- [ ] **Step 5: Browser check** (fake GitHub): edit English title, save, reload → kept; clear English description, save → gone from the fake repo's `src/photos.json`; badges line reads as specified; 375px no horizontal scroll. Skip with a note if the server cannot listen.
- [ ] **Step 6: Commit** `Admin: edit the English texts; AI badges per language`.

### Task 3: Install the admin page and share photos to it

Spec: §3. The controller has already put four PNGs in `admin/icons/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, sizes 192, 512, 512, 180). Files:
- Create: `admin/manifest.webmanifest` (exactly the JSON in spec §3, 2-space indent, final newline), `admin/sw.js`, `admin/lib/shared.js`
- Modify: `admin/index.html` (head links per spec §3), `admin/app.js` (register the worker; share note on the login screen; open 새 사진 after login when shares wait), `admin/views/queue.js` (the share line above the picker with 올리기/버리기), `src/sw.js` (keep `nocturne-share` in `activate`), `admin/admin.css` (share line styles, using existing classes where possible)
- Test: create `tests/js/admin-sw.test.js`, `tests/js/shared.test.js`; modify `tests/js/sw.test.js`, `tests/test_admin_static.py`, `tests/test_build.py`

Interfaces:
- `admin/lib/shared.js` exports:
  - `SHARE_CACHE = 'nocturne-share'`
  - `async pendingShares(cachesLike) -> Array<{key: string, file: File}>` — keys sorted as strings ascending; `File(name = decodeURIComponent(X-Name) or 'photo.jpg', type = Content-Type, lastModified = the <ms> in the key)`; returns `[]` when `cachesLike` is null/undefined or any call throws.
  - `async dropShares(cachesLike, keys: string[]) -> void` — deletes those keys, ignores errors.
- `admin/sw.js`: no imports (classic worker). `self.addEventListener('fetch', …)`: if `request.method === 'POST'` and `new URL(request.url).pathname === new URL('share', self.registration.scope).pathname` → `event.respondWith(receive(request))`; else return without `respondWith`. `receive`: `formData()` → `getAll('photos')` → keep `File`s with `size > 0` and `type` in `image/jpeg`, `image/png` → put each into `caches.open('nocturne-share')` under `new URL('share/' + now + '-' + i, scope)` as `new Response(file, {headers: {'Content-Type': file.type, 'X-Name': encodeURIComponent(file.name)}})`; any error → ignored; always `Response.redirect(self.registration.scope, 303)`. `install` → `self.skipWaiting()`; `activate` → `event.waitUntil(self.clients.claim())`. Keep it short and commented like `src/sw.js`.
- `views/queue.js` exports a new `offerShares(files: File[], {upload, discard})`? — no: keep the share line inside `renderQueue`: `renderQueue(root, ctx)` reads `pendingShares(globalThis.caches)` itself after drawing and shows/hides the line; 올리기 calls the existing `addFiles(files)` then `dropShares`; 버리기 calls `dropShares`. Line markup: `<div class="q-share" role="status"><p class="msg">공유한 사진 N장</p><div class="q-actions"><button class="btn btn-main">올리기</button><button class="btn">버리기</button></div></div>` placed before `.q-drop`; hidden when none.
- `app.js`: at start, `if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});`; `openLogin` shows the waiting note in a new `<p class="gate-note" id="login-shared" hidden>` under the gate note (count from `pendingShares`); in `enter()`, if shares wait, select the 새 사진 tab.

- [ ] **Step 1: Failing tests.**
  - `admin-sw.test.js` (pattern: `tests/js/sw.test.js` runs `src/sw.js` in `node:vm` with fake `self`/`caches`; do the same for `admin/sw.js`, scope `https://x.test/nocturne/admin/`): (a) POST `…/admin/share` with FormData of a JPEG `a.jpg`, a PNG `b.png`, a `image/heic` file and an empty JPEG → `respondWith` called; response status 303, `Location` = scope; cache `nocturne-share` holds exactly two entries whose keys start with scope + `share/` and whose `X-Name` decode to `a.jpg`, `b.png`; (b) GET `…/admin/` and POST `…/admin/other` → `respondWith` not called; (c) `caches.open` rejects → still 303.
  - `shared.test.js`: fake caches with entries `share/2-0`, `share/10-1` (string order puts `share/10-1` first), names `%ED%95%9C.jpg` → `한.jpg`; missing `X-Name` → `photo.jpg`; `File.lastModified` from the key; `dropShares` removes only the given keys; `pendingShares(undefined)` → `[]`; `caches.open` throwing → `[]`.
  - `sw.test.js`: run the site worker's `activate` with existing caches `nocturne-share`, `nocturne-old`, `other` → only `nocturne-old` deleted.
  - `test_admin_static.py`: `test_manifest` (load JSON; equals the spec dict exactly); `test_head_links` (the four tags of spec §3 present in `admin/index.html`); `test_icons` (Pillow: sizes 192, 512, 512, 180, mode RGB or RGBA, corner pixel `(235, 233, 228)` ±2); `LABELS` gains `공유한 사진`, `올리기`, `로그인하면 올릴 수 있어요`.
  - `test_build.py`: `--out` puts `admin/manifest.webmanifest`, `admin/sw.js`, `admin/icons/icon-512.png` into the output.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement** per Interfaces and spec §3.
- [ ] **Step 4:** All JS and Python tests pass.
- [ ] **Step 5: Browser check** (fake GitHub on `localhost:8000/admin/?api=…`): the worker registers (`navigator.serviceWorker.controller` after a reload); from the console `const f = new FormData(); f.append('photos', new File([jpegBytes], 'x.jpg', {type:'image/jpeg'})); await fetch('share', {method:'POST', body:f})` → logout → login screen shows the waiting note → login → 새 사진 opens with "공유한 사진 1장" → 올리기 → the upload card appears and the line goes; repeat with 버리기. Note: the built-in browser pane may refuse service workers; then use headless Chrome or say it was skipped.
- [ ] **Step 6: Commit** `Admin: install it on its own and share photos to it`.

### Task 4: Site and offline cleanup

Spec: §7 "사이트" and "설치와 오프라인". Files: `src/template.html`, `src/sw.js`, `scripts/build.py`, `tests/test_build.py`, `tests/js/sw.test.js`.

- [ ] **Step 1: Failing tests.**
  - `test_build.py` `test_sw_version_covers_icons`: build twice into temp dirs with one icon byte changed in between → the `VERSION` in `sw.js` differs.
  - `sw.test.js` `page opaqueredirect is passed through`: the page handler's network answer has `type: 'opaqueredirect'` → that response is returned and nothing is put into `nocturne-page`.
  - `test_build.py` page assertions for the markup/CSS bits that are text-checkable: the side bullet uses `content: "•" / ""`; `@media (pointer: coarse)` raises `.lb-link` min-height to 40px; `.cover` has `width: fit-content` (or the label is constrained to the image width — pick one and assert it); `.side` gets `overflow-y: auto`; the phone foot `관리` link has `text-decoration: underline`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.** `build.py`: add the bytes of every file under `icons/` (sorted by name) to the VERSION hash. `src/sw.js`: in the page strategy, a network response with `type === 'opaqueredirect'` is returned as is (never stored). `src/template.html` JS: the phone menu `<details>` closes on `focusout` when focus leaves it (`relatedTarget` outside); the outside click that closes an open menu calls `preventDefault()` and stops there (the click does not reach the link or photo under it); the late full-size `onload` does nothing once the viewer is closed (check the current index or an open flag). CSS bits as tested.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5: Browser check** (`py scripts\build.py`, `serve.py`): phone width — open the menu, tap a photo outside it → the menu closes and the viewer does not open; Tab out of the open menu → it closes; desktop with 800px tall window → side column scrolls. Skip with a note if the server cannot listen.
- [ ] **Step 6: Commit** `Site: quieter bullet, safer menu, viewer and side column; icons in the version`.

### Task 5: PC helper and AI cleanup

Spec: §7 "PC 도우미와 AI". Files: `scripts/pc_helper.py`, `scripts/worker.py`, `scripts/curator.py`, `tests/test_pc_helper.py`, `tests/test_curator.py`.

- [ ] **Step 1: Failing test** `test_pc_helper.py` `test_upgrade_github_error_skips_that_photo`: a fake worker whose `upgrade_one` sets `upgrade_file = '0001'` then raises `GitHubError(500)` on the first call → `Helper.tick()` re-raises, `'0001' in worker.skip`, and the round is still on (`helper.upgrading is True`); a second variant where `upgrade_file` is `None` (GitHub failed before a photo was chosen) → nothing added to `skip`. Also a `test_curator.py` assertion that the prompt's example heading says the part after ` | ` is English (match the exact phrase you add).
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.** In `Helper.tick`, the `except GitHubError:` branch adds `self.worker.upgrade_file` to `self.worker.skip` when it is not None, then re-raises; update the comment there. Fix the stale comment in `worker.py` (around the "both texts rewritten by a person" text) to describe the current rule (a text a person changed has left `ai.fields`). Add the English note to the prompt's example heading in `curator.py`. Also remove the stray 17-space run in the `with` statement near `tests/test_pc_helper.py:90`.
- [ ] **Step 4:** `py -m unittest tests.test_pc_helper tests.test_curator tests.test_worker -v` pass.
- [ ] **Step 5: Commit** `PC helper: a GitHub error while upgrading skips that photo for the round`.

### Task 6: Data, docs, merge and deploy (controller)

- [ ] **Step 1:** `src/photos.json`: the two Korean `alt` changes of spec §7, through `photolib.load_data`/`save_data` so the format stays canonical.
- [ ] **Step 2:** `CLAUDE.md` and `README.md`/`README.ko.md` per spec §5; `tests/test_admin_static.py` and the full suites pass.
- [ ] **Step 3:** Whole-branch review, one fix wave, merge to `main`, push, wait for `site.yml`, check `https://hpotty36.github.io/nocturne/admin/manifest.webmanifest`, `admin/sw.js`, `admin/icons/icon-192.png` (200) and that the admin page opens.
- [ ] **Step 4:** Report to the user with what to try on the phone.
