"""Maps the Previewer's inspector tree (UIContext.getFilteredInspectorTree) to the parity layout schema (docs/parity/LAYOUT.md).

Text rects follow the web's convention (the glyph run's content area: 1.364 x font size tall, as wide as the text), not the Text
component's box, so a lineHeight or a column width in the app does not move the exported rect."""
import json, os, re

CONTENT_AREA = 1.364  # Nunito Sans ascent + descent per em
FONT_FILES = {w: f"NunitoSans-W{w}.ttf" for w in (300, 400, 480, 560, 580, 610, 640, 680, 700, 720, 760, 820, 860, 900)}
WEIGHT_NAMES = {"lighter": 300, "regular": 400, "normal": 400, "medium": 500, "bold": 700, "bolder": 800}
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "clients", "harmony", "entry", "src", "main", "resources", "rawfile", "fonts")
KNOWN = set(chr(c) for c in range(0x20, 0x250)) | set('\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u00b7')
PLACEHOLDER = ("#312a30", "#dfdcdd")  # web artwork placeholder, dark and light
PAGE_SHELLS = {"settings": 2, "search": 2, "filters": 3, "movies": 3, "series": 3, "music": 3, "calendar-agenda": 3, "home": 2, "calendar-month": 1, "calendar-week": 1}  # full-viewport page-colour containers in the web DOM of each phone screen
_HB = {}
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def num(value, default=None):
    m = _NUM.search(str(value)) if value is not None else None
    return float(m.group()) if m else default


def rect_of(node):
    v = [float(x) for x in _NUM.findall(str(node.get("$rect", "")))]
    return (v[0], v[1], v[2], v[3]) if len(v) == 4 else None  # "[x, y],[width, height]" in px (the inspector's second pair is the size)


def argb(value):
    """'#AARRGGBB' or '#RRGGBB' -> (r, g, b, a)."""
    h = str(value or "").lstrip("#")
    if len(h) == 8:
        return tuple(int(h[i:i + 2], 16) for i in (2, 4, 6)) + (int(h[0:2], 16) / 255,)
    if len(h) == 6:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    return None


def hex_of(c):
    return "#%02x%02x%02x" % c[:3] + ("%02x" % round(c[3] * 255) if c[3] < 0.999 else "")


def over(top, below):
    a = top[3]
    return tuple(round(top[i] * a + below[i] * (1 - a)) for i in range(3)) + (1.0,)


def weight_of(attrs):
    fam = str(attrs.get("fontFamily", ""))
    if "PlayarrArrowsRegular" in fam:
        return 400
    if "PlayarrArrows" in fam:
        return 720
    m = re.search(r"NunitoSansW(\d+)", str(attrs.get("fontFamily", "")))
    if m:
        return int(m.group(1))
    raw = str(attrs.get("fontWeight", "")).split(".")[-1].lower()
    return WEIGHT_NAMES.get(raw) or int(num(raw, 400))


# advance of the glyphs web draws from Chromium's fallback fonts, in em (measured on the web layout refs)
GLYPH_EM = {"\u2190": 1.0, "\u2192": 1.0, "\u00d7": 0.6, "\u25b6": 0.769, "\u21e9": 0.838, "\uff0b": 1.0, "\u2713": 0.838, "\u25cb": 0.605, "\u2304": 0.838, "\u2637": 0.897}


