# 전시 사이트 개편과 PWA (1부) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public Nocturne site as a black, one-serif exhibition room (DE-SLOP) and make it an installable PWA that shows the exhibition offline after one visit.

**Architecture:** `scripts/build.py` turns `src/photos.json` + `src/template.html` into `index.html` and now also writes `manifest.webmanifest` and `sw.js` (from the `src/sw.js` template) next to it. The template keeps all CSS and the inline JS (justified hang, current room, phone menu, viewing room, service-worker registration). `src/sw.js` keeps its routing decisions in pure functions that Node tests run through `node:vm`.

**Tech Stack:** Python 3 + Pillow (build, unittest), vanilla HTML/CSS/JS (no build step, no dependencies), Service Worker + Cache Storage, Node 24 `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-01-site-redesign-pwa-design.md` (read it first; this plan only adds the decisions the spec leaves open)

## Global Constraints

- Work in worktree `.claude/worktrees/site-redesign`, branch `site-redesign` (from `main`). Do not touch `admin/` except where a task says so (none does).
- Colours exactly: `--ground #000`, `--wall #111`, `--ink #ebe9e4`, `--ink-dim #8f8c86`, `--rule #262624`; `color-scheme: dark` only; no `--lamp`, no `--lb-*`, no light theme.
- One font: Noto Serif KR 400 from Google Fonts, stylesheet link with `crossorigin`. Sizes 14px (body, wordmark, room names, lists), 13px (photo labels, viewer caption), 12px (span, fine print). No italics, letter-spacing, uppercase transforms or bold.
- Korean copy exactly: `목록`, `이전`, `다음`, `닫기`, `관리`, `사진 {n}점`, `{n}점`, `{title} 크게 보기`, room span `YYYY.MM – YYYY.MM` (spaces around an en dash `–`).
- Photo URLs carry a content hash: `photos/{thumb|full}/<name>.jpg?v=<first 8 hex of sha256 of the file>`.
- No external scripts; no new Python or npm dependencies; no real names, emails or local Windows paths in tracked files.
- Usable at 375px wide; keep `keep-all`, `tabular-nums`, reduced-motion support, focus trap, the alt-as-description pattern.
- Tests stay offline. On this PC run Python tests that use sockets in WSL (see memory `nocturne-loopback-flaky-tests`); `test_build.py`, `test_photodata.py`, `test_admin_static.py`, `test_workflows.py` run fine on Windows: `py -m unittest discover -s tests -p "test_build.py" -v`. JS: `node --test "tests/js/*.test.js"` (one known `listen EFAULT` flake in `github.test.js`).
- Commits: author is the repo's noreply identity; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A room with no photos yet, or whose photos have no `date` → the page builds, the room head reads `0점` / has no span, and the hang JS does not throw. (Task 1 `test_empty_room`, `test_room_span`; Task 2 browser step)
2. `cover` missing, or naming a photo that is no longer hung → no cover figure, no crash. (Task 1 `test_cover_missing`)
3. The admin login return `admin/?code=…&state=…` and every other `admin` URL are never intercepted by the service worker. (Task 4 `route` cases)
4. An error response (404/500 during a deploy, an opaque redirect) never replaces the cached page or lands in a photo cache. (Task 4 `storable` cases)
5. Long Korean titles at 375px in labels and in the viewer caption row wrap without horizontal scroll and leave `이전 · 다음 · 닫기` reachable. (Task 2 browser step)

---

### Task 1: Data and build output

**Files:**
- Modify: `scripts/build.py` (remove `roman`, `ratio_label`, `ROMAN`, `COMMON_RATIOS`; new fragments), `src/template.html` (body markup only, see contract), `src/photos.json`, `tests/helpers.py` (`SITE`), `tests/fixtures/site.json`, `tests/fixtures/site.canonical.json`, `CLAUDE.md` (photos.json format section, "새 방은…" sentence)
- Test: `tests/test_build.py`, `tests/test_photodata.py`

**Interfaces:**
- Produces: `build.room_span(photos: list[dict]) -> str`; `build.asset_url(root: Path, kind: str, name: str) -> str` (`kind` is `"thumb"` or `"full"`); `build.build(root, out=None) -> dict` (unchanged keys `total`, `rooms`).
- Produces the **markup contract** that Task 2 styles and scripts (class names and ids are fixed):

