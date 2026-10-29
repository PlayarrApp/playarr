"""Maps the Previewer's inspector tree (UIContext.getFilteredInspectorTree) to the parity layout schema (docs/parity/LAYOUT.md).

Everything here comes from what the app drew: the inspector's boxes and fills, the app's own accessible names (accessibilityText) and roles (accessibilityRole, mirrored by the preview build) and
the glyph runs the live Text component's layout manager reports (`$runs`, written by patch_route.py's dumplayout). Nothing is derived from
the web references, no font file is read and no baseline is assumed: a Text without `$runs` fails the export."""
import json
import math
import re

_NUM = re.compile(r"-?\d+(?:\.\d+)?")
WEIGHT_NAMES = {"lighter": 300, "regular": 400, "normal": 400, "medium": 500, "bold": 700, "bolder": 800}
SYSTEM = ("Navigation", "NavDestination", "root")
CLIP_KINDS = ("Scroll", "List", "Grid", "WaterFlow", "Swiper")


# AccessibilityRoleType values (SDK API 18) the app declares, as the name the layout schema uses for them. The app mirrors each declared role
# into accessibilityTextHint in the preview build (patch_role.py), because the Previewer's inspector does not report accessibilityRole.
NATIVE_ROLES = {5: "button", 39: "link", 40: "img", 111: "textbox", 91: "search", 24: "dialog", 96: "slider", 120: "video", 108: "text", 124: None}
NO_OWN_PAINT_BLEND = (0, 4)  # BlendMode NONE and SRC_OVER draw normally; any other mode (DST_IN edge fades) only shapes what is under it


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


def gradient_stops(attrs):
    """Every colour stop of the node's gradient fill, as (r, g, b, a); empty when it has none."""
    out = []
    for key in ("linearGradient", "radialGradient", "sweepGradient"):
        g = attrs.get(key)
        if isinstance(g, dict):
            for stop in g.get("colors") or []:
                c = argb(stop[0] if isinstance(stop, (list, tuple)) else stop)
                if c is not None:
                    out.append(c)
    return out


def has_gradient(attrs):
    return bool(gradient_stops(attrs))


def linear_alpha(attrs, box):
    """The alpha of the node's linear gradient at (x, y) inside `box`, as a function; None when there is no linear gradient or it cannot be
    sampled from what the inspector reports (a `direction` keyword other than None, or a repeating gradient)."""
    g = attrs.get("linearGradient")
    if not isinstance(g, dict) or not g.get("colors"):
        return None
    if "None" not in str(g.get("direction", "None")) or str(g.get("repeating", "false")).lower() == "true":
        return None
    stops = sorted(((num(pos, 0.0), (argb(col) or (0, 0, 0, 0.0))[3]) for col, pos in g["colors"]), key=lambda t: t[0])
    ang = math.radians(num(g.get("angle"), 0.0) or 0.0)  # CSS convention: 0 points up, clockwise
    sx, sy = math.sin(ang), -math.cos(ang)
    x0, y0, x1, y1 = box
    length = abs((x1 - x0) * sx) + abs((y1 - y0) * sy)
    if length <= 0:
        return None

    def at(x, y):
        t = 0.5 + (((x - (x0 + x1) / 2) * sx) + ((y - (y0 + y1) / 2) * sy)) / length
        if t <= stops[0][0]:
            return stops[0][1]
        for (ta, aa), (tb, ab) in zip(stops, stops[1:]):
            if t <= tb:
                return aa if tb <= ta else aa + (ab - aa) * (t - ta) / (tb - ta)
        return stops[-1][1]
    return at


def declared_role(attrs):
    hint = str(attrs.get("accessibilityTextHint", ""))
    if not hint.startswith("pvrole:"):
        return None
    return NATIVE_ROLES.get(int(hint[7:]))


