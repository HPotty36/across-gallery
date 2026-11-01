# 전시 사이트 개편과 PWA (1부) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public Nocturne site as a black, one-serif exhibition room (DE-SLOP) in Korean and English with a language toggle, have the AI draft English texts too, and make the site an installable PWA that shows the exhibition offline after one visit.

**Architecture:** `scripts/build.py` turns `src/photos.json` + `src/template.html` into `index.html` (Korean) and `en/index.html` (English) and also writes `manifest.webmanifest` and `sw.js` (from the `src/sw.js` template) next to them. `scripts/curator.py` asks Claude/Ollama for Korean and English texts in one reply. The template keeps all CSS and the inline JS (justified hang, current room, phone menu, viewing room, service-worker registration). `src/sw.js` keeps its routing decisions in pure functions that Node tests run through `node:vm`.

**Tech Stack:** Python 3 + Pillow (build, unittest), vanilla HTML/CSS/JS (no build step, no dependencies), Service Worker + Cache Storage, Node 24 `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-01-site-redesign-pwa-design.md` (read it first; this plan only adds the decisions the spec leaves open)

## Global Constraints

- Work in worktree `.claude/worktrees/site-redesign`, branch `site-redesign` (from `main`). Do not touch `admin/` except where a task says so (none does).
- Colours exactly: `--ground #000`, `--wall #111`, `--ink #ebe9e4`, `--ink-dim #8f8c86`, `--rule #262624`; `color-scheme: dark` only; no `--lamp`, no `--lb-*`, no light theme.
- One font: Noto Serif KR 400 from Google Fonts, stylesheet link with `crossorigin`. Sizes 14px (body, wordmark, room names, lists), 13px (photo labels, viewer caption), 12px (span, fine print). No italics, letter-spacing, uppercase transforms or bold.
- Korean copy exactly: `목록`, `이전`, `다음`, `닫기`, `관리`, `사진 {n}점`, `{n}점`, `{title} 크게 보기`, `전시실`, `사진 크게 보기`, `English`; English copy exactly: `Index`, `Previous`, `Next`, `Close`, `Admin`, `{n} photographs` (`1 photograph`), `{n}`, `View {title}`, `Rooms`, `Photo viewer`, `한국어`; room span `YYYY.MM – YYYY.MM` (spaces around an en dash `–`) in both.
- Photo URLs carry a content hash: `photos/{thumb|full}/<name>.jpg?v=<first 8 hex of sha256 of the file>`.
- No external scripts; no new Python or npm dependencies; no real names, emails or local Windows paths in tracked files.
- Usable at 375px wide; keep `keep-all`, `tabular-nums`, reduced-motion support, focus trap, the alt-as-description pattern.
- Tests stay offline. On this PC run Python tests that use sockets in WSL (see memory `nocturne-loopback-flaky-tests`); `test_build.py`, `test_photodata.py`, `test_admin_static.py`, `test_workflows.py` run fine on Windows: `py -m unittest discover -s tests -p "test_build.py" -v`. JS: `node --test "tests/js/*.test.js"` (one known `listen EFAULT` flake in `github.test.js`).
- Commits: author is the repo's noreply identity; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A room with no photos yet, or whose photos have no `date` → the page builds, the room head reads `0점` / has no span, and the hang JS does not throw. (Task 1 `test_empty_room`, `test_room_span`; Task 2 browser step)
2. A photo with no English text yet (manual entry, an old photo) → the English page shows the Korean text marked `lang="ko"`, never an empty label, alt or caption. (Task 1 `test_english_falls_back_to_korean`; Task 2 viewer caption)
3. The admin login return `admin/?code=…&state=…` and every other `admin` URL are never intercepted by the service worker. (Task 6 `route` cases)
4. An error response (404/500 during a deploy, an opaque redirect) never replaces the cached page or lands in a photo cache. (Task 6 `storable` cases)
5. Long titles at 375px (Korean and English) in labels and in the viewer caption row wrap without horizontal scroll and leave the three viewer buttons reachable. (Task 2 browser step)

---

### Task 1: Data and build output (Korean and English pages)

**Files:**
- Modify: `scripts/build.py` (remove `roman`, `ratio_label`, `ROMAN`, `COMMON_RATIOS`; new fragments; two pages), `src/template.html` (`<html>` tag, the head placeholders below, body markup; not `<style>`/`<script>`), `src/photos.json`, `tests/helpers.py` (`SITE`), `tests/fixtures/site.json`, `tests/fixtures/site.canonical.json`, `CLAUDE.md` (photos.json format section, "새 방은…" sentence)
- Test: `tests/test_build.py`, `tests/test_photodata.py`