```html
<div class="shell" id="top">
  <aside class="side">
    <a class="mark" href="#top">Nocturne</a>
    <nav aria-label="전시실">
      <details class="menu"><summary>목록</summary><ul class="rooms">__NAV__</ul></details>
      <ul class="rooms rooms-side">__NAV__</ul>
    </nav>
    <p class="fine">사진 __TOTAL__점<br>__COPYRIGHT__<br><a class="foot-admin" href="admin/">관리</a></p>
  </aside>
  <main class="main">
__COVER__
__ROOMS__
    <footer class="foot">사진 __TOTAL__점 · __COPYRIGHT__ · <a class="foot-admin" href="admin/">관리</a></footer>
  </main>
</div>
<div class="lb" id="lb" role="dialog" aria-modal="true" aria-label="사진 크게 보기" hidden>
  <div class="lb-stage" id="lb-stage"><img class="lb-img" id="lb-img" alt=""></div>
  <div class="lb-bar">
    <p class="lb-caption" aria-live="polite"><span id="lb-title"></span><span class="lb-date" id="lb-date"></span></p>
    <p class="lb-nav"><span class="lb-count" id="lb-count"></span> <button class="lb-link" id="lb-prev" type="button">이전</button> · <button class="lb-link" id="lb-next" type="button">다음</button> · <button class="lb-link" id="lb-close" type="button">닫기</button></p>
  </div>
</div>
```

  Fragments (`__NAV__` is the same list item string in both lists):
  - nav item: `<li><a href="#river">강</a></li>`
  - room: `<section class="room" id="river"><header class="room-head"><h2>강</h2><span class="room-count">7점</span><span class="room-span">2026.09 – 2026.10</span></header><div class="hang">…</div></section>` (`room-span` element omitted when the span is empty)
  - print: `<figure class="print" data-slug="n1" data-w="600" data-h="400" data-thumb="<thumb url>" data-full="<full url>" data-title="공중전화" data-date="2025.11.30" style="--c:#rrggbb;--r:600/400"><button class="print-btn" type="button" aria-label="공중전화 크게 보기" aria-describedby="alt-n1"><img id="alt-n1" src="<thumb url>" alt="…" width="300" height="200"[ loading="lazy"] decoding="async"></button><figcaption class="label">공중전화<span class="label-date">, 2025.11.30</span></figcaption></figure>` (`data-date=""` and no `label-date` span when there is no date; `loading="lazy"` on every room but the first, as now)
  - cover: `<figure class="cover"><button class="cover-btn" type="button" data-open="a1" style="--c:…;--r:w/h" aria-label="스카이라인 크게 보기" aria-describedby="alt-a1"><img src="<full url>" alt="…" width="…" height="…" fetchpriority="high"></button><figcaption class="label">스카이라인</figcaption></figure>` (same label rule as a print; no camera)
  - Placeholders left in the template: `__TITLE__ __DESCRIPTION__ __COPYRIGHT__ __NAV__ __COVER__ __ROOMS__ __TOTAL__` (`__LEDE__` is gone). The `<head>`, `<style>` and `<script>` stay as they are in this task; Task 2 replaces them, so the page may look and behave broken in a browser after this task.

- [ ] **Step 1: Write the failing tests** in `tests/test_build.py` (replace `test_roman`, `test_page`, the `River` assertions in `test_screen_readers_…`, and `test_footer_links_to_the_admin_page`; keep `test_escapes_text`, `test_missing_photo_file`, `test_out_dir`, `TokenTests` untouched for now)