def export(tree, screen, theme, viewport, clock_pinned=False, with_src=False, origin=(0, 0), probe=None, candidates=None):
    """tree: the parsed inspector JSON with `$runs` on its Text nodes; viewport: (w, h, dpr). Returns the schema document.
    with_src adds each element's source line (the inspector's `$debugLine`) for analysis; published documents leave it out.
    probe: the capture's measurement of the rendered screen, {"results": {"<element index>": visible}}: an element the geometry says is covered
    is dropped only when hiding its node changed no pixel of its box. candidates, a list, receives what the geometry flags (index, node id, box in
    stage px, role) plus a "control" (a text that is certainly drawn) so the capture knows what to probe."""
    vw, vh, dpr = viewport
    out = []   # emitted elements, in paint order
    meta = []  # per element: [first, last] node sequence of the node it came from, then its clipped box, for the occlusion pass
    painters = []  # (first, last, clipped box in px) of every node that paints over what is behind it
    seq = [0]
    glyphs = []  # the glyph ranges (px box, alpha) of the Text being walked, which paint over what is under them
    limits = set()  # facts the inspector cannot give, written into the export
    src = [""]
    nid = [None]  # the inspector id of the node being walked: the capture hides it at run time to see whether it is drawn
    px = lambda v: v / dpr  # noqa: E731  (inspector px -> CSS px of the app viewport)

    def scale_k(chain):
        """The per-axis product (kx, ky) of the declared scales of a node and its ancestors. The inspector's `$rect` is the box after those transforms
        (a 64 px tile at scale 1.05 reports 67.2), so boxes are used as they are; the text layout manager and the framework's measured size know
        nothing of the transforms, so their unscaled boxes, and the font size and radius reported with them, are multiplied by this."""
        kx = ky = 1.0
        for ax, ay in chain:
            kx *= ax
            ky *= ay
        return kx, ky

    def scale_of(a):
        s = a.get("scale")
        if isinstance(s, dict):
            kx, ky = num(s.get("x"), 1.0), num(s.get("y"), 1.0)
            if kx is not None and ky is not None and (abs(kx - 1.0) > 1e-6 or abs(ky - 1.0) > 1e-6):
                return kx, ky
        return 1.0, 1.0

    def emit(role, text, box, background, clip, radius=0.0, colour=None, size=None, weight=None, opacity=1.0, painted=False):
        x, y, w, h = (px(v) for v in box)
        if w < 0.5 or h < 0.5:
            return
        el = {"text": shown(text), "role": role, "rect": {"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)},
              "color": colour, "background": hex_of(background), "fontSize": size, "fontWeight": weight}
        if not painted:  # a radius larger than half the box draws as half the box; a text record of a pill carries its painted box's radius
            radius = min(radius, w / 2, h / 2)
        if radius:
            el["radius"] = round(radius, 2)
        if opacity < 0.999:
            el["opacity"] = round(opacity, 3)
        if with_src:
            el["src"] = src[0]
        out.append(el)
        meta.append([seq[0], seq[0], clip_box(box, clip), nid[0]])

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
        kx, ky = scale_k(chain)
        ox, oy = raw[0], raw[1]  # the layout manager's coordinates are relative to the Text's own frame, padding included
        if num(a.get("fontSize")) is None or argb(a.get("fontColor")) is None or not (a.get("fontFamily") or a.get("fontWeight")):
            raise ExportError(f"Text {content[:30]!r} has no native style ({[n for n in ('fontSize', 'fontColor', 'fontFamily') if not a.get(n)]} missing)")
        weight, size = weight_of(a), num(a.get("fontSize"))
        col = argb(a.get("fontColor"))
        if col[3] * opacity <= 0.0:
            return  # fully transparent glyphs draw nothing
        colour = hex_of(over(col, under))
        if abs(kx - ky) > 1e-6:
            limits.add("a Text under a non-uniform scale: its font size is reported at the horizontal factor")
        truncated = "Ellipsis" in str(a.get("textOverflow", "")) and runs and runs[-1]["end"] < len(content.rstrip())
        for n, line in enumerate(runs):  # one element per laid-out line: its text, the glyph runs' horizontal extent and the line's own box
            boxes = line["tight"]
            line_text = " ".join(shown(content[line["start"]:line["end"]]).split())
            if not boxes or not line_text:
                continue
            l, r = min(b["l"] for b in boxes), max(b["r"] for b in boxes)
            t, bt = min(b["t"] for b in boxes), max(b["b"] for b in boxes)
            rect = (ox + l * kx, oy + t * ky, (r - l) * kx, (bt - t) * ky)  # exactly the layout manager's range rectangles for this line
            if visible(rect, clip):
                if truncated:  # the framework draws its ellipsis outside the glyph runs it reports: the app must shorten the string itself (design/components/FitLine.ets)
                    raise ExportError(f"Text {content[:30]!r} is truncated by the framework's ellipsis, which no native run reports")
                emit(role, line_text, rect, under, clip, radius, colour, round(size * kx, 2), weight, opacity, painted=radius > 0)
                if col[3] * opacity > 0.0:  # the glyph range paints over what is under it
                    glyphs.append((rect, col[3] * opacity))

    def walk(node, under, opacity, chain, clip, nohit=False):
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
        nid[0] = a.get("id") if str(a.get("id", "")).startswith("pvh") else None  # patch_hide.py's key: the probe hides by it
        src[0] = str(node.get("$debugLine", "")).split('"')[3].split("main/ets/")[-1] if with_src and '"' in str(node.get("$debugLine", "")) else ""
        raw = rect_of(node)
        kx, ky = scale_of(a)
        mychain = chain + [(kx, ky)] if (kx, ky) != (1.0, 1.0) else chain
        tkx, tky = scale_k(mychain)  # the node's own and its ancestors' scale: the framework's measured size is before it
        win = (num(tree.get("width"), 0.0), num(tree.get("height"), 0.0))
        if raw is not None and kind == "Text":
            for axis in (0, 1):
                if win[axis] > 0 and (raw[axis] + raw[axis + 2] >= win[axis] - 0.5 or raw[axis] <= -0.5):
                    limits.add("a Text box reaching the window edge cannot be recovered: only its measured glyph ranges are used")
        if raw is not None and kind != "Text":
            # the inspector clamps a box at the window edge: where it does, the framework's measured size of the component stands in
            frame = node.get("$frame")
            for axis in (0, 1):
                if win[axis] > 0 and raw[axis] > 0.5 and raw[axis] + raw[axis + 2] >= win[axis] - 0.5:
                    got = frame.get("w" if axis == 0 else "h") if frame else None
                    if got is None or got * (tkx if axis == 0 else tky) < raw[axis + 2] - 0.5:
                        raise ExportError(f"{kind} at {raw} is clamped by the window edge and has no native measured size ({node.get('$frameError', 'no $frame')})")
                    box = list(raw)
                    box[axis + 2] = got * (tkx if axis == 0 else tky)  # the measured size is unscaled; the box is the transformed one
                    raw = tuple(box)
            for axis in (0, 1):  # a box cut at the leading edge has lost its origin, which the measured size cannot restore
                got = frame.get("w" if axis == 0 else "h") if frame else None
                if raw[axis] <= 0.5 and got is not None and got * (tkx if axis == 0 else tky) > raw[axis + 2] + 0.5 and kind not in SYSTEM:
                    limits.add("a box cut at the window's leading edge cannot be recovered: its origin is lost")
        if raw is not None and origin != (0, 0):  # the stage sits at `origin` px in a larger window: report in the stage's own coordinates
            raw = (raw[0] - origin[0], raw[1] - origin[1], raw[2], raw[3])
        fill = argb(a.get("backgroundColor"))
        here = under
        if kind in SYSTEM:
            fill = None
        if num(a.get("blendMode"), 0) not in NO_OWN_PAINT_BLEND:
            return  # a blend layer: it only shapes what is drawn under it
        role = declared_role(a)
        name = str(a.get("accessibilityText") or "").strip()
        box = raw
        if box is not None and (box[2] < 0.5 or box[3] < 0.5) and kind != "Text":
            box = None
        if box is not None and fill is not None and fill[3] > 0.001:
            here = over(fill, under)
        mark = len(out)
        glyphs[:] = []
        inview = box is not None and visible(box, clip)
        fills = fill is not None and fill[3] > 0.01
        radius = radius_of(a) * tkx
        if kind == "Text" and raw is not None:
            # a Text the app declares a role for is that control: with its own fill or border it is a box (the control) holding glyph runs
            # (the text); without one the runs are the control's only drawn part and carry the role. The measured glyph ranges decide their own
            # visibility: a frame beyond the viewport does not hide a range inside it.
            control = role not in (None, "text")
            painted = fills or (num(a.get("borderWidth"), 0.0) or 0.0) >= 1.0 and argb(a.get("borderColor"))[3] > 0.01
            if inview and control:  # the control's own border box and accessible name, then its glyph runs as a separate text record
                emit(role, name or str(a.get("content") or a.get("text") or "").strip(), box, here, clip, radius, opacity=opacity)
            if inview and painted and not control:  # a Text that paints its own pill: its painted box (with the native radius) stands as a container
                emit("container", "", box, here, clip, radius, opacity=opacity)
            text_lines(node, a, raw, here, opacity, mychain, clip, "text", radius if painted and not control else 0.0)
        elif inview:
            if kind == "Divider":  # a drawn rule: its stroke colour, over what is under it
                stroke = argb(a.get("color"))
                if stroke is not None and stroke[3] * opacity > 0.0:
                    emit("container", "", box, over((stroke[0], stroke[1], stroke[2], stroke[3] * opacity), under), clip, 0.0)
            elif role not in (None, "text"):
                emit("image" if kind == "Image" and role == "img" else role, name, box, here, clip, radius, opacity=opacity)
            elif kind in ("Image", "Button", "Toggle", "TextInput", "LoadingProgress", "XComponent"):
                # intrinsic painted components: a spinner is drawn by the framework, a surface XComponent is the video's place
                emit({"Image": "image", "Button": "button", "Toggle": "switch", "TextInput": "textbox", "LoadingProgress": "image", "XComponent": "video"}[kind],
                     name, box, here, clip, radius, opacity=opacity)
            elif fills or has_gradient(a) or (num(a.get("borderWidth"), 0.0) or 0.0) >= 1.0 and argb(a.get("borderColor"))[3] > 0.01:
                emit("container", "", box, here, clip, radius, opacity=opacity)
        own = list(range(mark, len(out)))
        kids = node.get("$children") or []
        pages = [c for c in kids if c.get("$type") == "NavDestination"]
        nclip = clip
        if raw is not None and (kind in CLIP_KINDS or str(a.get("clip", "")).lower() == "true"):
            nclip = (max(clip[0], raw[0]), max(clip[1], raw[1]), min(clip[2], raw[0] + raw[2]), min(clip[3], raw[1] + raw[3]))
        # HitTestMode.None: the component and everything under it is invisible to the hit test the occlusion model stands for
        nohit = nohit or str(a.get("hitTestBehavior", "")).endswith("None")
        painter = None
        if box is not None and not nohit and visible(box, clip) and kind != "Text":
            lin = linear_alpha(a, (box[0], box[1], box[0] + box[2], box[1] + box[3]))  # a gradient's coordinates belong to the painted box, not to the part the clip leaves
            if has_gradient(a) and lin is None and not (fill is not None and fill[3] >= 0.5):
                # radial and sweep gradients (and linear ones the inspector cannot sample) are not modelled: they never occlude
                limits.add("gradients other than a plain linear one do not occlude")
            fa = (fill[3] if fill is not None else 0.0) * opacity
            solid = opacity if kind in ("Image", "XComponent") else 0.0  # an image covers with its opacity (its own transparent pixels are not known)
            if solid > 0.0 or fa > 0.0 or lin is not None:
                def alpha(x, y, fa=fa, lin=lin, solid=solid, op=opacity):
                    return 1 - (1 - solid) * (1 - fa) * (1 - (lin(x, y) * op if lin else 0.0))
                painter = [first, first, clip_box(box, clip), src[0], alpha, box, min(radius_of(a) * tkx * dpr, box[2] / 2, box[3] / 2)]  # painter boxes are physical px, the radius is vp
                painters.append(painter)
        if kind == "Text" and not nohit:
            if fills and box is not None and visible(box, clip):  # a Text paints its fill and its glyph ranges, nothing else
                painter = [first, first, clip_box(box, clip), src[0], lambda x, y, fa=fill[3] * opacity: fa, box, min(radius * dpr, box[2] / 2, box[3] / 2)]
                painters.append(painter)
            for rect, al in glyphs:
                painters.append([first, first, clip_box(rect, clip), src[0], lambda x, y, al=al: al, rect, 0.0])
        # children paint in zIndex order (stable), so traversal order is paint order
        for c in sorted(kids, key=lambda c: num(attrs_of(c).get("zIndex"), 0.0) or 0.0):
            if c.get("$type") == "NavDestination" and c is not pages[-1]:
                continue  # a page below the top one stays in the tree while hidden
            walk(c, here, opacity, list(mychain), nclip, nohit)
        for i in own:
            meta[i][0], meta[i][1] = first, seq[0]
        if painter is not None:
            painter[1] = seq[0]

    walk(tree, (255, 255, 255, 1.0), 1.0, [], (0, 0, vw * dpr, vh * dpr))  # chain: (kx, ky) outermost first; clip: the app viewport in px

    def inside(p, x, y):
        """(x, y) lies in the painter's clipped box and in its rounded shape."""
        if not (p[2][0] <= x <= p[2][2] and p[2][1] <= y <= p[2][3]):
            return False
        r = p[6]
        if r <= 0:
            return True
        bx0, by0, bw, bh = p[5]
        cx = min(max(x, bx0 + r), bx0 + bw - r)
        cy = min(max(y, by0 + r), by0 + bh - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    def covered(box, first, last, by):
        """True when, at every point of a 3 x 3 grid over the box, what is painted after the element's own subtree adds up to alpha 0.5 or more."""
        x0, y0, x1, y1 = box
        if x1 <= x0 or y1 <= y0:
            return False
        for fx in (0.2, 0.5, 0.8):
            for fy in (0.2, 0.5, 0.8):
                x, y = x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy
                hits = [p for p in painters if p[0] > last and inside(p, x, y)]
                rest = 1.0
                for p in hits:
                    rest *= 1 - p[4](x, y)
                if 1 - rest < 0.5:
                    return False
                by.extend(p[3] for p in hits)
        return True

    kept, dropped = [], []
    measured = (probe or {}).get("results") or {}
    control = None
    unmeasured = 0
    for i, (el, (first, last, box, node_id)) in enumerate(zip(out, meta)):
        by = []
        if covered(box, first, last, by):  # the geometry only picks what to test
            seen = measured.get(str(i))
            if candidates is not None and node_id is not None:
                candidates.append({"index": i, "id": node_id, "box": [round(v * dpr) for v in (el["rect"]["x"], el["rect"]["y"], el["rect"]["x"] + el["rect"]["w"], el["rect"]["y"] + el["rect"]["h"])]})
            if seen is False:  # hiding it changed no pixel of its box: nothing of it is drawn
                dropped.append({"text": el["text"], "role": el["role"], "by": sorted(set(by))})
                continue
            if seen is None:
                unmeasured += 1  # no measurement, no decision: it stays
        elif candidates is not None and node_id is not None and el["role"] == "text":
            area = el["rect"]["w"] * el["rect"]["h"]
            if control is None or area > control[0]:
                control = (area, {"index": i, "id": node_id, "box": [round(v * dpr) for v in (el["rect"]["x"], el["rect"]["y"], el["rect"]["x"] + el["rect"]["w"], el["rect"]["y"] + el["rect"]["h"])]})
        kept.append(el)
    if candidates is not None and control is not None:
        candidates.append(dict(control[1], control=True))
    doc = {"screen": screen, "theme": theme, "viewport": {"w": vw, "h": vh, "dpr": dpr}, "occluded": len(dropped), "unmeasured": unmeasured, "elements": kept}
    limits.add("occlusion is measured on the rendered screen: an element the geometry flags as covered is dropped only if hiding it in the running app changed no pixel of its box (exact diff of two screenshots, noise between two unchanged shots ignored)")
    if unmeasured:
        limits.add("a flagged element the probe could not measure (no key, hide refused, unstable screen) is exported, never dropped on geometry")
    limits |= {"the Previewer's XComponent placeholder text ('Preview not available for this component.') has no glyph runs, so it is not exported as text"}
    doc["limits"] = sorted(limits)
    if with_src:
        doc["droppedBy"] = dropped
    if clock_pinned:
        doc["clockPinned"] = True
    return doc


def write(raw, screen, theme, viewport, dest_dir, clock_pinned=False, origin=(0, 0), probe=None):
    import os
    doc = export(json.loads(raw), screen, theme, viewport, clock_pinned, origin=origin, probe=probe)
    os.makedirs(os.path.join(dest_dir, theme), exist_ok=True)
    with open(os.path.join(dest_dir, theme, screen + ".json"), "w") as f:
        json.dump(doc, f)
    return len(doc["elements"])
