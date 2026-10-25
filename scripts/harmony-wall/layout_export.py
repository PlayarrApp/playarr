"""Maps the Previewer's inspector tree (UIContext.getFilteredInspectorTree) to the parity layout schema (docs/parity/LAYOUT.md).

Everything here comes from what the app drew: the inspector's boxes and fills, the app's own accessible names (`px:<role>:<name>` ids) and
the glyph runs the live Text component's layout manager reports (`$runs`, written by patch_route.py's dumplayout). Nothing is derived from
the web references, no font file is read and no baseline is assumed: a Text without `$runs` fails the export."""
import json
import re

_NUM = re.compile(r"-?\d+(?:\.\d+)?")
WEIGHT_NAMES = {"lighter": 300, "regular": 400, "normal": 400, "medium": 500, "bold": 700, "bolder": 800}
SYSTEM = ("Navigation", "NavDestination", "root")
CLIP_KINDS = ("Scroll", "List", "Grid", "WaterFlow", "Swiper")


class ExportError(Exception):
    pass


def shown(text):
    """The text as displayed: variation selectors only choose a glyph style, they are not drawn."""
    return str(text).replace("\ufe0e", "").replace("\ufe0f", "")


def num(value, default=None):
    m = _NUM.search(str(value)) if value is not None else None
    return float(m.group()) if m else default


def rect_of(node):
    v = [float(x) for x in _NUM.findall(str(node.get("$rect", "")))]
    return (v[0], v[1], v[2], v[3]) if len(v) == 4 else None  # px: x, y, width, height


def argb(value):
    """'#AARRGGBB' or '#RRGGBB' -> (r, g, b, a)."""
    h = str(value or "").lstrip("#")
    if len(h) == 8:
        return tuple(int(h[i:i + 2], 16) for i in (2, 4, 6)) + (int(h[0:2], 16) / 255,)
    if len(h) == 6:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    return None


def hex_of(c):
    return "#%02x%02x%02x" % tuple(round(v) for v in c[:3]) + ("%02x" % round(c[3] * 255) if c[3] < 0.999 else "")


def over(top, below):
    a = top[3]
    return tuple(round(top[i] * a + below[i] * (1 - a)) for i in range(3)) + (1.0,)


def attrs_of(node):
    return node.get("$attrs") or node


def weight_of(attrs):
    fam = str(attrs.get("fontFamily", ""))
    m = re.search(r"NunitoSansW(\d+)", fam)
    if m:
        return int(m.group(1))
    if "PlayarrArrowsRegular" in fam:
        return 400
    if "PlayarrArrows" in fam:
        return 720
    raw = str(attrs.get("fontWeight", "")).split(".")[-1].lower()
    return WEIGHT_NAMES.get(raw) or int(num(raw, 400))


def radius_of(attrs):
    r = attrs.get("borderRadius")
    if isinstance(r, dict):
        r = r.get("topLeft")
    return num(r, 0.0) or 0.0


def padding_of(attrs, dpr):
    """(left, top, right, bottom) of a node's padding in inspector px."""
    raw = attrs.get("padding")
    if isinstance(raw, str) and raw.startswith("{"):
        try:
            p = json.loads(raw)
        except ValueError:
            return (0.0, 0.0, 0.0, 0.0)
        return tuple((num(p.get(k), 0.0) or 0.0) * dpr for k in ("left", "top", "right", "bottom"))
    v = (num(raw, 0.0) or 0.0) * dpr
    return (v, v, v, v)


def has_gradient(attrs):
    for key in ("linearGradient", "radialGradient", "sweepGradient"):
        g = attrs.get(key)
        if isinstance(g, dict) and g.get("colors"):
            return True
    return False


def all_texts(node):
    found = []
    for child in node.get("$children") or []:
        a = attrs_of(child)
        if child.get("$type") == "Text" and (a.get("content") or a.get("text")):
            found.append(str(a.get("content") or a.get("text")))
        found.extend(all_texts(child))
    return found