```python
def test_page(self):
    html = self.html()
    for s in ("<title>Nocturne</title>", '<a class="mark" href="#top">Nocturne</a>', '<li><a href="#river">강</a></li>',
              '<h2>강</h2><span class="room-count">2점</span>', '<h2>밤</h2><span class="room-count">1점</span>'):
        self.assertIn(s, html)
    body = html.split("<body>", 1)[1].split("<script>", 1)[0]  # the old <style> still names these until Task 2
    for gone in ("room-num", "room-en", "room-note", "lede", "River", "Night", "label-meta", "data-meta"):
        self.assertNotIn(gone, body)
    self.assertEqual(html.count('<figure class="print"'), 3)
    self.assertEqual(html.count('<li><a href="#night">밤</a></li>'), 2)  # phone menu and side list
    self.assertIsNone(re.search(r"__[A-Z]+__", html))

def test_room_span(self):
    span = build.room_span
    self.assertEqual(span([]), "")
    self.assertEqual(span([{"date": "2025.11.30"}]), "2025.11")
    self.assertEqual(span([{"date": "2026.09.01"}, {"date": "2026.09.30"}]), "2026.09")
    self.assertEqual(span([{"date": "2026.09.03"}, {}, {"date": "2025.11.30"}]), "2025.11 – 2026.09")
    self.assertEqual(span([{"date": "알 수 없음"}, {}]), "")
    html = self.html()
    self.assertIn('<span class="room-count">1점</span><span class="room-span">2025.11</span></header>', html)
    self.assertIn('<span class="room-count">2점</span></header>', html)  # river: no dates, no span

def test_labels_and_data(self):
    html = self.html()
    self.assertIn('<figcaption class="label">공중전화<span class="label-date">, 2025.11.30</span></figcaption>', html)
    self.assertIn('<figcaption class="label">다리 아래</figcaption>', html)
    self.assertRegex(html, r'data-slug="n1"[^>]*data-title="공중전화" data-date="2025.11.30"')
    self.assertRegex(html, r'data-slug="a2"[^>]*data-title="다리 아래" data-date=""')

def test_cover(self):
    cover = re.search(r'<figure class="cover">.*?</figure>', self.html(), re.S).group(0)
    self.assertIn('data-open="a1"', cover)
    self.assertIn('<figcaption class="label">스카이라인</figcaption>', cover)

def test_cover_missing(self):
    for value in ("gone", None):
        data = photolib.load_data(self.root)
        if value is None: data.pop("cover", None)
        else: data["cover"] = value
        photolib.save_data(self.root, data)
        self.assertNotIn('<figure class="cover">', self.html())

def test_empty_room(self):
    data = photolib.load_data(self.root)
    data["rooms"].append({"id": "new", "name": "새 방", "note": "n", "photos": []})
    photolib.save_data(self.root, data)
    html = self.html()
    self.assertIn('<h2>새 방</h2><span class="room-count">0점</span></header><div class="hang">', html)
    self.assertIn('<li><a href="#new">새 방</a></li>', html)

def test_versioned_urls(self):
    url = build.asset_url(self.root, "thumb", "n1")
    digest = hashlib.sha256(photolib.thumb_path(self.root, "n1").read_bytes()).hexdigest()[:8]
    self.assertEqual(url, f"photos/thumb/n1.jpg?v={digest}")
    html = self.html()
    self.assertIn(f'data-thumb="{url}"', html)
    self.assertIn(f'<img id="alt-n1" src="{url}"', html)
    self.assertIn(f'data-full="{build.asset_url(self.root, "full", "n1")}"', html)
    helpers.make_jpeg(photolib.thumb_path(self.root, "n1"), (300, 200), (10, 200, 10))
    self.assertNotEqual(build.asset_url(self.root, "thumb", "n1"), url)

def test_footer_links_to_the_admin_page(self):
    self.assertEqual(self.html().count('<a class="foot-admin" href="admin/">관리</a>'), 2)
```

  In `test_screen_readers_hear_the_alt_and_clean_names` change the `<img id="alt-n1" src="photos/thumb/n1.jpg"` expectations to match the `?v=` URL (use `build.asset_url`) and drop the two `River`/numeral assertions; keep the unique-ids and cover aria checks.

  In `tests/test_photodata.py` add:

```python
def test_real_data_shape(self):
    data = photolib.load_data(helpers.ROOT)
    self.assertNotIn("lede", data["site"])
    for room in data["rooms"]:
        self.assertNotIn("name_en", room)
        self.assertTrue({"id", "name", "note", "photos"} <= set(room), room["id"])
```

- [ ] **Step 2: Run them to see them fail**

Run: `py -m unittest tests.test_build tests.test_photodata -v` (from the repo root with `tests` on the path: `py -m unittest discover -s tests -p "test_build.py" -v` and the same for `test_photodata.py`)
Expected: FAIL (`room_span`/`asset_url` missing, old markup, `lede` present).