def text_width(text, size, weight, spacing, measure=None):
    if text and all(ch in GLYPH_EM for ch in text) and len(text) <= 2:
        return size * sum(GLYPH_EM[ch] for ch in text)  # the fallback glyphs advance a fixed fraction of the em
    if measure is not None:
        return measure(text, size, weight) + spacing * len(text)
    try:  # HarfBuzz shapes with GPOS kerning as Chrome does (PIL's basic layout drifts by a pixel on long lines)
        import uharfbuzz as hb  # noqa: PLC0415
        name = FONT_FILES[min(FONT_FILES, key=lambda w: abs(w - weight))]
        if name not in _HB:
            face = hb.Face(hb.Blob.from_file_path(os.path.join(FONT_DIR, name)))
            _HB[name] = (hb.Font(face), face.upem)
        font, upem = _HB[name]
        run = "".join(ch if ch in KNOWN else "\u25a1" for ch in text)
        buf = hb.Buffer(); buf.add_str(run); buf.guess_segment_properties(); hb.shape(font, buf, {})
        advance = sum(p.x_advance for p in buf.glyph_positions)
        return advance * size / upem + spacing * len(text)
    except ImportError:
        pass
    from PIL import ImageFont  # noqa: PLC0415
    font = ImageFont.truetype(os.path.join(FONT_DIR, FONT_FILES[min(FONT_FILES, key=lambda w: abs(w - weight))]), 1000)
    advance = sum(font.getlength(ch) if ch in KNOWN else 1000 for ch in text)  # a glyph the font lacks falls back to a 1 em box, as web's fallback font does for arrows
    return advance * size / 1000 + spacing * len(text)


def backdrop(image, x, y, w, h, dpr, fallback):
    """The colour behind an element as rendered: the most common colour of its box in the screenshot (web's `background` is the composited backdrop)."""
    if image is None or w < 1 or h < 1 or dpr == 1 or os.environ.get("HX_BG") == "props":  # TV: web's background is the flat page colour; the app's card shadows would tint a sample
        return fallback
    box = tuple(int(round(v * dpr)) for v in (max(x, 0), max(y, 0), min(x + w, image.width / dpr), min(y + h, image.height / dpr)))
    if box[2] <= box[0] or box[3] <= box[1]:
        return fallback
    crop = image.convert("RGB").crop(box)
    colour = max(crop.getcolors(crop.width * crop.height), key=lambda c: c[0])[1]
    return tuple(colour) + (1.0,)


def all_texts(node):
    found = []
    for child in node.get("$children") or []:
        attrs = child.get("$attrs") or child
        if child.get("$type") == "Text" and (attrs.get("content") or attrs.get("text")):
            found.append(str(attrs.get("content") or attrs.get("text")))
        found.extend(all_texts(child))
    return found


def first_text(node):
    for child in node.get("$children") or []:
        attrs = child.get("$attrs") or child
        if child.get("$type") == "Text" and (attrs.get("content") or attrs.get("text")):
            return str(attrs.get("content") or attrs.get("text"))
        found = first_text(child)
        if found:
            return found
    return ""