def export(tree, screen, theme, viewport, clock_pinned=False, with_src=False):
    """tree: the parsed inspector JSON with `$runs` on its Text nodes; viewport: (w, h, dpr). Returns the schema document.
    with_src adds each element's source line (the inspector's `$debugLine`) for analysis; published documents leave it out."""
    vw, vh, dpr = viewport
    out = []   # emitted elements, in paint order
    meta = []  # per element: [first, last] node sequence of the node it came from, then its clipped box, for the occlusion pass
    painters = []  # (first, last, clipped box in px) of every node that paints over what is behind it
    seq = [0]
    src = [""]
    px = lambda v: v / dpr  # noqa: E731  (inspector px -> CSS px of the app viewport)

    def scale_k(chain):
        """The product of the declared scales of a node and its ancestors. The inspector's `$rect` is the box after those transforms
        (a 64 px tile at scale 1.05 reports 67.2), so boxes are used as they are; the text layout manager knows nothing of the
        transforms, so its unscaled boxes, and the font size and radius reported with them, are multiplied by this."""
        k = 1.0
        for _, _, kk in chain:
            k *= kk
        return k

    def scale_of(a):
        s = a.get("scale")
        if isinstance(s, dict):
            k = num(s.get("x"), 1.0)
            if k is not None and abs(k - 1.0) > 1e-6:
                return k
        return 1.0

    def emit(role, text, box, background, clip, radius=0.0, colour=None, size=None, weight=None, opacity=1.0):
        x, y, w, h = (px(v) for v in box)
        if w < 0.5 or h < 0.5:
            return
        el = {"text": shown(text), "role": role, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
              "color": colour, "background": hex_of(background), "fontSize": size, "fontWeight": weight}
        if radius:
            el["radius"] = round(radius, 2)
        if opacity < 0.999:
            el["opacity"] = round(opacity, 3)
        if with_src:
            el["src"] = src[0]
        out.append(el)
        meta.append([seq[0], seq[0], clip_box(box, clip)])

    def clip_box(box, clip):
        x, y, w, h = box
        return (max(x, clip[0]), max(y, clip[1]), min(x + w, clip[2]), min(y + h, clip[3]))

    def visible(box, clip):
        x, y, w, h = box
        cx0, cy0, cx1, cy1 = clip
        return x < cx1 and y < cy1 and x + w > cx0 and y + h > cy0

    def text_lines(node, a, raw, under, opacity, chain, clip, role, radius):
        runs = node.get("$runs")
        content = str(a.get("content") if a.get("content") is not None else a.get("text") or "")
        if not content.strip():
            return
        if runs is None:
            raise ExportError(f"Text {content[:30]!r} has no native glyph runs ({node.get('$runsError', 'no $runs')})")
        case = str(a.get("textCase", ""))
        content = content.upper() if "Upper" in case else content.lower() if "Lower" in case else content
        k = scale_k(chain)
        pl, pt, _, _ = (v * k for v in padding_of(a, dpr))  # the layout manager's boxes start at the Text's content box
        ox, oy = raw[0] + pl, raw[1] + pt
        weight, size = weight_of(a), num(a.get("fontSize"), 16.0)
        col = argb(a.get("fontColor")) or (0, 0, 0, 1.0)
        colour = hex_of(over(col, under))
        for line in runs:  # one element per laid-out line: its text, the glyph runs' horizontal extent and the line's own box
            boxes = line["tight"]
            line_text = " ".join(shown(content[line["start"]:line["end"]]).split())
            if not boxes or not line_text:
                continue
            l, r = min(b["l"] for b in boxes), max(b["r"] for b in boxes)
            rect = (ox + l * k, oy + line["top"] * k, (r - l) * k, (line["ascent"] + line["descent"]) * k)  # the line box: ascent above the baseline, descent below
            if visible(rect, clip):
                emit(role, line_text, rect, under, clip, radius, colour, round(size * k, 2), weight, opacity)

    def walk(node, under, opacity, chain, clip):
        a = attrs_of(node)
        kind = str(node.get("$type", ""))
        if str(a.get("visibility", "")).lower().endswith(("hidden", "none")):
            return
        op = num(a.get("opacity"), 1.0)
        opacity *= 1.0 if op is None else op
        if opacity <= 0.0:
            return
        seq[0] += 1
        first = seq[0]
        src[0] = str(node.get("$debugLine", "")).split('"')[3].split("main/ets/")[-1] if with_src and '"' in str(node.get("$debugLine", "")) else ""
        raw = rect_of(node)
        fill = argb(a.get("backgroundColor"))
        here = under
        if kind in SYSTEM:
            fill = None
        k = scale_of(a)
        mychain = chain
        if raw is not None and k != 1.0:
            mychain = chain + [((raw[0] + raw[2] / 2), (raw[1] + raw[3] / 2), k)]
        nid = str(a.get("id", ""))
        pxid = nid.split(":", 2) if nid.startswith("px:") and nid.count(":") >= 2 else None
        if pxid is not None and pxid[1] == "mask":
            return  # a blend layer that only shapes what is drawn under it (DST_IN edge fades): it draws nothing itself
        box = raw
        if box is not None and (box[2] < 0.5 or box[3] < 0.5) and kind != "Text":
            box = None
        if box is not None and fill is not None and fill[3] > 0.001:
            here = over(fill, under)
        mark = len(out)
        if box is not None and visible(box, clip):
            fills = fill is not None and fill[3] > 0.01
            radius = radius_of(a) * scale_k(mychain)
            if kind == "Text":
                # a Text that carries an app role is that control itself (it draws its own fill): its lines take the role
                text_lines(node, a, raw, here, opacity, mychain, clip, pxid[1] if pxid is not None else "text", radius if pxid is not None else 0.0)
            elif pxid is not None:
                emit(pxid[1], pxid[2], box, here, clip, radius, opacity=opacity)
            elif nid == "pcard":
                emit("link", str(a.get("accessibilityText") or "").strip(), box, here, clip, radius, opacity=opacity)  # the card's own accessible name
            elif nid.endswith("-nav-tile"):
                texts = all_texts(node)
                emit("link", texts[0] if texts else "", box, here, clip, radius, opacity=opacity)
            elif kind in ("Image", "Button", "Toggle", "TextInput"):
                role = {"Image": "image", "Button": "button", "Toggle": "switch", "TextInput": "textbox"}[kind]
                emit(role, "", box, here, clip, radius, opacity=opacity)
            elif fills or has_gradient(a) or (num(a.get("borderWidth"), 0.0) or 0.0) >= 1.0 and argb(a.get("borderColor"))[3] > 0.01:
                emit("container", "", box, here, clip, radius, opacity=opacity)
        own = list(range(mark, len(out)))
        kids = node.get("$children") or []
        pages = [c for c in kids if c.get("$type") == "NavDestination"]
        nclip = clip
        if raw is not None and (kind in CLIP_KINDS or str(a.get("clip", "")).lower() == "true"):
            nclip = (max(clip[0], raw[0]), max(clip[1], raw[1]), min(clip[2], raw[0] + raw[2]), min(clip[3], raw[1] + raw[3]))
        paints = fill is not None and fill[3] >= 0.5 and opacity >= 0.5 or kind == "Image" or has_gradient(a)
        if box is not None and paints and kind != "Text" and visible(box, clip):
            painters.append([first, first, clip_box(box, clip), src[0]])
        for c in kids:
            if c.get("$type") == "NavDestination" and c is not pages[-1]:
                continue  # a page below the top one stays in the tree while hidden
            walk(c, here, opacity, list(mychain), nclip)
        for i in own:
            meta[i][0], meta[i][1] = first, seq[0]
        if painters and painters[-1][0] == first and box is not None and kind != "Text":
            painters[-1][1] = seq[0]

    walk(tree, (255, 255, 255, 1.0), 1.0, [], (0, 0, vw * dpr, vh * dpr))  # chain: (cx, cy, k) outermost first; clip: the app viewport in px

    def covered(box, first, last, by):
        """True when every point of a 3 x 3 grid over the box lies inside something painted after the element's own subtree."""
        x0, y0, x1, y1 = box
        if x1 <= x0 or y1 <= y0:
            return False
        for fx in (0.2, 0.5, 0.8):
            for fy in (0.2, 0.5, 0.8):
                x, y = x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy
                hit = next((p for p in painters if p[0] > last and p[2][0] <= x <= p[2][2] and p[2][1] <= y <= p[2][3]), None)
                if hit is None:
                    return False
                by.append(hit[3])
        return True

    kept, dropped = [], []
    for el, (first, last, box) in zip(out, meta):
        by = []
        if covered(box, first, last, by):
            dropped.append({"text": el["text"], "role": el["role"], "by": sorted(set(by))})
        else:
            kept.append(el)
    doc = {"screen": screen, "theme": theme, "viewport": {"w": vw, "h": vh, "dpr": dpr}, "occluded": len(dropped), "elements": kept}
    if with_src:
        doc["droppedBy"] = dropped
    if clock_pinned:
        doc["clockPinned"] = True
    return doc


def write(raw, screen, theme, viewport, dest_dir, clock_pinned=False):
    import os
    doc = export(json.loads(raw), screen, theme, viewport, clock_pinned)
    os.makedirs(os.path.join(dest_dir, theme), exist_ok=True)
    with open(os.path.join(dest_dir, theme, screen + ".json"), "w") as f:
        json.dump(doc, f)
    return len(doc["elements"])