- [ ] **Step 3: Implement**
  - `src/photos.json`: delete `site.lede` and every room's `name_en` (keep the canonical format: `photolib.save_data` or hand edit, no other change). `tests/helpers.py` `SITE` and both fixtures: the same two deletions (`site.canonical.json` must stay byte-identical to `photolib.dumps_data(helpers.SITE)`).
  - `build.room_span`: months are `date[:7]` of dates matching `^\d{4}\.\d{2}`; others ignored.
  - `build.asset_url`: sha256 of the file bytes. `photo_info` still runs first and raises `BuildError` for a missing file.
  - `build.build`: emit the fragments above; remove `__LEDE__`; nav is one string used for both `__NAV__` slots.
  - `src/template.html`: replace the `<body>` markup (header bar, page, footer, viewing room) with the contract; leave `<head>`, `<style>`, `<script>` as they are.
  - `CLAUDE.md`: in "photos.json 형식"/"명령줄 대안" say `note` is the room description given to the AI only (not shown on the site), and new rooms need `id`, `name`, `note`, `photos`; remove `name_en` and the lede from that text.

- [ ] **Step 4: Run them to see them pass**

Run: `py -m unittest discover -s tests -p "test_build.py" -v`, then `-p "test_photodata.py"`, then `node --test "tests/js/*.test.js"` (gallery/exhibit tests read the fixtures)
Expected: all PASS (JS: the known EFAULT flake only).

- [ ] **Step 5: Commit**

```bash
git add scripts/build.py src/template.html src/photos.json tests/ CLAUDE.md
git commit -m "Build: plain room heads, dated labels, hashed photo URLs; drop lede and English names"
```

### Task 2: Black room look and behaviour

**Files:**
- Modify: `src/template.html` (`<head>` font links and meta, whole `<style>`, whole `<script>`), `tests/helpers.py` (replace `theme_tokens` with `root_tokens`), `tests/test_admin_static.py` (remove `test_tokens_match_site`), `CLAUDE.md` (디자인 메모)
- Test: `tests/test_build.py` (`TokenTests`)

**Interfaces:**
- Consumes: the Task 1 markup contract.
- Produces: `helpers.root_tokens(path) -> dict[str, str]` (declarations of the first `:root { }` block, comments stripped).

- [ ] **Step 1: Write the failing tests** (replace `TokenTests`)

```python
class TokenTests(unittest.TestCase):
    TEMPLATE = helpers.ROOT / "src" / "template.html"

    def test_tokens(self):
        t = helpers.root_tokens(self.TEMPLATE)
        want = {"--ground": "#000", "--wall": "#111", "--ink": "#ebe9e4", "--ink-dim": "#8f8c86", "--rule": "#262624"}
        self.assertEqual({k: t[k] for k in want}, want)
        self.assertGreaterEqual(helpers.contrast("#ebe9e4", "#000000"), 7)
        self.assertGreaterEqual(helpers.contrast("#8f8c86", "#000000"), 4.5)

    def test_one_dark_theme_one_font(self):
        text = self.TEMPLATE.read_text(encoding="utf-8")
        for gone in ("prefers-color-scheme", 'data-theme', "--lamp", "--lb-", "Cormorant", "IBM Plex", "italic",
                     "letter-spacing", "text-transform", "lb-btn", "<svg", "사진을 누르면"):
            self.assertNotIn(gone, text)
        self.assertIn('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400&display=swap" crossorigin>', text)
        self.assertIn('<meta name="theme-color" content="#000">', text)
```

  `helpers.contrast` needs 6-digit hex; pass `#000000` as above.

- [ ] **Step 2: Run to see them fail**

Run: `py -m unittest discover -s tests -p "test_build.py" -v`
Expected: FAIL (`root_tokens` missing, old tokens/fonts).

