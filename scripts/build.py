"""Build index.html (Korean) and en/index.html (English) from src/template.html and src/photos.json.

Usage:  python scripts/build.py [--out DIR]      (Windows: py scripts\\build.py)

Without --out the pages are written to index.html and en/index.html at the project root. With --out
they go to DIR and photos/ (and admin/, if present) are copied next to them, which is the folder
GitHub Pages publishes.

Reads each photo's size and average colour from photos/full and photos/thumb,
so run scripts/prepare_photos.py first for any new photo.
"""
import argparse
import hashlib
import html
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

import photolib

ROOT = Path(__file__).resolve().parent.parent

COPIED = ("photos", "admin")  # folders published next to index.html with --out

# Screen text per language. `view` and `count` are templates: {title}, {n}.
STRINGS = {
    "ko": {"menu": "목록", "prev": "이전", "next": "다음", "close": "닫기", "admin": "관리", "nav": "전시실",
           "viewer": "사진 크게 보기", "switch": "English", "view": "{title} 크게 보기", "count": "{n}점"},
    "en": {"menu": "Index", "prev": "Previous", "next": "Next", "close": "Close", "admin": "Admin", "nav": "Rooms",
           "viewer": "Photo viewer", "switch": "한국어", "view": "View {title}", "count": "{n}"},
}

# Per page: where it is written, the prefix its asset and admin links need, the language toggle, and the
# hrefs of its <link rel="alternate"> lines (ko, en, x-default).
PAGES = {
    "ko": {"file": "index.html", "base": "", "switch_href": "en/", "switch_lang": "en", "alternates": ("./", "en/", "./")},
    "en": {"file": "en/index.html", "base": "../", "switch_href": "../", "switch_lang": "ko", "alternates": ("../", "./", "../")},
}

# Only the Korean page (the site root, which an installed app opens) sends a visitor to the English page:
# when English was chosen before, or when nothing was chosen and the browser is not set to Korean.
REDIRECT = "<script>(function(){var s;try{s=localStorage.getItem('nocturne.lang')}catch(e){}var l=(navigator.languages&&navigator.languages[0])||navigator.language||'';if(s==='en'||(!s&&!/^ko/i.test(l)))location.replace('en/'+location.hash)})()</script>"

COPY_PATHS = {"thumb": photolib.thumb_path, "full": photolib.full_path}


class BuildError(Exception):
    """The page cannot be built (e.g. a listed photo has no web copy)."""


def esc(s):
    return html.escape(str(s), quote=True)


def photo_info(root, name):
    """(full width, full height, thumb width, thumb height, average colour) of a web copy."""
    full, thumb = photolib.full_path(root, name), photolib.thumb_path(root, name)
    missing = [p.relative_to(root).as_posix() for p in (full, thumb) if not p.exists()]
    if missing:
        raise BuildError(f"사진 파일이 없습니다: {', '.join(missing)}\n"
                         f"originals/ 에 원본을 넣고 scripts/prepare_photos.py 를 먼저 실행하세요.")
    with Image.open(full) as im:
        w, h = im.size
    with Image.open(thumb) as im:
        tw, th = im.size
        r, g, b = im.convert("RGB").resize((1, 1), Image.BOX).getpixel((0, 0))
    return w, h, tw, th, f"#{r:02x}{g:02x}{b:02x}"


def asset_url(root, kind, name):
    """Site-relative URL of a web copy, with the first 8 hex of the file's sha256 as ?v=.

    kind is "thumb" or "full". The hash changes the URL whenever the picture behind a name changes, so a
    browser or service worker never hands out the old one. A page adds its own base ("" or "../").
    """
    digest = hashlib.sha256(COPY_PATHS[kind](root, name).read_bytes()).hexdigest()[:8]
    return f"photos/{kind}/{name}.jpg?v={digest}"


def room_span(photos):
    """"2026.09 – 2026.10": the earliest and latest month of the photos' dates. One month gives just that month,
    no dated photo gives ""."""
    months = sorted({p["date"][:7] for p in photos if re.match(r"\d{4}\.\d{2}", p.get("date") or "")})
    if not months:
        return ""
    return months[0] if months[0] == months[-1] else f"{months[0]} – {months[-1]}"