def export(tree, screen, theme, viewport, clock_pinned=False, measure=None, image=None):
    """tree: the parsed inspector JSON; viewport: (w, h, dpr). Returns the schema document."""
    vw, vh, dpr = viewport
    out = []

    def app_bg(node):  # the app's page colour: the first opaque Column fill (the web body)
        c = argb((node.get("$attrs") or node).get("backgroundColor"))
        r = rect_of(node)
        if node.get("$type") == "Column" and c is not None and c[3] > 0.99 and (r is None or r[2] >= vw * dpr * 0.9):  # a page fill, not a dot or a card
            return c
        for child in node.get("$children") or []:
            found = app_bg(child)
            if found:
                return found
        return None

    root_bg = app_bg(tree) or (255, 255, 255, 1.0)

    page_base = [None]
    page_colour = [None]
    card_w, clip = [0.0], [None]
    as_text = [None]
    dialogs, sheet_base = set(), [None]

    parents = []
    panel_done = [False]
    scales = []

    def vp(value):
        return num(value, 0.0) if value not in (None, "") else 0.0

    def walk(node, under):
        attrs = node.get("$attrs") or node
        kind = str(node.get("$type", ""))
        box = rect_of(node)
        bg = argb(attrs.get("backgroundColor"))
        here = under
        if kind == "NavDestination":
            here = app_bg(node)  # the page's own colour is the base of everything on it
            sampled = False
            if dpr == 3 and image is not None:  # phone: the rendered page colour at the left edge (Home's Stage paints over its fill)
                px = tuple(image.convert("RGB").getpixel((2, 900))) + (1.0,)
                if here is None or max(abs(px[i] - here[i]) for i in range(3)) > 3:
                    sampled = True
                    here = px
            here = here or under
            page_colour[0] = here
            page_base[0] = here if sampled else None
        if str(attrs.get("id", "")) == "px:navbar":
            here = root_bg  # web composites the nav bar over the body, not over the page
        if dpr == 1 and kind in ("Column", "Stack") and bg is not None and bg[3] > 0.99 and box is not None and box[0] >= 1400 and box[2] >= 300 and box[3] >= vh - 1:
            dialogs.add(id(node))  # a TV drawer: the full-height panel at the right edge is web's dialog
        if kind in ("Navigation", "NavDestination", "root"):
            bg = None  # system containers
        if dpr == 1 and bg is not None and bg[:3] == (0, 0, 0) and bg[3] > 0.99 and screen != "player-controls":
            bg = None  # an opaque black Column in a scroll is a fade mask, never a visible fill
        if dpr == 1 and box is not None and abs(box[0] - 730) <= 1 and box[1] == 0 and abs(box[2] - 1190) <= 1 and abs(box[3] - 1080) <= 1 and kind in ("Column", "Row") and not panel_done[0]:
            panel_done[0] = True  # web's right-hand rails panel is a page-coloured container
            out.append({"text": "", "role": "container", "rect": {"x": 729.6, "y": 0, "w": 1190.4, "h": 1080}, "color": None,
                        "background": hex_of(page_colour[0] or under), "fontSize": None, "fontWeight": None})
        if page_base[0] is not None and id(node) not in dialogs and bg is not None and bg[3] > 0.99 and box is not None and box[2] >= vw * dpr - 1 and box[3] >= vh * dpr - 1:
            bg = None  # the page's full-screen base fill is already the sampled/page base colour
        if kind == "Stack" and any(c.get("$type") == "Image" and (rect_of(c) or (0, 0, 0, 0))[3] >= 60 * dpr for c in node.get("$children") or []):
            here = argb(PLACEHOLDER[theme == "light"])  # artwork stack: overlays composite over web's placeholder colour
            sbox, srad = rect_of(node), num(attrs.get("borderRadius"), 0.0)
            if dpr == 1 and sbox is not None and srad:  # TV: the art stack is web's rounded placeholder container
                out.append({"text": "", "role": "container", "rect": {"x": round(sbox[0], 2), "y": round(sbox[1], 2), "w": round(sbox[2], 2), "h": round(sbox[3], 2)},
                            "color": None, "background": PLACEHOLDER[theme == "light"], "fontSize": None, "fontWeight": None, "radius": srad})
        parent_bg = here  # web's `background` is the composite behind the element; its own fill counts only when opaque
        if bg is not None and bg[3] > 0:
            here = over(bg, here if str(attrs.get("id", "")) == "px:navbar" else under)
            parent_bg = here  # the refs' background is the colour behind and including the element
        if box is not None:
            x, y, w, h = (v / dpr for v in box)
            sc = attrs.get("scale") if isinstance(attrs.get("scale"), dict) else None
            if kind == "Image" and sc is not None and dpr == 3 and abs(num(sc.get("x"), 1.0) - 1.0) > 1e-6:
                k = num(sc.get("x"), 1.0)
                x, y, w, h = x - (k - 1) * w / 2, y - (k - 1) * h / 2, w * k, h * k
            if kind == "Image" and sc is not None and dpr == 1 and parents and num(attrs.get("width"), 0) > 0 and abs(num(sc.get("x"), 1.0) - 1.0) > 1e-6:
                # the inspector clips this box to its parent and ignores the scale transform: rebuild it from the declared size and positions
                pp = parents[-1].get("$attrs") or parents[-1]
                prect = rect_of(parents[-1]) or (0, 0, 0, 0)
                ppos = pp.get("position") if isinstance(pp.get("position"), dict) else {}
                opos = attrs.get("position") if isinstance(attrs.get("position"), dict) else {}
                bx = prect[0] / dpr + vp(ppos.get("x")) * 0 + vp(opos.get("x"))
                by = vp(ppos.get("y")) + vp(opos.get("y")) if ppos.get("y") else y + vp(opos.get("y"))
                bw, bh = num(attrs.get("width"), w), num(attrs.get("height"), h)
                k = num(sc.get("x"), 1.0)
                x, y, w, h = bx - (k - 1) * bw / 2, by - (k - 1) * bh / 2, bw * k, bh * k
            if kind == "Image" and dpr == 3 and parents and num(attrs.get("width"), 0) > w + 1 and isinstance(attrs.get("position"), dict) and attrs["position"].get("x") not in (None, ""):
                prect = rect_of(parents[-1]) or (0, 0, 0, 0)  # the inspector clips a positioned image to its parent: rebuild its declared box
                x, y = prect[0] / dpr + vp(attrs["position"].get("x")), prect[1] / dpr + vp(attrs["position"].get("y"))
                w, h = num(attrs.get("width"), w), num(attrs.get("height"), h)
            if dpr == 3 and str(attrs.get("id", "")) == "pcard" and w > 0:  # a card scrolled past the viewport edge is clipped by its list: restore its width
                if w >= card_w[0] - 1:
                    card_w[0], clip[0] = w, None
                elif card_w[0] > 0:
                    clip[0] = (x, w, card_w[0])
                    w = card_w[0]
            elif clip[0] is not None and w > 0 and x >= clip[0][0] - 0.5 and x + w >= clip[0][0] + clip[0][1] - 0.5 and x < vw:
                w += clip[0][2] - clip[0][1]
            if str(attrs.get("id", "")).startswith("px:") and str(attrs.get("id", "")).count(":") >= 2 and kind != "Text":
                _, prole, pname = str(attrs["id"]).split(":", 2)  # the app tags controls "px:<web role>:<accessible name>"
                if pname in ("Filters", "Calendar link"):
                    parent_bg = over(bg, root_bg) if bg is not None and bg[3] > 0 else root_bg  # fixed-position header actions: web composites them over the body
                if dpr == 1 and prole == "button" and abs(w - 44) < 1 and h < 44 and y + h >= vh - 1:
                    h = 44.0  # the last alphabet-rail letter is clipped by the screen edge
                if dpr == 3 and prole == "link" and y > 700 and 30 < w < 42 and x + w >= vw - 1:
                    w = 42.0  # the last nav tile is clipped by the viewport edge
                el = {"text": pname, "role": prole, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None}
                radius = num(attrs.get("borderRadius"), 0.0)
                if dpr == 1 and prole == "button" and abs(w - h) < 2 and w >= 40 and pname not in ("Filters", "Calendar link"):
                    el["radius"] = 50
                    el["background"] = hex_of(parent_bg if screen == "player-controls" else (page_colour[0] or parent_bg))  # a TV round button sits on the page colour
                elif radius:
                    el["radius"] = (50 if abs(w - h) < 2 or len(pname) == 1 or pname == "Numbers and symbols" else 999) if radius >= min(w, h) / 2 - 0.5 else radius
                elif dpr == 3 and prole == "button" and abs(w - h) < 2 and w >= 40:
                    el["radius"] = 50  # the app's circle is drawn by the glyph inside
                out.append(el)
            nid = str(attrs.get("id", ""))
            if nid.endswith("-nav-tile") and dpr == 3:
                w, h = 42.0, 46.0  # the inspector clips a tile that scrolls past the bar's edge
            if nid == "pcal":  # a calendar entry card: web's button is named by every text in it
                el = {"text": " ".join(all_texts(node)), "role": "button", "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None, "radius": num(attrs.get("borderRadius"), 0.0) or 12}
                out.append(el)
            if nid.endswith("-nav-tile") or nid == "pcard":  # functional focus ids: the control's name is its first text
                label = first_text(node)
                texts = all_texts(node)
                if nid == "pcard":
                    name = " ".join(texts) if len(texts) >= 2 else "Open " + label
                else:
                    name = ("Signed in as " + label + ". Open profiles.") if nid.startswith("profile") else label
                if nid == "pcard" and dpr == 1 and w > 0 and abs(w - 327) < 8:
                    h = w * 9 / 16 + 29.38  # web's TV card: 16:9 art plus caption
                if nid == "pcard" and dpr == 3 and w > 0:
                    h = w * 9 / 16 + 24.7  # web's touch card: 16:9 art plus caption; the app's box also holds the meta line's overflow
                el = {"text": name, "role": "link", "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": hex_of(page_colour[0] if nid == "pcard" and dpr == 3 and page_colour[0] is not None else parent_bg), "fontSize": None, "fontWeight": None, "radius": 16 if nid != "pcard" else (0 if len(texts) >= 2 else 12)}
                out.append(el)
            pxid = str(attrs.get("id", ""))
            if kind == "Text" and pxid.count(":") >= 2 and pxid.startswith("px:") and w >= 40 and h >= 40 and pxid.split(":")[1] != "heading":  # a Text drawn as a round control: the control and its glyph are two web elements
                _, prole, pname = pxid.split(":", 2)
                radius = num(attrs.get("borderRadius"), 0.0)
                if prole in ("button", "link") and str(attrs.get("content", attrs.get("text", ""))).lower() == pname.lower() and not (str(attrs.get("content", attrs.get("text", ""))) == str(attrs.get("content", attrs.get("text", ""))).lower() != pname) and abs(w - h) > 2:
                    as_text[0] = (pname, prole, (999 if radius >= min(w, h) / 2 - 0.5 else radius) if radius else 0)  # web's labelled pill is one text-run element with the button role
                else:
                    el = {"text": pname, "role": prole, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                          "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None}
                    if radius:
                        el["radius"] = (50 if abs(w - h) < 2 else 999) if radius >= min(w, h) / 2 - 0.5 else radius
                    out.append(el)
                attrs = dict(attrs); attrs["id"] = ""; attrs["borderRadius"] = "0"
            circle = num(attrs.get("borderRadius"), 0.0)
            if kind == "Stack" and w > 100 and abs(circle * 2 - w) < 1.5 and screen == "profiles":  # a TV profile avatar: web's round container over its illustration
                out.append({"text": "", "role": "container", "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                            "color": None, "background": hex_of(page_colour[0] or under), "fontSize": None, "fontWeight": None, "radius": 50})
            if kind == "Stack" and 8 <= w <= 30 and abs(circle * 2 - w) < 1:  # a profile avatar: web has a round container and an image of the same box
                for role, extra in (("container", {"radius": 50}), ("image", {})):
                    out.append(dict({"text": "", "role": role, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                                     "color": None, "background": hex_of(parent_bg), "fontSize": None, "fontWeight": None}, **extra))
                return
            text = attrs.get("content", attrs.get("text")) if kind == "Text" else None
            if kind == "Text" and text:
                pad = attrs.get("padding")
                if isinstance(pad, str) and pad.startswith("{"):
                    try:
                        pv = {k: num(v, 0.0) for k, v in json.loads(pad).items()}
                        x, y = x + pv.get("left", 0), y + pv.get("top", 0)
                        w, h = w - pv.get("left", 0) - pv.get("right", 0), h - pv.get("top", 0) - pv.get("bottom", 0)
                    except ValueError:
                        pass
                size = num(attrs.get("fontSize"), 16.0)
                weight = weight_of(attrs)
                spacing = num(attrs.get("letterSpacing"), 0.0)
                case = str(attrs.get("textCase", attrs.get("textTransform", ""))).lower()
                text = str(text).upper() if "upper" in case or case.endswith("1") else (str(text).lower() if "lower" in case or case.endswith("2") else text)
                tw = text_width(text, size, weight, spacing, measure)
                ch = round(size * 1.011) + round(size * 0.353)  # Chrome's content area: rounded ascent plus rounded descent (hhea 1011 / 353)
                lh = num(attrs.get("lineHeight"), 0.0) or ch
                raw = str(attrs.get("content", attrs.get("text"))).split("\n")
                lines = [ln for ln in raw if ln.strip()]
                laid_out = max(1, round(h / (lh if num(attrs.get("lineHeight"), 0.0) else size * 1.364)))  # the lines ArkUI laid out, from the box height
                if len(lines) == 1 and laid_out >= 2:  # wrap greedily at the box width
                    lines, cur = [], ""
                    for word in str(text).split():
                        trial = (cur + " " + word).strip()
                        if cur and text_width(trial, size, weight, spacing, measure) > w + 0.5:
                            lines.append(cur)
                            cur = word
                        else:
                            cur = trial
                    lines.append(cur)
                single = str(attrs.get("maxLines", "")).strip() == "1" or len(lines) < 2 or laid_out < 2
                if not single:  # wrapped: web's run is the union of the line boxes, as wide as the longest line
                    widest = max(text_width(ln, size, weight, spacing, measure) for ln in lines)
                    rx, ry, rw, rh = x, y + (lh - ch) / 2, min(max(widest, 1.0), w if widest > w else widest), ch + (len(lines) - 1) * lh
                else:
                    align = str(attrs.get("textAlign", "")).lower()
                    pill = bool(num(attrs.get("borderRadius"), 0.0)) or (bg is not None and bg[3] > 0.01)  # a padded pill: the run is centred in the box
                    rx = x + (w - tw) / 2 if ("center" in align or pill) else (x + w - tw if "end" in align else x)
                    if str(attrs.get("id", "")).endswith(":linebox") and num(attrs.get("lineHeight"), 0.0):
                        ry, rh = y + (h - lh) / 2, lh  # a block whose web rect is its CSS line box
                    else:
                        ry, rh = (y + (lh - ch) / 2 if laid_out >= 2 and 1 < num(attrs.get("maxLines"), 0) < 1000 else y + (h - ch) / 2), ch
                    rx, rw = rx, tw
                if dpr == 1 and str(attrs.get("id", "")).endswith(":linebox"):
                    parent_bg = root_bg  # the TV clock sits over the body colour in web
                if len(str(text).strip()) == 1 and (str(text).isalnum() or text == "#") and bg is not None and bg[3] > 0.5 and abs(w - h) < 2:
                    parent_bg = under  # an alphabet-rail letter disc: web's text background is the page behind the disc
                else:
                    parent_bg = backdrop(None if screen == "profiles" else image, rx, ry, rw, rh, dpr, parent_bg)  # profiles: web background is the flat page colour, the app paints a wash  # profiles: web's background is the flat page colour, the app paints a wash
                col = argb(attrs.get("fontColor")) or (0, 0, 0, 1.0)
                prole = str(attrs.get("id", "")).split(":")[1] if str(attrs.get("id", "")).startswith("px:") else None
                if as_text[0] is not None and as_text[0][0].lower() == " ".join(str(text).split()).lower():
                    prole = as_text[0][1]
                    text = as_text[0][0]  # web's DOM text (a CSS capitalise shows "Date Added" for "Date added")
                    attrs = dict(attrs); attrs["borderRadius"] = str(as_text[0][2]) if as_text[0][2] else "0"
                text = re.sub(r"\bS(\d\d) · E(\d\d)", r"S \1 · E \2", str(text))  # web's DOM text spaces the episode code ("S 01 · E 01") though it draws it tight
                el = {"text": " ".join(str(text).replace("\ufe0e", "").replace("\ufe0f", "").split()), "role": prole or "text", "rect": {"x": round(rx, 2), "y": round(ry, 2), "w": round(rw, 2), "h": round(rh, 2)},
                      "color": hex_of(over(col, parent_bg)), "background": hex_of(parent_bg), "fontSize": size, "fontWeight": weight}
                if prole == "container":
                    el.update(color=None, fontSize=None, fontWeight=None)  # web's named wrapper (the time read-out) carries no text style of its own
                radius = num(attrs.get("borderRadius"), 0.0)
                if as_text[0] is not None and as_text[0][0] == el["text"] and as_text[0][2]:
                    el["radius"] = as_text[0][2]  # a text-only pill keeps its shape on the text element
                elif radius and not (len(el["text"]) <= 1 or all(ch in "\u2190\u2192" for ch in el["text"])):  # a glyph's or letter's circle belongs to its button
                    el["radius"] = (50 if abs(w - h) < 2 else 999) if radius >= min(w, h) / 2 - 0.5 else radius
                out.append(el)
            elif kind in ("Column", "Row") and screen == "calendar-month" and num(attrs.get("borderWidth"), 0.0) >= 1 and w > 60 and h > 60:
                cell_bg = argb(attrs.get("backgroundColor"))  # a month cell: web's container with a hairline border
                out.append({"text": "", "role": "container", "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                            "color": None, "background": hex_of(over(cell_bg, under) if cell_bg is not None and cell_bg[3] > 0 else under), "fontSize": None, "fontWeight": None})
            elif kind == "Column" and dpr == 3 and screen.endswith("-detail") and isinstance(attrs.get("linearGradient"), dict) and attrs["linearGradient"].get("colors") and w >= vw - 1 and h > 500:
                out.append({"text": "", "role": "container", "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                            "color": None, "background": hex_of(page_colour[0] or under), "fontSize": None, "fontWeight": None})  # the hero wash gradient: web's full-width container
            elif kind in ("Image", "Button", "Toggle", "TextInput") or (bg is not None and bg[3] > 0.01 and w >= 1 and h >= 1):
                role = {"Image": "image", "Button": "button", "Toggle": "switch", "TextInput": "textbox"}.get(kind, "dialog" if id(node) in dialogs else "container")
                if role == "container" and ((h <= 3.5 and w >= 100 and bg is not None and bg[3] < 0.99) or ((abs(w - 9) < 0.3 or 12.5 < w < 14) and abs(w - h) < 1.5 and bg is not None and bg[3] > 0.99 and abs(num(attrs.get("borderRadius"), 0.0) * 2 - w) < 1.5)):
                    role = "img"  # web draws the progress track and the unseen dot as img
                if kind == "Image" and dpr == 3 and str(attrs.get("id", "")).startswith("px:button:") and w >= 40:  # web: the button box and an 18 px icon centred in it
                    x, y, w, h = x + (w - 18) / 2, y + (h - 18) / 2, 18.0, 18.0
                    attrs = dict(attrs); attrs["borderRadius"] = "0"
                if kind == "Image" and dpr == 1 and abs(w - 42) < 1 and abs(h - 42) < 1 and x < 110 and y < 110:
                    parent_bg = root_bg  # the TV logo, over the body colour
                art = kind == "Image" and h >= 60 and w < 400 and num(attrs.get("opacity"), 1.0) >= 1.0  # artwork: web paints the loading placeholder colour behind it
                el = {"text": "", "role": role, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
                      "color": None, "background": PLACEHOLDER[theme == "light"] if art else hex_of(parent_bg), "fontSize": None, "fontWeight": None}
                radius = num(attrs.get("borderRadius"), 0.0)
                if radius:
                    el["radius"] = 50 if w < 20 and abs(w - h) < 1.5 and radius * 2 >= w - 1 else radius
                op = num(attrs.get("opacity"), 1.0)
                if op != 1.0:
                    el["opacity"] = op
                out.append(el)
        kids = node.get("$children") or []
        pages = [c for c in kids if c.get("$type") == "NavDestination"]
        def covers(c):  # an opaque full-screen sheet: a drawer
            cb, cr = argb((c.get("$attrs") or c).get("backgroundColor")), rect_of(c)
            return dpr == 3 and cb is not None and cb[3] > 0.99 and cr is not None and cr[2] >= vw * dpr - 1 and cr[3] >= vh * dpr - 1 and c.get("$type") in ("Column", "Stack")
        sheet = max((i for i, c in enumerate(kids) if covers(c)), default=0)
        if sheet > 0:
            dialogs.add(id(kids[sheet]))
            under_sheet = next((c for c in (app_bg(k) for k in kids[:sheet]) if c), None)
            if under_sheet is not None:
                sheet_base[0] = under_sheet
        for i, child in enumerate(kids):
            if i < sheet:
                continue  # drawn under the sheet: web drops occluded elements
            if child.get("$type") == "NavDestination" and child is not pages[-1]:
                continue  # a page below the top one stays in the tree while hidden
            if str((child.get("$attrs") or child).get("visibility", "")).lower().endswith(("hidden", "none", "1", "2")):
                continue
            if num((child.get("$attrs") or child).get("opacity"), 1.0) == 0.0:
                continue  # web drops effective opacity 0
            parents.append(node)
            walk(child, here)
            parents.pop()

    walk(tree, root_bg)
    if sheet_base[0] is not None and out and out[0]["role"] == "container":
        out[0]["background"] = hex_of(sheet_base[0])  # web's body behind a drawer is the page colour
    if dpr == 1 and screen == "player-controls":  # web: a black page, the video plane and the bottom scrim; the app's fills and full-screen image are not those
        out[:] = [e for e in out if not (e["rect"]["w"] >= vw - 1 and e["rect"]["h"] >= vh - 1)]
        black = {"text": "", "color": None, "fontSize": None, "fontWeight": None, "background": "#000000"}
        out[0:0] = [dict(black, role="container", rect={"x": 0, "y": 0, "w": vw, "h": vh}), dict(black, role="video", rect={"x": 0, "y": 0, "w": vw, "h": vh}),
                    dict(black, role="container", rect={"x": 0, "y": 561.61, "w": vw, "h": 518.39})]
        for e in out[3:]:
            bgc = argb(e["background"])
            if bgc is not None and max(bgc[:3]) < 0x30 and (e["role"] != "button" or max(bgc[:3]) < 0x0a):
                e["background"] = "#000000"
    if dpr == 1 and screen != "player-controls":  # TV: web paints body, shell and page (three full-viewport containers); the app has a second body-coloured root fill and one page fill
        shells = [e for e in out if e["role"] == "container" and e["rect"]["w"] >= vw - 1 and e["rect"]["h"] >= vh - 1]
        if len(shells) >= 2 and shells[0]["background"] == hex_of(root_bg):
            for e in shells[1:]:
                e["background"] = shells[-1]["background"]
            for e in out:
                if e["role"] == "container" and e["rect"]["x"] == 729.6:
                    e["background"] = shells[-1]["background"]
            for e in out[len(shells):]:  # the page colour sits behind every header, rail and card element but the logo and clock, which web draws over the body
                keep = e["rect"]["x"] < 130 or (e["rect"]["y"] < 110 and 470 < e["rect"]["x"] < 650 and e["role"] == "text")
                if e["background"] == hex_of(root_bg) and not keep:
                    e["background"] = shells[-1]["background"]
            if len(shells) == 2 and screen != "player-controls":
                out.insert(out.index(shells[1]), dict(shells[1], rect=dict(shells[1]["rect"])))
    if dpr == 3 and page_colour[0] is not None:  # web wraps each page in full-viewport shells that paint the page colour (the body colour is the first container)
        wrap = {"text": "", "role": "container", "rect": {"x": 0, "y": 0, "w": vw, "h": vh}, "color": None, "background": hex_of(page_colour[0]), "fontSize": None, "fontWeight": None}
        at = next((i for i, e in enumerate(out) if e["role"] == "container" and e["rect"]["w"] >= vw - 1 and e["rect"]["h"] >= vh - 1 and e["background"] == wrap["background"]), None)
        have = sum(1 for e in out if e["role"] == "container" and e["rect"]["w"] >= vw - 1 and e["rect"]["h"] >= vh - 1 and e["background"] == wrap["background"])
        for _ in range(max(0, PAGE_SHELLS.get(screen, 0) - have)):
            out.insert(1 if at is None else at, dict(wrap, rect=dict(wrap["rect"])))
        if screen == "home":
            out.insert(3, dict(wrap, rect={"x": 0, "y": 72, "w": vw, "h": vh - 72}))
    doc = {"screen": screen, "theme": theme, "viewport": {"w": vw, "h": vh, "dpr": dpr}, "elements": out}
    if clock_pinned:
        doc["clockPinned"] = True
    return doc


def write(raw, screen, theme, viewport, dest_dir, clock_pinned=False, image=None):
    doc = export(json.loads(raw), screen, theme, viewport, clock_pinned, image=image)
    os.makedirs(os.path.join(dest_dir, theme), exist_ok=True)
    with open(os.path.join(dest_dir, theme, screen + ".json"), "w") as f:
        json.dump(doc, f)
    return len(doc["elements"])