- [ ] **Step 3: Implement**
  - `<head>`: keep the two preconnects; the font link exactly as in the test; add `<meta name="theme-color" content="#000">`.
  - `<style>`: all of spec §1 (colour table, type, two-column layout from 960px with the 180px sticky side and `clamp()` gaps/margins from the spec, phone bar + `details.menu` drop-down, cover sizing via `min(100cqi, (100svh - var(--bar) - 8rem) * var(--r))`-style rule as now, room head, hang gap `clamp(10px, 1.3vw, 16px)`, labels, foot, viewing room with `.lb-link` text buttons: `--ink-dim` → `--ink` on hover/focus, padding giving ≥24px height and ≥40px under 960px). Show `.rooms-side` and `.fine` only from 960px; show `details.menu` and `.foot` only below it. Below 960px rooms get `scroll-margin-top` equal to the bar height so a jump from the menu is not hidden under the bar. Focus ring `2px solid var(--ink)`, offset 3px. Keep the photo fade-in and `prefers-reduced-motion`.
  - `<script>`: keep fade-in, the justified hang (targets 300 / 240 / 180 at hang widths ≥1100 / ≥720 / below; CAP 1.6; skip a hang with no prints), and the current-room observer, which now marks every `.rooms a` for the room (class `is-here` + `aria-current="true"`; the side list draws the `•` with CSS). Remove `reveal()`. Phone menu: close `details.menu` on a link click, on Escape, and on a click outside it. Viewing room: `show(i)` fills `#lb-title`, `#lb-date` (`", " + date` or empty), `#lb-count` (`(i+1) + " / " + N`, no zero padding); thumbnail-then-full swap, preloading, arrows/Escape, swipe, stage-click-closes, focus starts on `#lb-close`, Tab cycles `#lb-prev`, `#lb-next`, `#lb-close`, focus returns on close — all as today.
  - `tests/helpers.py`: `root_tokens` replaces `theme_tokens`; `tests/test_admin_static.py`: delete `test_tokens_match_site` (part 2 re-adds a match test with the new tokens).
  - `CLAUDE.md` 디자인 메모: new colour table (one theme), no lamp/light theme, one font and its sizes, labels "제목, 날짜", room head, viewing room text buttons, the 960px two-column rule, and that the admin page keeps its old look until part 2.

- [ ] **Step 4: Run tests**

Run: `py -m unittest discover -s tests -p "test_build.py" -v` and `-p "test_admin_static.py"`
Expected: PASS.

- [ ] **Step 5: Look at it in the browser** (built-in browser pane; start the server with the Bash tool in the background: `py tests/browser/serve.py --port 8000`, build with `py scripts/build.py`, open `http://localhost:8000/`)
  - Desktop width: side column with `•` on the room in view while scrolling; cover fits the first screen; labels "제목, 날짜"; room heads with count and span.
  - 375px (`resize_window` preset `mobile`, then back to `desktop`): bar with `목록`; menu opens, closes on a pick, on Escape and on an outside tap; no horizontal scroll; foot line at the bottom.
  - Viewer: open from a print and from the cover; arrows, Escape, Tab cycling, swipe (pointer drag), click beside the photo closes; caption and count update.
  - Review Focus 1 and 5: in the page, run `document.querySelector('.print').dataset.title = '아주 긴 제목이 화면 폭을 넘어갈 때 줄이 어떻게 바뀌는지 보는 시험 문장입니다'` and set the first label's text to the same, open that photo at 375px: caption wraps, `이전 · 다음 · 닫기` stay visible and tappable, no horizontal scroll. An empty room's markup is covered by `test_empty_room`; the hang code must return early for a hang with no prints (check it in the code).
  - The browser console has no errors.

- [ ] **Step 6: Commit**

```bash
git add src/template.html tests/helpers.py tests/test_build.py tests/test_admin_static.py CLAUDE.md
git commit -m "Site: black room, one serif, side index and text-only viewer"
```

### Task 3: App icons (controller, with the user)

**Files:**
- Create: `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/apple-touch-icon.png`

- [ ] **Step 1:** Write `tests/browser/out/icons.html` (git-ignored) that loads Noto Serif KR 400 from Google Fonts, waits for `document.fonts.load('400 100px "Noto Serif KR"', 'N')`, draws on a canvas per file a `#000` square with "N" in `#ebe9e4`, glyph cap height ≈ 56% of the side (maskable: inside the central 80%), centred optically, and PUTs each PNG blob to `/tests/browser/out/<file>` (serve.py accepts that).
- [ ] **Step 2:** Open it in the built-in browser via `serve.py`; re-save each PNG with Pillow (RGB, no metadata, exact size: 192, 512, 512, 180) into `icons/`; read each file to look at it.
- [ ] **Step 3:** Show the four icons to the user and adjust until they approve.
- [ ] **Step 4: Commit**

```bash
git add icons/
git commit -m "Icons: N in Noto Serif KR on black for the installed site"
```

### Task 4: Install and offline (manifest + service worker)