def total_text(lang, n):
    """"사진 3점" / "3 photographs" ("1 photograph")."""
    if lang == "en":
        return f"{n} photograph" if n == 1 else f"{n} photographs"
    return f"사진 {n}점"


def pick(photo, field, lang):
    """(text, korean_fallback) of a photo's title or alt on the page of `lang`.

    The English page shows title_en / alt_en; without them it shows the Korean text, and says so (the caller
    marks that element lang="ko"), so it is read in the right voice and never comes out empty.
    """
    if lang == "en":
        english = photo.get(f"{field}_en")
        return (english, False) if english else (photo[field], True)
    return photo[field], False


def label_html(title, korean, date):
    """Wall label under a photo: the title, then ", date" (dimmed) if there is one."""
    shown = f'<span lang="ko">{esc(title)}</span>' if korean else esc(title)
    when = f'<span class="label-date">, {esc(date)}</span>' if date else ""
    return f'<figcaption class="label">{shown}{when}</figcaption>'


def print_html(p, f, lang, base, lazy):
    """One photo in its room. f is its shared facts: size, average colour and hashed URLs."""
    name, date = esc(p["file"]), p.get("date") or ""
    title, title_ko = pick(p, "title", lang)
    alt, alt_ko = pick(p, "alt", lang)
    view = STRINGS[lang]["view"].format(title=title)
    title_lang = ' data-title-lang="ko"' if title_ko else ""
    alt_lang = ' lang="ko"' if alt_ko else ""
    loading = ' loading="lazy"' if lazy else ""
    # The button's aria-label names it, which hides the photo's alt; aria-describedby brings the alt back as
    # its description. The cover (also hung in its room) points at the same image, so ids stay unique.
    alt_id = f"alt-{name}"
    return (
        f'<figure class="print" data-slug="{name}" data-w="{f["w"]}" data-h="{f["h"]}" '
        f'data-thumb="{esc(base + f["thumb"])}" data-full="{esc(base + f["full"])}" '
        f'data-title="{esc(title)}" data-date="{esc(date)}"{title_lang} style="--c:{f["col"]};--r:{f["w"]}/{f["h"]}">'
        f'<button class="print-btn" type="button" aria-label="{esc(view)}" aria-describedby="{alt_id}">'
        f'<img id="{alt_id}" src="{esc(base + f["thumb"])}" alt="{esc(alt)}"{alt_lang} '
        f'width="{f["tw"]}" height="{f["th"]}"{loading} decoding="async">'
        f'</button>{label_html(title, title_ko, date)}</figure>'
    )


def cover_html(p, f, lang, base):
    """The cover print: the full-size copy, labelled like any print (title, date; no camera)."""
    name, date = esc(p["file"]), p.get("date") or ""
    title, title_ko = pick(p, "title", lang)
    alt, alt_ko = pick(p, "alt", lang)
    view = STRINGS[lang]["view"].format(title=title)
    alt_lang = ' lang="ko"' if alt_ko else ""
    return (
        f'<figure class="cover"><button class="cover-btn" type="button" data-open="{name}" '
        f'style="--c:{f["col"]};--r:{f["w"]}/{f["h"]}" aria-label="{esc(view)}" aria-describedby="alt-{name}">'
        f'<img src="{esc(base + f["full"])}" alt="{esc(alt)}"{alt_lang} '
        f'width="{f["w"]}" height="{f["h"]}" fetchpriority="high"></button>{label_html(title, title_ko, date)}</figure>'
    )


def room_name(room, lang):
    """Room name on the page of `lang`: name_en on the English page, falling back to the Korean name."""
    return (room.get("name_en") or room["name"]) if lang == "en" else room["name"]


def room_html(room, facts, lang, base, first):
    """One room: a one-line head (name, count, span) and the hang of its prints. Only the first room loads eagerly."""
    count = STRINGS[lang]["count"].format(n=len(room["photos"]))
    span = room_span(room["photos"])
    span_html = f'<span class="room-span">{esc(span)}</span>' if span else ""
    prints = "".join(f"\n  {print_html(p, facts[p['file']], lang, base, not first)}" for p in room["photos"])
    return (f'<section class="room" id="{esc(room["id"])}"><header class="room-head"><h2>{esc(room_name(room, lang))}</h2>'
            f'<span class="room-count">{esc(count)}</span>{span_html}</header><div class="hang">{prints}\n</div></section>')