**Interfaces:**
- Produces:
  - `build.room_span(photos: list[dict]) -> str`
  - `build.asset_url(root: Path, kind: str, name: str) -> str` (`kind` is `"thumb"` or `"full"`; no `../` prefix — the page adds its base)
  - `build.total_text(lang: str, n: int) -> str` → `"사진 3점"` / `"3 photographs"` / `"1 photograph"`
  - `build.STRINGS: dict[str, dict[str, str]]` for `"ko"` and `"en"` with keys `menu, prev, next, close, admin, nav, viewer, switch, view, count` exactly as spec §4's table (`view` is `"{title} 크게 보기"` / `"View {title}"`, `count` is `"{n}점"` / `"{n}"`)
  - `build.build(root, out=None) -> dict` (same keys `total`, `rooms`); writes `index.html` and `en/index.html` under the destination.
- Produces the **markup contract** that Task 2 styles and scripts (class names and ids are fixed; `__X__` are filled per page):

```html
<html lang="__LANG__">
<head>
<meta charset="utf-8">
__REDIRECT__
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="__DESCRIPTION__">
<title>__TITLE__</title>
__ALTERNATES__
… (fonts, style: unchanged in this task)
</head>
<body>
<div class="shell" id="top">
  <aside class="side">
    <a class="mark" href="#top">Nocturne</a>
    <nav aria-label="__NAVLABEL__">
      <details class="menu"><summary>__MENU__</summary><ul class="rooms">__NAV__</ul></details>
      <ul class="rooms rooms-side">__NAV__</ul>
    </nav>
    <a class="lang" href="__SWITCHHREF__" lang="__SWITCHLANG__" hreflang="__SWITCHLANG__">__SWITCH__</a>
    <p class="fine">__TOTALTEXT__<br>__COPYRIGHT__<br><a class="foot-admin" href="__BASE__admin/">__ADMIN__</a></p>
  </aside>
  <main class="main">
__COVER__
__ROOMS__
    <footer class="foot">__TOTALTEXT__ · __COPYRIGHT__ · <a class="foot-admin" href="__BASE__admin/">__ADMIN__</a></footer>
  </main>
</div>
<div class="lb" id="lb" role="dialog" aria-modal="true" aria-label="__VIEWERLABEL__" hidden>
  <div class="lb-stage" id="lb-stage"><img class="lb-img" id="lb-img" alt=""></div>
  <div class="lb-bar">
    <p class="lb-caption" aria-live="polite"><span id="lb-title"></span><span class="lb-date" id="lb-date"></span></p>
    <p class="lb-nav"><span class="lb-count" id="lb-count"></span> <button class="lb-link" id="lb-prev" type="button">__PREV__</button> · <button class="lb-link" id="lb-next" type="button">__NEXT__</button> · <button class="lb-link" id="lb-close" type="button">__CLOSE__</button></p>
  </div>
</div>
```

  Per page: `__LANG__` `ko`/`en`; `__BASE__` `""`/`"../"`; `__SWITCHHREF__` `en/`/`../`; `__SWITCHLANG__` `en`/`ko`; `__SWITCH__` `English`/`한국어`; `__DESCRIPTION__` from `site.description`/`site.description_en` with `{total}`; `__ALTERNATES__` three lines `<link rel="alternate" hreflang="ko" href="…">`, `hreflang="en"`, `hreflang="x-default"` (ko page `./`, `en/`, `./`; en page `../`, `./`, `../`); `__REDIRECT__` on the ko page only, exactly:

```html
<script>(function(){var s;try{s=localStorage.getItem('nocturne.lang')}catch(e){}var l=(navigator.languages&&navigator.languages[0])||navigator.language||'';if(s==='en'||(!s&&!/^ko/i.test(l)))location.replace('en/'+location.hash)})()</script>
```

  (empty string on the en page). The other placeholders come from `STRINGS`/`total_text`.

  Fragments (`__NAV__` is the same string in both lists; `B` is the page's `__BASE__`):
  - nav item: `<li><a href="#river">강</a></li>` (en: `River`, from `name_en`, falling back to `name`)
  - room: `<section class="room" id="river"><header class="room-head"><h2>강</h2><span class="room-count">7점</span><span class="room-span">2026.09 – 2026.10</span></header><div class="hang">…</div></section>` (en count `7`; `room-span` omitted when empty)
  - print: `<figure class="print" data-slug="n1" data-w="600" data-h="400" data-thumb="B<thumb url>" data-full="B<full url>" data-title="공중전화" data-date="2025.11.30" style="--c:#rrggbb;--r:600/400"><button class="print-btn" type="button" aria-label="공중전화 크게 보기" aria-describedby="alt-n1"><img id="alt-n1" src="B<thumb url>" alt="…" width="300" height="200"[ loading="lazy"] decoding="async"></button><figcaption class="label">공중전화<span class="label-date">, 2025.11.30</span></figcaption></figure>` (`data-date=""` and no `label-date` span without a date; `loading="lazy"` on every room but the first)
  - en page text: title from `title_en`, alt from `alt_en`. When `title_en` is missing the Korean title is used, the figure gets `data-title-lang="ko"` and the label title is wrapped `<span lang="ko">공중전화</span>`; when `alt_en` is missing the Korean alt is used and the `<img>` gets `lang="ko"`.
  - cover: `<figure class="cover"><button class="cover-btn" type="button" data-open="a1" style="--c:…;--r:w/h" aria-label="…" aria-describedby="alt-a1"><img src="B<full url>" alt="…" width="…" height="…" fetchpriority="high"></button><figcaption class="label">…</figcaption></figure>` (same text and label rules as a print; no camera)
  - `__LEDE__` is gone. `<style>` and `<script>` stay as they are in this task (Task 2 replaces them), so the page may look and behave broken in a browser after this task.

- [ ] **Step 1: Write the failing tests** in `tests/test_build.py` (replace `test_roman`, `test_page`, the `River`/numeral assertions in `test_screen_readers_…`, and `test_footer_links_to_the_admin_page`; keep `test_escapes_text`, `test_missing_photo_file`, `test_out_dir`, `TokenTests` for now). `self.html()` reads the Korean page; add `def en(self): build.build(self.root); return (self.root / "en" / "index.html").read_text(encoding="utf-8")`. `helpers.SITE` gains `site.description_en = "{total} photographs"` and, on photo `n1` only, `"title_en": "Payphone", "alt_en": "A red payphone booth"` (keep `name_en`; drop only `lede`).

```python
def body(html):
    return html.split("<body>", 1)[1].split("<script>", 1)[0]  # the old <style> still names gone classes until Task 2

def test_page(self):
    html = self.html()
    for s in ('<html lang="ko">', "<title>Nocturne</title>", '<a class="mark" href="#top">Nocturne</a>',
              '<li><a href="#river">강</a></li>', '<h2>강</h2><span class="room-count">2점</span>',
              '<h2>밤</h2><span class="room-count">1점</span>', '<summary>목록</summary>', '<nav aria-label="전시실">',
              '<a class="lang" href="en/" lang="en" hreflang="en">English</a>', '사진 3점<br>© 2026 Nocturne<br>'):
        self.assertIn(s, html)
    for gone in ("room-num", "room-en", "room-note", "lede", "River", "Night", "label-meta", "data-meta"):
        self.assertNotIn(gone, body(html))
    self.assertEqual(html.count('<figure class="print"'), 3)
    self.assertEqual(html.count('<li><a href="#night">밤</a></li>'), 2)  # phone menu and side list
    self.assertIsNone(re.search(r"__[A-Z]+__", html))

def test_english_page(self):
    html = self.en()
    for s in ('<html lang="en">', '<li><a href="#river">River</a></li>', '<h2>Night</h2><span class="room-count">1</span>',
              '<summary>Index</summary>', '<nav aria-label="Rooms">', 'aria-label="Photo viewer"', '>Previous<', '>Next<', '>Close<',
              '<a class="lang" href="../" lang="ko" hreflang="ko">한국어</a>', '3 photographs<br>',
              '<a class="foot-admin" href="../admin/">Admin</a>', '<meta name="description" content="3 photographs">'):
        self.assertIn(s, html)
    self.assertIn('aria-label="View Payphone"', html)
    self.assertIn('<figcaption class="label">Payphone<span class="label-date">, 2025.11.30</span></figcaption>', html)
    self.assertRegex(html, r'<img id="alt-n1" src="\.\./photos/thumb/n1\.jpg\?v=[0-9a-f]{8}" alt="A red payphone booth"')
    self.assertIsNone(re.search(r'(src|data-thumb|data-full)="photos/', html))  # every asset path starts with ../
    self.assertIsNone(re.search(r"__[A-Z]+__", html))

def test_english_falls_back_to_korean(self):
    html = self.en()
    self.assertRegex(html, r'data-slug="a2"[^>]*data-title="다리 아래"[^>]*data-title-lang="ko"')
    self.assertIn('<figcaption class="label"><span lang="ko">다리 아래</span></figcaption>', html)
    self.assertRegex(html, r'<img id="alt-a2"[^>]*alt="다리 상판"[^>]*lang="ko"')
    self.assertNotIn('data-title-lang', re.search(r'<figure class="print" data-slug="n1".*?</figure>', html, re.S).group(0))

def test_alternates_and_redirect(self):
    ko, en = self.html(), self.en()
    for page, links in ((ko, ("./", "en/", "./")), (en, ("../", "./", "../"))):
        for lang, href in zip(("ko", "en", "x-default"), links):
            self.assertIn(f'<link rel="alternate" hreflang="{lang}" href="{href}">', page)
    self.assertIn("localStorage.getItem('nocturne.lang')", ko)
    self.assertIn("location.replace('en/'+location.hash)", ko)
    self.assertNotIn("location.replace", en)

def test_total_text(self):
    self.assertEqual([build.total_text("ko", 3), build.total_text("en", 3), build.total_text("en", 1)],
                     ["사진 3점", "3 photographs", "1 photograph"])

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
    data["rooms"].append({"id": "new", "name": "새 방", "name_en": "New", "note": "n", "photos": []})
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

  In `test_screen_readers_hear_the_alt_and_clean_names` change the `<img id="alt-n1" src="photos/thumb/n1.jpg"` expectations to the `?v=` URL (use `build.asset_url`) and drop the `River`/numeral assertions; keep the unique-ids and cover aria checks. In `test_out_dir` also expect `en/index.html`.

  In `tests/test_photodata.py` add:

```python
def test_real_data_shape(self):
    data = photolib.load_data(helpers.ROOT)
    self.assertNotIn("lede", data["site"])
    self.assertIn("{total}", data["site"]["description_en"])
    for room in data["rooms"]:
        self.assertTrue({"id", "name", "name_en", "note", "photos"} <= set(room), room["id"])
```

- [ ] **Step 2: Run them to see them fail**

Run: `py -m unittest discover -s tests -p "test_build.py" -v`, then `-p "test_photodata.py"`
Expected: FAIL (`room_span`/`asset_url`/`total_text` missing, old markup, no `en/`, `lede` present).

- [ ] **Step 3: Implement**
  - `src/photos.json`: delete `site.lede`; add `site.description_en`: `"A photo exhibition of {total} photographs taken by the river, at the stadium and on late-night streets."`; keep everything else. `tests/helpers.py` `SITE` and both fixtures: the same shape changes as described in Step 1 (`site.canonical.json` must stay byte-identical to `photolib.dumps_data(helpers.SITE)`).
  - `build.room_span`: months are `date[:7]` of dates matching `^\d{4}\.\d{2}`; others ignored.
  - `build.asset_url`: sha256 of the file bytes. `photo_info` still runs first and raises `BuildError` for a missing file.
  - `build.build`: render the template once per language with the fragments and placeholders above (one `re.sub` pass per page, as now); write `dest/index.html` and `dest/en/index.html` (create `en/`).
  - `src/template.html`: `<html lang="__LANG__">`, the head placeholders, and the body markup from the contract; leave `<style>` and `<script>` as they are.
  - `CLAUDE.md`: in "photos.json 형식"/"명령줄 대안": `note` is the room description given to the AI only (not shown on the site); `name_en` is the room name on the English page; new rooms need `id`, `name`, `name_en`, `note`, `photos`; `site.description_en`; optional `title_en`/`alt_en` (the English page falls back to Korean without them); the lede is gone.

- [ ] **Step 4: Run them to see them pass**

Run: `py -m unittest discover -s tests -p "test_build.py" -v`, then `-p "test_photodata.py"`, then `node --test "tests/js/*.test.js"` (gallery/exhibit tests read the fixtures)
Expected: all PASS (JS: the known EFAULT flake only).

- [ ] **Step 5: Commit**

```bash
git add scripts/build.py src/template.html src/photos.json tests/ CLAUDE.md
git commit -m "Build: Korean and English pages, plain room heads, dated labels, hashed photo URLs"
```

### Task 2: Black room look and behaviour

**Files:**
- Modify: `src/template.html` (`<head>` font links and meta, whole `<style>`, whole `<script>`; markup only if a hook is missing), `tests/helpers.py` (replace `theme_tokens` with `root_tokens`), `tests/test_admin_static.py` (remove `test_tokens_match_site`), `CLAUDE.md` (디자인 메모)
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
        self.assertIn("localStorage.setItem('nocturne.lang'", text)  # the toggle remembers the choice
```

  `helpers.contrast` needs 6-digit hex; pass `#000000` as above.

- [ ] **Step 2: Run to see them fail**

Run: `py -m unittest discover -s tests -p "test_build.py" -v`
Expected: FAIL (`root_tokens` missing, old tokens/fonts).

- [ ] **Step 3: Implement**
  - `<head>`: keep the two preconnects; the font link exactly as in the test; add `<meta name="theme-color" content="#000">`.
  - `<style>`: all of spec §1 (colour table, type, two-column layout from 960px with the 180px sticky side and `clamp()` gaps/margins from the spec, phone bar + `details.menu` drop-down, cover sizing via `min(100cqi, (100svh - var(--bar) - 8rem) * var(--r))`-style rule as now, room head, hang gap `clamp(10px, 1.3vw, 16px)`, labels, foot, viewing room with `.lb-link` text buttons: `--ink-dim` → `--ink` on hover/focus, padding giving ≥24px height and ≥40px under 960px). Show `.rooms-side` and `.fine` only from 960px; show `details.menu` and `.foot` only below it. Below 960px rooms get `scroll-margin-top` equal to the bar height so a jump from the menu is not hidden under the bar. The `.lang` toggle: `--ink-dim`, `--ink` on hover; from 960px it sits under the room list with 28px above; below 960px it sits in the bar to the left of `목록`/`Index` (flex `order`). Focus ring `2px solid var(--ink)`, offset 3px. Keep the photo fade-in and `prefers-reduced-motion`.
  - `<script>`: keep fade-in, the justified hang (targets 300 / 240 / 180 at hang widths ≥1100 / ≥720 / below; CAP 1.6; skip a hang with no prints), and the current-room observer, which now marks every `.rooms a` for the room (class `is-here` + `aria-current="true"`; the side list draws the `•` with CSS). Remove `reveal()`. A click on `.lang` stores its `lang` attribute with `localStorage.setItem('nocturne.lang', …)` inside `try` before the browser follows the link. Phone menu: close `details.menu` on a link click, on Escape, and on a click outside it. Viewing room: `show(i)` fills `#lb-title`, `#lb-date` (`", " + date` or empty), `#lb-count` (`(i+1) + " / " + N`, no zero padding); `#lb-title` gets `lang` from the print's `data-title-lang` (removed when absent); thumbnail-then-full swap, preloading, arrows/Escape, swipe, stage-click-closes, focus starts on `#lb-close`, Tab cycles `#lb-prev`, `#lb-next`, `#lb-close`, focus returns on close — all as today.
  - `tests/helpers.py`: `root_tokens` replaces `theme_tokens`; `tests/test_admin_static.py`: delete `test_tokens_match_site` (part 2 re-adds a match test with the new tokens).
  - `CLAUDE.md` 디자인 메모: new colour table (one theme), no lamp/light theme, one font and its sizes, labels "제목, 날짜", room head, viewing room text buttons, the 960px two-column rule, and that the admin page keeps its old look until part 2.

- [ ] **Step 4: Run tests**

Run: `py -m unittest discover -s tests -p "test_build.py" -v` and `-p "test_admin_static.py"`
Expected: PASS.

- [ ] **Step 5: Look at it in the browser** (built-in browser pane; start the server with the Bash tool in the background: `py tests/browser/serve.py --port 8000`, build with `py scripts/build.py`, open `http://localhost:8000/`)
  - Desktop width: side column with `•` on the room in view while scrolling; cover fits the first screen; labels "제목, 날짜"; room heads with count and span.
  - 375px (`resize_window` preset `mobile`, then back to `desktop`): bar with `목록`; menu opens, closes on a pick, on Escape and on an outside tap; no horizontal scroll; foot line at the bottom.
  - Viewer: open from a print and from the cover; arrows, Escape, Tab cycling, swipe (pointer drag), click beside the photo closes; caption and count update.
  - English: `http://localhost:8000/en/` looks the same with English copy; `한국어` goes to `/`, `English` to `/en/`. After choosing English, opening `/` lands on `/en/`; after choosing 한국어 it stays on `/`. Clear `localStorage` afterwards.
  - Review Focus 1 and 5: in the page, run `document.querySelector('.print').dataset.title = '아주 긴 제목이 화면 폭을 넘어갈 때 줄이 어떻게 바뀌는지 보는 시험 문장입니다'` and set the first label's text to the same, open that photo at 375px (also on `/en/`): caption wraps, `이전 · 다음 · 닫기` stay visible and tappable, no horizontal scroll. An empty room's markup is covered by `test_empty_room`; the hang code must return early for a hang with no prints (check it in the code).
  - The browser console has no errors.

- [ ] **Step 6: Commit**

```bash
git add src/template.html tests/helpers.py tests/test_build.py tests/test_admin_static.py CLAUDE.md
git commit -m "Site: black room, one serif, side index, text-only viewer and language toggle"
```

### Task 3: App icons (controller)

**Files:**
- Create: `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/apple-touch-icon.png`

- [ ] **Step 1:** Write `tests/browser/out/icons.html` (git-ignored) that loads Noto Serif KR 400 from Google Fonts, waits for `document.fonts.load('400 100px "Noto Serif KR"', 'N')`, draws on a canvas per file a `#000` square with "N" in `#ebe9e4`, glyph cap height ≈ 56% of the side (maskable: inside the central 80%), centred optically, and PUTs each PNG blob to `/tests/browser/out/<file>` (serve.py accepts that).
- [ ] **Step 2:** Open it in the built-in browser via `serve.py`; re-save each PNG with Pillow (RGB, no metadata, exact size: 192, 512, 512, 180) into `icons/`; read each file to look at it.
- [ ] **Step 3:** Judge them at their real sizes (192 and 180 must stay crisp); the user sees them in the final report and can ask for changes then.
- [ ] **Step 4: Commit**

```bash
git add icons/
git commit -m "Icons: N in Noto Serif KR on black for the installed site"
```

### Task 4: The AI writes English too

**Files:**
- Modify: `scripts/curator.py` (prompt, schema, reply parsing, English alt finish), `scripts/photolib.py` (`AI_FIELDS`), `scripts/worker.py` (published entry), `tests/helpers.py` (`FakeAI`), `tests/browser/run_worker.py` (its fake draft), `CLAUDE.md` (AI sections: limits, `ai.fields`)
- Test: `tests/test_curator.py`, `tests/test_worker.py`, `tests/test_photodata.py`

**Interfaces:**
- Produces:
  - `photolib.AI_FIELDS = ("title", "alt", "title_en", "alt_en")` (this order; `ai_entry` and `apply_ai_text` follow it)
  - `curator.TITLE_EN_MAX = 60`, `curator.ALT_EN_MAX = 250`
  - `curator.finish_alt_en(alt_en: str, grayscale: bool) -> str`: collapse whitespace, strip a trailing period, append `", black-and-white photo"` for black-and-white photos unless it already ends with `"black-and-white photo"`
  - `curator.parse_reply(text, room_ids) -> {"room", "title", "alt", "title_en", "alt_en", "known"}` (all four texts required and non-empty; `title_en` cut to 60, `alt_en` to 250 with `clamp`)
  - `curator.claude_schema(room_ids)`: properties and `required` gain `title_en`, `alt_en` (strings)
  - `curator.draft(...)` and `curator.claude_draft(...)` return `title_en` and `alt_en` too (`alt_en` through `finish_alt_en`)
  - `FakeAI` drafts gain `"title_en": "Draft", "alt_en": "A draft description"`.
- Prompt text (exact):
  - `PROMPT_HEAD = "당신은 사진 전시 사이트의 큐레이터입니다. 이 사진을 아래 방 중 하나에 걸고, 한국어 제목과 대체 텍스트(alt), 그리고 같은 뜻의 영어 제목(title_en)과 영어 대체 텍스트(alt_en)를 쓰세요."`
  - one more rule line at the end of `PROMPT_RULES`: `"- 영어 제목은 2~6단어의 짧은 명사구, 영어 alt는 무엇이 찍혔는지 한 문장이고 마침표로 끝내지 마세요. 영어에도 위 규칙(장소 이름, 흑백)을 똑같이 지키세요."`
  - `PROMPT_REPLY = 'JSON으로만 답하세요: {"room": "<방 id>", "title": "...", "alt": "...", "title_en": "...", "alt_en": "..."}'`
  - example lines: `- [방] 제목 / alt`, followed by ` | title_en / alt_en` when that photo has both English texts.

- [ ] **Step 1: Write the failing tests**
  - `test_photodata`: `AI_FIELDS` is the four names in order; `apply_ai_text(photo, texts, "m", ["alt_en", "title"])` leaves `ai.fields == ["title", "alt_en"]` (AI_FIELDS order); `ai_entry("m", 0.9)["fields"]` has all four.
  - `test_curator`:
    - `build_prompt` contains `title_en`, `alt_en`, and the new rule line; an example line shows ` | Payphone / A red payphone booth` for `helpers.SITE`'s `n1`.
    - `parse_reply` accepts the four-key JSON; it raises `ValueError` when `title_en` or `alt_en` is missing or blank; it cuts a 70-character English title to at most 60 characters on a word boundary and a 300-character English alt to at most 250.
    - `finish_alt_en("A red booth.", True) == "A red booth, black-and-white photo"`; it does not add the suffix twice; with `False` the suffix is absent.
    - `claude_schema(["river"])["required"] == ["room", "title", "alt", "title_en", "alt_en", "confidence"]`.
    - The existing Ollama and Claude draft tests' fake replies gain the two English keys and assert the returned dict carries them (with the grayscale suffix on `alt_en` in the grayscale case).
  - `test_worker`:
    - A published photo has `title_en == "Draft"`, `alt_en == "A draft description"`, and `ai.fields` with all four.
    - A redraft of a photo without English fills `title_en`/`alt_en` and lists them in `ai.fields`.
    - A redraft where `title_en` changed after the claim keeps the person's `title_en` and leaves it out of `ai.fields`.
    - An upgrade rewrites only the fields still in `ai.fields`, English included.

- [ ] **Step 2: Run them to see them fail** — `py -m unittest discover -s tests -p "test_curator.py" -v` and `-p "test_photodata.py"`; `test_worker.py` in WSL (it uses the fake GitHub over loopback). Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement** the interfaces above. In `worker.py` the published entry adds `title_en` and `alt_en` from the draft right after `alt`. Nothing else in the redraft and upgrade code changes: both already go through `AI_FIELDS` and `ai.fields`. `run_worker.py`'s fake drafter gets the same two English texts as `FakeAI`. `CLAUDE.md`: in 알아둘 것, "AI 제목은 40자, 설명은 200자에서 자른다" gains "영어 제목은 60자, 영어 설명은 250자"; in photos.json 형식, `fields` can list `title_en`/`alt_en`, and the example becomes `["title","alt","title_en","alt_en"]`; the 흑백 rule names the English suffix.

- [ ] **Step 4: Run the tests** — the three files above (worker in WSL) plus `node --test "tests/js/*.test.js"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/curator.py scripts/photolib.py scripts/worker.py tests/ CLAUDE.md
git commit -m "AI: draft English titles and descriptions next to the Korean ones"
```

### Task 5: English for the photos on show (controller)

**Files:**
- Modify: `src/photos.json`

- [ ] **Step 1:** For every photo without `title_en`/`alt_en`, look at its thumbnail (`photos/thumb/<file>.jpg`) and its Korean title and alt, and write `title_en` (short noun phrase, 2–6 words) and `alt_en` (one sentence, no final period, no place names, `", black-and-white photo"` at the end when the Korean alt ends with `흑백 사진`). Keep the length limits (60 / 250).
- [ ] **Step 2:** Mark them as AI text: if the photo has `ai`, add the two names to `ai.fields` (AI_FIELDS order, model unchanged); otherwise add `"ai": {"model": "claude-opus-5-5", "fields": ["title_en", "alt_en"]}`. Write the file with `photolib.save_data` (canonical format).
- [ ] **Step 3:** `py scripts/build.py` builds; `py -m unittest discover -s tests -p "test_photodata.py" -v` passes; open `http://localhost:8000/en/` and look.
- [ ] **Step 4: Commit** — `git commit -am "Photos: English titles and descriptions for the photos on show"`; the table (file, Korean title, English title, English alt) goes into the final report.

### Task 6: Install and offline (manifest + service worker)

**Files:**
- Create: `src/sw.js`, `tests/js/sw.test.js`
- Modify: `scripts/build.py` (write `manifest.webmanifest` and `sw.js`; `COPIED = ("photos", "admin", "icons")`), `src/template.html` (head links, registration), `tests/helpers.py` (`make_site` copies `src/sw.js` and `icons/`), `.gitignore` (`/sw.js`, `/manifest.webmanifest`), `.github/workflows/site.yml` (`paths` gains `"icons/**"`), `tests/test_workflows.py`, `CLAUDE.md` (구조 tree, PWA section)
- Test: `tests/test_build.py` (`PwaTests`), `tests/js/sw.test.js`

**Interfaces:**
- Consumes: `build.asset_url` and the per-page `__BASE__` (Task 1), `icons/*` (Task 3).
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
```

- [ ] **Step 2: Write the failing Python tests** (`PwaTests` in `tests/test_build.py`; `setUp` like `BuildTests`, `out` a temp `_site`)
  - `test_manifest`: `json.loads(out/manifest.webmanifest)` equals the spec's object with `description == "사진 3점"` (`SITE` description with `{total}` filled); every `icons[].src` exists under `out`.
  - `test_sw`: `out/sw.js` has no `__VERSION__`/`__PHOTOS__`; `re.search(r"const VERSION = '([0-9a-f]{12})';")` matches; `json.loads(re.search(r"const PHOTOS = (\[.*?\]);", text, re.S).group(1)) == [{"thumb": build.asset_url(root, "thumb", f), "full": build.asset_url(root, "full", f)} for f in ("a1", "a2", "n1")]`; building twice gives the same VERSION; changing a title gives a different one.
  - `test_root_build_writes_pwa_files`: `build.build(root)` writes `root/sw.js` and `root/manifest.webmanifest`.
  - `test_head`: the Korean page has `<link rel="manifest" href="manifest.webmanifest">`, `<link rel="icon" href="icons/icon-192.png">`, `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">` and `navigator.serviceWorker.register('sw.js')`; the English page has the same with `../` in front of each path.
  - `test_out_dir` (existing): also expects `icons/icon-512.png`, `manifest.webmanifest`, `sw.js`.
  - `test_sw` also: changing only an English text changes VERSION (the hash covers both pages).
  - `test_gitignore`: the repo `.gitignore` has the lines `/sw.js` and `/manifest.webmanifest`.
  - `tests/test_workflows.py`: `site.yml` push `paths` include `"icons/**"`.

- [ ] **Step 3: Run both to see them fail**

Run: `node --test tests/js/sw.test.js` and `py -m unittest discover -s tests -p "test_build.py" -v`
Expected: FAIL (no `src/sw.js`, no PWA output).

- [ ] **Step 4: Implement**
  - `src/sw.js`: the three pure functions; `route` compares paths against `new URL(scope).pathname` (`admin` and `admin/…` → `pass` first; `page` only for `mode === 'navigate'` on the scope path or `index.html`; `shell` for `manifest.webmanifest` and `icons/`; fonts by host). Event listeners only inside `if (typeof ServiceWorkerGlobalScope !== 'undefined')`:
    - `install`: `nocturne-page` ← `./`, `en/`, `manifest.webmanifest`, the four icons (`addAll`); `nocturne-thumbs` ← every `PHOTOS[].thumb` not yet cached, each fetched on its own (a failed thumb does not fail the install); then `skipWaiting()`.
    - `activate`: delete caches not named above; delete `stale(...)` entries from `nocturne-thumbs` and `nocturne-full`; `clients.claim()`.
    - `fetch`: non-GET → nothing; then by `route(request.url, registration.scope, request.mode)` per spec §3 (page: network with a 4000 ms race, store the response under that page's key — the scope URL or scope + `en/` — only if `storable`, fall back to that cached page, else keep waiting for the network; shell: cache then network; thumb/full: cache then network, store only if `storable` and the URL is in `PHOTOS`; font-css: cached copy now, refresh in the background; font-file: cache then network and store if `storable`; pass: no `respondWith`).
  - `scripts/build.py`: after writing `index.html`, write `manifest.webmanifest` (spec object, `json.dumps(..., ensure_ascii=False, indent=2)`, final newline) and `sw.js` = template with `VERSION` = first 12 hex of sha256 over (Korean page text + English page text + manifest text + sw template text) and `PHOTOS` = `json.dumps` of the `{thumb, full}` list in page order; both to the same `dest` as `index.html`.
  - `src/template.html` `<head>`: the manifest, icon and apple-touch-icon links, each `__BASE__`-prefixed. End of the inline script: `if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('__BASE__sw.js');`
  - `tests/helpers.py` `make_site`: also copy `src/sw.js` and the `icons/` folder.
  - `.gitignore`, `site.yml` as listed.
  - `CLAUDE.md`: 구조 tree (`icons/`, `src/sw.js`, build writes `manifest.webmanifest` and `sw.js` and that the root copies are git-ignored); a short PWA section: how to install (Android Chrome ⋮ → 앱 설치, iPhone Safari 공유 → 홈 화면에 추가), what works offline (page, all thumbnails, originals once viewed), when a new version arrives (next online open), that `admin/` is never touched by the site's service worker, and that local preview at `localhost:8000` registers it too (DevTools → Application → Service workers → Unregister to clear).

- [ ] **Step 5: Run the tests**

Run: `node --test "tests/js/*.test.js"`, `py -m unittest discover -s tests -p "test_build.py" -v`, `-p "test_workflows.py"`; the full Python suite in WSL.
Expected: PASS (known JS EFAULT flake only; WSL: only `test_index_not_tracked` if run from a worktree).

- [ ] **Step 6: Check it in the browser** (built-in browser, `serve.py` on 8000, `py scripts/build.py`)
  - `await navigator.serviceWorker.ready` resolves; `(await caches.keys())` lists the four cache names after opening a photo; `nocturne-thumbs` holds every thumb.
  - Stop `serve.py`, reload `http://localhost:8000/` and `/en/`: both pages and all thumbnails show; a photo opened before shows full size; one never opened shows its thumbnail.
  - Start `serve.py` again plus `py tests/fake_github.py --port 8790 --seed`; open `http://localhost:8000/admin/?api=http://127.0.0.1:8790`, log in, open both tabs: works as before (Review Focus 3).
  - Unregister the service worker afterwards.

- [ ] **Step 7: Commit**

```bash
git add src/sw.js tests/js/sw.test.js scripts/build.py src/template.html tests/ .gitignore .github/workflows/site.yml CLAUDE.md
git commit -m "PWA: manifest, icons and a service worker that keeps the exhibition offline"
```

### Task 7: Merge, deploy, README images (controller)

- [ ] **Step 1:** Whole-branch review (fresh reviewer, spec + plan + diff), one fix wave, scoped re-review; full JS and Python (WSL) suites green.
- [ ] **Step 2:** Merge `site-redesign` into `main`, push; watch the `Site` run; open https://hpotty36.github.io/nocturne/ in the built-in browser and check desktop and 375px.
- [ ] **Step 3:** README assets from the live site: `screen-desktop-dark.jpg` (1440×900), `screen-phone-dark.jpg` (390×844 at 2×) via headless Chrome over the DevTools protocol (remove the policy-installed extension's injected nodes before capture; keep only the site's top-level markup), JPEG 82, no metadata; delete `screen-*-light.jpg`; `wordmark-dark.png`/`wordmark-light.png` re-rendered in Noto Serif KR 400 (transparent); `social-preview.jpg` 1280×640 on `#000` with the new wordmark and five thumbnails. Look at every image.
- [ ] **Step 4:** `README.md` / `README.ko.md`: hero uses plain dark images; Highlights drop the light-theme line and add "Korean and English, with a toggle" and "installable, works offline after one visit"; the AI line says it drafts Korean and English; tech stack notes the service worker; CLAUDE.md's README-images note updated (no light screenshots, Noto Serif KR wordmark). Commit and push.
- [ ] **Step 5:** Report to the user: what shipped, the icons, the English-text table from Task 5, rulings made; ask them to upload the new social preview, install the site on the phone and open it in airplane mode.