**Files:**
- Create: `src/sw.js`, `tests/js/sw.test.js`
- Modify: `scripts/build.py` (write `manifest.webmanifest` and `sw.js`; `COPIED = ("photos", "admin", "icons")`), `src/template.html` (head links, registration), `tests/helpers.py` (`make_site` copies `src/sw.js` and `icons/`), `.gitignore` (`/sw.js`, `/manifest.webmanifest`), `.github/workflows/site.yml` (`paths` gains `"icons/**"`), `tests/test_workflows.py`, `CLAUDE.md` (구조 tree, PWA section)
- Test: `tests/test_build.py` (`PwaTests`), `tests/js/sw.test.js`

**Interfaces:**
- Consumes: `build.asset_url` (Task 1), `icons/*` (Task 3).
- Produces in `src/sw.js` (function declarations, so `node:vm` exposes them on the context):
  - `route(url: string, scope: string, mode: string) -> 'pass'|'page'|'shell'|'thumb'|'full'|'font-css'|'font-file'`
  - `stale(cachedUrls: string[], photos: {thumb: string, full: string}[], scope: string) -> string[]` (cached absolute URLs under `photos/` not equal to any photo URL resolved against `scope`, in input order)
  - `storable(response: {ok: boolean, type: string}) -> boolean` (`ok` and `type` is `basic` or `cors`)
  - template lines replaced by the build, exactly once each: `const VERSION = '__VERSION__';` and `const PHOTOS = [/*__PHOTOS__*/];`
  - cache names `nocturne-page`, `nocturne-thumbs`, `nocturne-full`, `nocturne-fonts`; navigation timeout `4000` ms.