def render_page(template, data, facts, lang):
    """The template filled for one language. Everything from photos.json is escaped on the way in."""
    site, rooms = data["site"], data["rooms"]
    page, strings = PAGES[lang], STRINGS[lang]
    base, total = page["base"], sum(len(r["photos"]) for r in rooms)
    nav = "".join(f'<li><a href="#{esc(r["id"])}">{esc(room_name(r, lang))}</a></li>' for r in rooms)
    cover = ""
    for room in rooms:
        for p in room["photos"]:
            if p["file"] == data.get("cover"):
                cover = cover_html(p, facts[p["file"]], lang, base)
    description = site["description_en"] if lang == "en" and site.get("description_en") else site["description"]
    values = {
        "__LANG__": lang,
        "__REDIRECT__": REDIRECT if lang == "ko" else "",
        "__DESCRIPTION__": esc(description.format(total=total)),
        "__TITLE__": esc(site["title"]),
        "__ALTERNATES__": "\n".join(f'<link rel="alternate" hreflang="{code}" href="{href}">'
                                    for code, href in zip(("ko", "en", "x-default"), page["alternates"])),
        "__NAVLABEL__": esc(strings["nav"]),
        "__MENU__": esc(strings["menu"]),
        "__NAV__": nav,
        "__SWITCHHREF__": page["switch_href"],
        "__SWITCHLANG__": page["switch_lang"],
        "__SWITCH__": esc(strings["switch"]),
        "__TOTALTEXT__": esc(total_text(lang, total)),
        "__COPYRIGHT__": esc(site["copyright"]),
        "__BASE__": base,
        "__ADMIN__": esc(strings["admin"]),
        "__COVER__": cover,
        "__ROOMS__": "\n".join(room_html(r, facts, lang, base, i == 0) for i, r in enumerate(rooms)),
        "__VIEWERLABEL__": esc(strings["viewer"]),
        "__PREV__": esc(strings["prev"]),
        "__NEXT__": esc(strings["next"]),
        "__CLOSE__": esc(strings["close"]),
    }
    # one pass, so text from photos.json can never be read as a placeholder
    return re.sub(r"__[A-Z]+__", lambda m: values[m.group(0)], template)


def build(root, out=None):
    """Write index.html and en/index.html to root, or to out with photos/ and admin/ copied.

    Returns {"total": photos on show, "rooms": number of rooms}.
    """
    root = Path(root)
    data = photolib.load_data(root)
    rooms = data["rooms"]
    total = sum(len(r["photos"]) for r in rooms)

    facts = {}  # per photo, the same on both pages; photo_info checks that both web copies exist before they are hashed
    for room in rooms:
        for p in room["photos"]:
            name = p["file"]
            w, h, tw, th, col = photo_info(root, name)
            facts[name] = {"w": w, "h": h, "tw": tw, "th": th, "col": col,
                           "thumb": asset_url(root, "thumb", name), "full": asset_url(root, "full", name)}

    template = (root / "src" / "template.html").read_text(encoding="utf-8")
    dest = root if out is None else Path(out)
    for lang, page in PAGES.items():
        path = dest / page["file"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_page(template, data, facts, lang), encoding="utf-8", newline="\n")
    if out is not None:
        for folder in COPIED:
            if (root / folder).is_dir():
                shutil.copytree(root / folder, dest / folder, dirs_exist_ok=True)
    return {"total": total, "rooms": len(rooms)}


def main(argv=None):
    parser = argparse.ArgumentParser(description="src/photos.json 으로 index.html 과 en/index.html 을 만듭니다.")
    parser.add_argument("--out", type=Path, help="두 페이지와 photos/, admin/ 을 이 폴더에 씁니다")
    args = parser.parse_args(argv)
    try:
        result = build(ROOT, args.out)
    except BuildError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
    print(f"index.html, en/index.html 생성 완료: 사진 {result['total']}점, 방 {result['rooms']}개")
    if args.out is not None:
        print(f"출력 폴더: {args.out}")


if __name__ == "__main__":
    main()