- [ ] **Step 1: Write the failing JS tests** (`tests/js/sw.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../../src/sw.js', import.meta.url), 'utf8'), ctx);
const S = 'https://hpotty36.github.io/nocturne/';

test('route', () => {
  const cases = [
    [S, 'navigate', 'page'], [S + 'index.html', 'navigate', 'page'], [S + '#river', 'navigate', 'page'],
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
```

- [ ] **Step 2: Write the failing Python tests** (`PwaTests` in `tests/test_build.py`; `setUp` like `BuildTests`, `out` a temp `_site`)
  - `test_manifest`: `json.loads(out/manifest.webmanifest)` equals the spec's object with `description == "사진 3점"` (`SITE` description with `{total}` filled); every `icons[].src` exists under `out`.
  - `test_sw`: `out/sw.js` has no `__VERSION__`/`__PHOTOS__`; `re.search(r"const VERSION = '([0-9a-f]{12})';")` matches; `json.loads(re.search(r"const PHOTOS = (\[.*?\]);", text, re.S).group(1)) == [{"thumb": build.asset_url(root, "thumb", f), "full": build.asset_url(root, "full", f)} for f in ("a1", "a2", "n1")]`; building twice gives the same VERSION; changing a title gives a different one.
  - `test_root_build_writes_pwa_files`: `build.build(root)` writes `root/sw.js` and `root/manifest.webmanifest`.
  - `test_head`: the page has `<link rel="manifest" href="manifest.webmanifest">`, `<link rel="icon" href="icons/icon-192.png">`, `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">` and `navigator.serviceWorker.register('sw.js')`.
  - `test_out_dir` (existing): also expects `icons/icon-512.png`, `manifest.webmanifest`, `sw.js`.
  - `test_gitignore`: the repo `.gitignore` has the lines `/sw.js` and `/manifest.webmanifest`.
  - `tests/test_workflows.py`: `site.yml` push `paths` include `"icons/**"`.

- [ ] **Step 3: Run both to see them fail**

Run: `node --test tests/js/sw.test.js` and `py -m unittest discover -s tests -p "test_build.py" -v`
Expected: FAIL (no `src/sw.js`, no PWA output).

- [ ] **Step 4: Implement**
  - `src/sw.js`: the three pure functions; `route` compares paths against `new URL(scope).pathname` (`admin` and `admin/…` → `pass` first; `page` only for `mode === 'navigate'` on the scope path or `index.html`; `shell` for `manifest.webmanifest` and `icons/`; fonts by host). Event listeners only inside `if (typeof ServiceWorkerGlobalScope !== 'undefined')`:
    - `install`: `nocturne-page` ← `./`, `manifest.webmanifest`, the four icons (`addAll`); `nocturne-thumbs` ← every `PHOTOS[].thumb` not yet cached, each fetched on its own (a failed thumb does not fail the install); then `skipWaiting()`.
    - `activate`: delete caches not named above; delete `stale(...)` entries from `nocturne-thumbs` and `nocturne-full`; `clients.claim()`.
    - `fetch`: non-GET → nothing; then by `route(request.url, registration.scope, request.mode)` per spec §3 (page: network with a 4000 ms race, store the response under the scope URL only if `storable`, fall back to cached scope URL, else keep waiting for the network; shell: cache then network; thumb/full: cache then network, store only if `storable` and the URL is in `PHOTOS`; font-css: cached copy now, refresh in the background; font-file: cache then network and store if `storable`; pass: no `respondWith`).
  - `scripts/build.py`: after writing `index.html`, write `manifest.webmanifest` (spec object, `json.dumps(..., ensure_ascii=False, indent=2)`, final newline) and `sw.js` = template with `VERSION` = first 12 hex of sha256 over (index text + manifest text + sw template text) and `PHOTOS` = `json.dumps` of the `{thumb, full}` list in page order; both to the same `dest` as `index.html`.
  - `src/template.html` `<head>`: the manifest, icon and apple-touch-icon links. End of the inline script: `if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js');`
  - `tests/helpers.py` `make_site`: also copy `src/sw.js` and the `icons/` folder.
  - `.gitignore`, `site.yml` as listed.
  - `CLAUDE.md`: 구조 tree (`icons/`, `src/sw.js`, build writes `manifest.webmanifest` and `sw.js` and that the root copies are git-ignored); a short PWA section: how to install (Android Chrome ⋮ → 앱 설치, iPhone Safari 공유 → 홈 화면에 추가), what works offline (page, all thumbnails, originals once viewed), when a new version arrives (next online open), that `admin/` is never touched by the site's service worker, and that local preview at `localhost:8000` registers it too (DevTools → Application → Service workers → Unregister to clear).

- [ ] **Step 5: Run the tests**

Run: `node --test "tests/js/*.test.js"`, `py -m unittest discover -s tests -p "test_build.py" -v`, `-p "test_workflows.py"`; the full Python suite in WSL.
Expected: PASS (known JS EFAULT flake only; WSL: only `test_index_not_tracked` if run from a worktree).

- [ ] **Step 6: Check it in the browser** (built-in browser, `serve.py` on 8000, `py scripts/build.py`)
  - `await navigator.serviceWorker.ready` resolves; `(await caches.keys())` lists the four cache names after opening a photo; `nocturne-thumbs` holds every thumb.
  - Stop `serve.py`, reload `http://localhost:8000/`: the page and all thumbnails show; a photo opened before shows full size; one never opened shows its thumbnail.
  - Start `serve.py` again plus `py tests/fake_github.py --port 8790 --seed`; open `http://localhost:8000/admin/?api=http://127.0.0.1:8790`, log in, open both tabs: works as before (Review Focus 3).
  - Unregister the service worker afterwards.

- [ ] **Step 7: Commit**

```bash
git add src/sw.js tests/js/sw.test.js scripts/build.py src/template.html tests/ .gitignore .github/workflows/site.yml CLAUDE.md
git commit -m "PWA: manifest, icons and a service worker that keeps the exhibition offline"
```

### Task 5: Merge, deploy, README images (controller)

- [ ] **Step 1:** Whole-branch review (fresh reviewer, spec + plan + diff), one fix wave, scoped re-review; full JS and Python (WSL) suites green.
- [ ] **Step 2:** Merge `site-redesign` into `main`, push; watch the `Site` run; open https://hpotty36.github.io/nocturne/ in the built-in browser and check desktop and 375px.
- [ ] **Step 3:** README assets from the live site: `screen-desktop-dark.jpg` (1440×900), `screen-phone-dark.jpg` (390×844 at 2×) via headless Chrome over the DevTools protocol (remove the policy-installed extension's injected nodes before capture; keep only the site's top-level markup), JPEG 82, no metadata; delete `screen-*-light.jpg`; `wordmark-dark.png`/`wordmark-light.png` re-rendered in Noto Serif KR 400 (transparent); `social-preview.jpg` 1280×640 on `#000` with the new wordmark and five thumbnails. Look at every image.
- [ ] **Step 4:** `README.md` / `README.ko.md`: hero uses plain dark images; Highlights drop the light-theme line and add "installable, works offline after one visit"; tech stack notes the service worker; CLAUDE.md's README-images note updated (no light screenshots, Noto Serif KR wordmark). Commit and push.
- [ ] **Step 5:** Ask the user to upload the new social preview, install the site on the phone and open it in airplane mode.
