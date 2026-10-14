#!/usr/bin/env python3
"""Regenerates the Roku channel's theme-tintable UI masks.

Every image written here is a WHITE mask (alpha carries the shape) so the channel can tint it with a theme token through
`blendColor` (see source/Theme.brs). Needs Pillow and rsvg-convert (librsvg). Run from clients/roku:
    python3 scripts/make_assets.py
Nav icons are drawn from the web's NavIcons.tsx paths (24 box, stroke 1.8, round caps) at their web size of 20 px.
"""
from __future__ import annotations

import math
import re
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

IMAGES = Path(__file__).resolve().parents[1] / "images"
SS = 8  # supersampling

ICONS = {
    "nav-search": '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
    "nav-home": '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-6h4v6"/>',
    "nav-series": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/><path d="m10 1 2 3 2-3"/>',
    "nav-movies": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 5 2-3M13 5l2-3M19 5l2-3"/>'
    '<path d="m10 10 5 2.5-5 2.5z" fill="white" stroke="none"/>',
    "nav-sites": '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"/>',
    "nav-music": '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M9 10l10-2"/>',
    "nav-playlists": '<path d="M5 6h10M5 10h10M5 14h6"/><path d="M17 13.5v6"/><path d="m17 13.5 4-1.5v5.5"/><circle cx="15.5" cy="19.5" r="1.5"/><circle cx="19.5" cy="17.5" r="1.5"/>',
    "nav-watchlist": '<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z"/><path d="M12 7.5v5M9.5 10h5"/>',
    "nav-calendar": '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    "player-play": '<path d="M7 4.5v15l13-7.5z" fill="white" stroke="none"/>',
    "player-pause": '<rect x="6" y="4.5" width="4.5" height="15" rx="1" fill="white" stroke="none"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1" fill="white" stroke="none"/>',
    "player-prev": '<rect x="4.5" y="5" width="2.4" height="14" rx="1" fill="white" stroke="none"/><path d="M19.5 5.5v13L8.2 12z" fill="white" stroke="none"/>',
    "player-next": '<rect x="17.1" y="5" width="2.4" height="14" rx="1" fill="white" stroke="none"/><path d="M4.5 5.5v13L15.8 12z" fill="white" stroke="none"/>',
    "player-subtitles": '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M6.5 12h4M13.5 12h4M6.5 15.5h7M15.5 15.5h2"/>',
    "player-playlist": '<path d="M4 6.5h10M4 11.5h10M4 16.5h7"/><path d="m16 14 4 2.5-4 2.5z" fill="white" stroke="none"/>',
    "player-health": '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.9" fill="white" stroke="none"/>',
    "player-audio": '<path d="M5 9.5v5h4l4.5 3.5V6L9 9.5z" fill="white" stroke="none"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/>',
    "player-close": '<path d="M6 6l12 12M18 6 6 18"/>',
    "tile-filters": '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    "tile-bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
    "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "check": '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    "icon-empty": '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M6.5 10h8M6.5 13h6M6.5 16h3"/><circle cx="17" cy="8.5" r="1"/>',
}


def icon(name: str, size: int, stroke: float = 1.8) -> None:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{size}" height="{size}" fill="none" '
        f'stroke="white" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</svg>'
    )
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "i.svg"
        src.write_text(svg)
        subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(IMAGES / f"{name}.png"), str(src)], check=True)


def rounded(w: int, h: int, r: float, alpha: int = 255, outline: float = 0) -> Image.Image:
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    d.rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=r * SS, fill=255)
    if outline:
        inner = Image.new("L", big.size, 0)
        di = ImageDraw.Draw(inner)
        o = outline * SS
        di.rounded_rectangle([o, o, w * SS - 1 - o, h * SS - 1 - o], radius=max(r - outline, 0) * SS, fill=255)
        big = Image.composite(Image.new("L", big.size, 0), big, inner)
    mask = big.resize((w, h), Image.LANCZOS).point(lambda v: v * alpha // 255)
    out = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    out.putalpha(mask)
    return out


def nine_patch(name: str, r: int, outline: float = 0) -> None:
    """White rounded-rectangle 9-patch: corners are fixed, the single centre row and column stretch."""
    inner = 2 * r + 1
    body = rounded(inner, inner, r, 255, outline)
    img = Image.new("RGBA", (inner + 2, inner + 2), (0, 0, 0, 0))
    img.paste(body, (1, 1))
    px = img.load()
    px[r + 1, 0] = (0, 0, 0, 255)  # stretch marker, top
    px[0, r + 1] = (0, 0, 0, 255)  # stretch marker, left
    img.save(IMAGES / f"{name}.9.png")


def card_glow() -> None:
    """Web --card-glow: a 20 px blur at 45% around the 4 px spread of a 220 x 124 card art, in a 400 x 304 bitmap (white mask)."""
    from PIL import ImageFilter
    w, h = 400, 304
    big = Image.new("L", (w * SS, h * SS), 0)
    x0, y0, x1, y1 = (v * SS for v in (90, 90, 310, 214))
    sp = 4 * SS
    ImageDraw.Draw(big).rounded_rectangle([x0 - sp, y0 - sp, x1 + sp, y1 + sp], radius=18 * SS, fill=255)
    glow = big.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.45))
    out = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    out.putalpha(glow)
    out.save(IMAGES / "card-glow.png")


def group(n: int) -> None:
    # Web dock group: 77.5 wide, 73.6 per item plus 5.8 padding; fill is --surface at .56 (token tint, alpha baked).
    h = round(73.6 * n + 5.8)
    rounded(78, h, 22, 143).save(IMAGES / f"nav-group-{n}.png")


SHARED_AVATARS = Path(__file__).resolve().parents[2] / "shared" / "profile-avatars"
AVATAR_PRESETS = ("astronaut", "cat", "dinosaur", "robot", "pirate", "alien")


def avatars() -> None:
    """The six preset avatars are the shared plates (clients/shared/profile-avatars, rendered from the web client's art), and
    avatar-mask.png is the circle a custom photo is clipped to (a MaskGroup mask: only its alpha counts)."""
    for preset in AVATAR_PRESETS:
        shutil.copyfile(SHARED_AVATARS / "plates" / f"{preset}.png", IMAGES / f"avatar-{preset}.png")
    size = 240
    big = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(big).ellipse((0, 0, size * SS - 1, size * SS - 1), fill=255)
    alpha = big.resize((size, size), Image.LANCZOS)
    mask = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    mask.putalpha(alpha)
    mask.save(IMAGES / "avatar-mask.png")


def profile_focus_ring() -> None:
    """The web profile focus ring: a 3 px outline plus a 20 px blur at 45%, tinted by the active theme token."""
    size = 320
    big = Image.new("L", (size * SS, size * SS), 0)
    centre = size * SS / 2
    radius = 133 * SS
    circle_box = (centre - radius, centre - radius, centre + radius, centre + radius)
    stroke = Image.new("L", big.size, 0)
    ImageDraw.Draw(stroke).ellipse(circle_box, outline=255, width=3 * SS)
    # CSS box-shadow blurs the filled circle with a 4 px spread, not the outline itself.
    ImageDraw.Draw(big).ellipse(circle_box, fill=255)
    # SceneGraph scales this mask to the 304 px Poster, and the avatar group scales by 1.09.
    glow = big.filter(ImageFilter.GaussianBlur(10 * SS)).point(lambda alpha: round(alpha * 0.45))
    alpha = ImageChops.lighter(stroke, glow).resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    mask.putalpha(alpha)
    mask.save(IMAGES / "avatar-ring.png")


def profile_focus_shadow() -> None:
    """The web avatar's 0 22px 52px rgba(31,14,20,.28) focus shadow as a tintable mask."""
    size = 400
    scale = 4
    big = Image.new("L", (size * scale, size * scale), 0)
    centre = size * scale / 2
    radius = 146 * scale
    centre_y = 188 * scale
    ImageDraw.Draw(big).ellipse(
        (centre - radius, centre_y - radius, centre + radius, centre_y + radius),
        fill=255,
    )
    alpha = big.filter(ImageFilter.GaussianBlur(34 * scale)).resize(
        (size, size), Image.Resampling.LANCZOS
    )
    mask = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    mask.putalpha(alpha)
    mask.save(IMAGES / "avatar-shadow.png")


def profiles_background(theme: str) -> None:
    """Rasterise the web profile page's 145-degree base and centred 13% brand wash."""
    width, height = 1920, 1080
    if theme == "light":
        surface, background, brand = (251, 250, 249), (245, 243, 242), (207, 49, 87)
        filename = "profiles-bg-light.png"
    else:
        surface, background, brand = (27, 24, 27), (21, 19, 21), (207, 49, 87)
        filename = "profiles-bg.png"

    # CSS circle-at 50% 48%, farthest-corner radius, with its colour stop at 34%.
    centre_x, centre_y = width / 2, height * 0.48
    radius = ((width / 2) ** 2 + max(centre_y, height - centre_y) ** 2) ** 0.5 * 0.34
    angle = math.radians(145)
    gx, gy = math.sin(angle), math.cos(angle)
    length = (width - 1) * gx + (height - 1) * gy
    pixels = bytearray(width * height * 4)
    offset = 0
    for y in range(height):
        row_projection = y * gy
        dy = y - centre_y
        for x in range(width):
            t = min(1.0, max(0.0, (x * gx + row_projection) / length / 0.72))
            base = tuple(round(surface[c] * (1 - t) + background[c] * t) for c in range(3))
            distance = ((x - centre_x) ** 2 + dy ** 2) ** 0.5
            alpha = 0.13 * max(0.0, 1 - distance / radius)
            for channel in range(3):
                pixels[offset + channel] = round(base[channel] * (1 - alpha) + brand[channel] * alpha)
            pixels[offset + 3] = 255
            offset += 4
    Image.frombytes("RGBA", (width, height), bytes(pixels)).save(IMAGES / filename)


def profile_settings_buttons() -> None:
    """Render 44 px settings buttons with the web's 18 px gear glyph."""
    size, scale = 48, SS
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" '
        'fill="none" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
        '<circle cx="12" cy="12" r="3"/>'
        '<path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>'
        '</svg>'
    )
    rendered = subprocess.run(
        ["rsvg-convert", "-w", str(18 * scale), "-h", str(18 * scale), "-"],
        input=svg.encode("utf-8"),
        capture_output=True,
        check=True,
    ).stdout
    icon = Image.open(BytesIO(rendered)).convert("RGBA")
    icon_alpha = icon.getchannel("A")
    variants = {
        "profiles-gear.png": ((33, 29, 33, 163), (223, 220, 221, 41), (207, 49, 87)),
        "profiles-gear-light.png": ((255, 255, 255, 163), (56, 38, 33, 50), (207, 49, 87)),
        "profiles-gear-focus.png": ((244, 240, 241, 255), (244, 240, 241, 255), (207, 49, 87)),
        "profiles-gear-focus-light.png": ((56, 38, 33, 255), (56, 38, 33, 255), (207, 49, 87)),
    }
    for name, (fill, outline, foreground) in variants.items():
        image = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.ellipse((2 * scale, 2 * scale, 46 * scale - 1, 46 * scale - 1), fill=fill, outline=outline, width=scale)
        coloured_icon = Image.new("RGBA", icon.size, (*foreground, 0))
        coloured_icon.putalpha(icon_alpha)
        image.alpha_composite(coloured_icon, ((size * scale - icon.width) // 2, (size * scale - icon.height) // 2))
        image.resize((size, size), Image.Resampling.LANCZOS).save(IMAGES / name)


def profile_add_avatar(theme: str) -> None:
    """Render web .profile-add's theme-specific gradient, dashed border and plus glyph."""
    size = 240
    scale = SS
    width = height = size * scale
    if theme == "light":
        start, ink, border = (247, 222, 228), (68, 58, 64), (56, 38, 33, 47)
        filename = "avatar-add-light.png"
    else:
        start, ink, border = (61, 32, 42), (205, 193, 198), (223, 220, 221, 39)
        filename = "avatar-add.png"
    end = (168, 38, 85)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = image.load()
    cx, cy = width * 0.34, height * 0.26
    highlight_radius = width * 0.27
    angle = math.radians(145)
    gradient_x, gradient_y = math.sin(angle), -math.cos(angle)
    gradient_length = (width - 1) * (gradient_x + gradient_y)
    for y in range(height):
        for x in range(width):
            t = min(1.0, max(0.0, (x * gradient_x + y * gradient_y) / gradient_length))
            r = round(start[0] * (1 - t) + end[0] * t)
            g = round(start[1] * (1 - t) + end[1] * t)
            b = round(start[2] * (1 - t) + end[2] * t)
            distance = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            amount = 0.28 * max(0.0, 1 - distance / highlight_radius)
            pixels[x, y] = (
                round(r * (1 - amount) + 255 * amount),
                round(g * (1 - amount) + 255 * amount),
                round(b * (1 - amount) + 255 * amount),
                255,
            )
    circle = Image.new("L", (width, height), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, width - 1, height - 1), fill=255)
    image.putalpha(circle)

    # The web's 1 px dashed --line-strong border is subtle against both palettes.
    border_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border_layer)
    centre = (width - 1) / 2
    radius = (size / 2 - 1) * scale
    for start_degrees in range(0, 360, 16):
        border_draw.arc(
            (centre - radius, centre - radius, centre + radius, centre + radius),
            start=start_degrees,
            end=start_degrees + 9,
            fill=border,
            width=1 * scale,
        )
    image = Image.alpha_composite(image, border_layer)

    font = ImageFont.truetype(str(IMAGES.parent / "fonts" / "NunitoSans-300.ttf"), 77 * scale)
    plus_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    plus_draw = ImageDraw.Draw(plus_layer)
    plus_draw.text((centre, centre), "+", font=font, fill=ink, anchor="mm")
    image = Image.alpha_composite(image, plus_layer)
    image.resize((size, size), Image.Resampling.LANCZOS).save(IMAGES / filename)


def profile_visual_assets() -> None:
    profile_focus_ring()
    profile_focus_shadow()
    profiles_background("light")
    profiles_background("dark")
    profile_settings_buttons()
    profile_add_avatar("light")
    profile_add_avatar("dark")


def profile_signout_buttons() -> None:
    """Render the Roku Sign out pill at the live TV web size (104 x 44)."""
    scale = SS
    width, height = 104, 44
    font_path = Path(__file__).resolve().parents[1] / "fonts" / "NunitoSans-700.ttf"
    font = ImageFont.truetype(str(font_path), round(11 * scale))
    variants = {
        "profiles-signout.png": ((33, 29, 33, 163), (223, 220, 221, 41), (205, 193, 198, 255)),
        "profiles-signout-light.png": ((255, 255, 255, 163), (56, 38, 33, 50), (68, 58, 64, 255)),
        "profiles-signout-focus.png": ((207, 49, 87, 255), (207, 49, 87, 255), (255, 255, 255, 255)),
        "profiles-signout-focus-light.png": ((207, 49, 87, 255), (207, 49, 87, 255), (27, 24, 27, 255)),
    }
    for name, (fill, outline, foreground) in variants.items():
        image = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle(
            (scale, scale, (width - 1) * scale, (height - 1) * scale),
            radius=21 * scale,
            fill=fill,
            outline=outline,
            width=scale,
        )
        # Same 24px path and 18px SVG size as tv-web's SignOutIcon.
        icon_x, icon_y, icon_scale = 16 * scale, 13 * scale, 0.75 * scale
        def point(x: float, y: float) -> tuple[float, float]:
            return (icon_x + x * icon_scale, icon_y + y * icon_scale)

        stroke = max(1, round(1.7 * icon_scale))
        draw.line([point(10, 5), point(5, 5), point(5, 19), point(10, 19)], fill=foreground, width=stroke, joint="curve")
        draw.line([point(13, 8), point(17, 12), point(13, 16)], fill=foreground, width=stroke, joint="curve")
        draw.line([point(8, 12), point(17, 12)], fill=foreground, width=stroke)
        bbox = draw.textbbox((0, 0), "Sign out", font=font)
        text_y = (height * scale - (bbox[3] - bbox[1])) // 2 - bbox[1]
        draw.text((41 * scale, text_y), "Sign out", font=font, fill=foreground)
        image.resize((width, height), Image.LANCZOS).save(IMAGES / name)


def clients_grid_assets() -> None:
    """Rasterise the Web Clients page's platform marks and circular controls."""
    web = Path(__file__).resolve().parents[3] / "clients" / "tv-web" / "web" / "src" / "pages" / "Clients.tsx"
    source = web.read_text()
    paths_start = source.index("const paths:")
    paths_body_start = source.index("{", paths_start)
    paths_body_end = source.index("\n  };", paths_body_start)
    paths = dict(re.findall(r"([a-z]+)\s*:\s*\"([^\"]+)\"", source[paths_body_start:paths_body_end]))

    def special_mark(icon: str) -> tuple[str, str]:
        start = source.index(f'if (icon === "{icon}")')
        end = source.find("\n  if (icon ===", start + 1)
        block = source[start:] if end < 0 else source[start:end]
        viewbox = re.search(r'<svg viewBox="([^"]+)"', block)
        path = re.search(r'<path d="([^"]+)"', block)
        if viewbox is None or path is None:
            raise ValueError(f"Could not read the {icon} SVG from {web}")
        return viewbox.group(1), path.group(1)

    special = {
        "vidaa": special_mark("vidaa"),
        "xbox": special_mark("xbox"),
        "server": special_mark("server"),
    }
    icon_names = {
        "vidaa": "vidaa",
        "android": "android",
        "apple": "apple",
        "webos": "lg",
        "tizen": "samsung",
        "roku": "roku",
        "chromecast": "chromecast",
        "xbox": "xbox",
        "harmony": "harmony",
        "firetv": "firetv",
        "server": "server",
    }

    def svg_markup(icon: str) -> str:
        if icon in special:
            viewbox, path = special[icon]
            if icon == "vidaa":
                return (
                    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">'
                    '<rect x="2.5" y="4.5" width="19" height="13" rx="2.5" '
                    'fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
                    f'<path d="{path}" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
                    '</svg>'
                )
            if icon == "server":
                return (
                    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">'
                    '<rect x="3" y="3.5" width="18" height="7" rx="2" fill="none" stroke="white" stroke-width="1.6"/>'
                    '<rect x="3" y="13.5" width="18" height="7" rx="2" fill="none" stroke="white" stroke-width="1.6"/>'
                    f'<path d="{path}" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
                    '</svg>'
                )
            return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" fill="white"><path d="{path}"/></svg>'
        path = paths.get(icon)
        if path is None:
            raise ValueError(f"Could not read the {icon} SVG path from {web}")
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="{path}"/></svg>'

    for client_id, icon in icon_names.items():
        svg_path = svg_markup(icon)
        png_path = IMAGES / f"client-icon-{client_id}.png"
        rendered = subprocess.run(
            ["rsvg-convert", "-w", "256", "-h", "256"],
            input=svg_path.encode(),
            stdout=subprocess.PIPE,
            check=True,
        ).stdout
        Image.open(BytesIO(rendered)).save(png_path)

    def mask_circle(name: str, size: int, inset: float = 0, stroke: float = 0) -> None:
        big = Image.new("L", (size * SS, size * SS), 0)
        bounds = (inset * SS, inset * SS, size * SS - 1 - inset * SS, size * SS - 1 - inset * SS)
        draw = ImageDraw.Draw(big)
        if stroke:
            draw.ellipse(bounds, outline=255, width=round(stroke * SS))
        else:
            draw.ellipse(bounds, fill=255)
        alpha = big.resize((size, size), Image.Resampling.LANCZOS)
        mask = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        mask.putalpha(alpha)
        mask.save(IMAGES / name)

    # The circle fill and border follow .client-platform-icon at 220px. The focus ring is
    # the Web's 3px :focus-visible outline with a 2px offset, so its outer box is 230px.
    mask_circle("clients-bubble.png", 220)
    mask_circle("clients-bubble-border.png", 220, stroke=1)
    mask_circle("clients-focus-ring.png", 230, stroke=3)


def main() -> None:
    avatars()
    profile_visual_assets()
    profile_signout_buttons()
    clients_grid_assets()
    for name in ICONS:
        icon(name, 40 if name == "icon-empty" else 20)
    for r in (6, 12, 25):
        nine_patch(f"round-r{r}", r)
        nine_patch(f"round-outline-r{r}", r, 1.2)
    nine_patch("round-r82", 82)
    nine_patch("round-outline-r82", 82, 1.2)
    nine_patch("round-ring-r12", 12, 3)
    nine_patch("round-ring-r25", 25, 3)
    nine_patch("round-r32", 32)
    nine_patch("round-ring-r32", 32, 3)
    card_glow()
    for n in range(1, 5):
        group(n)
    # Page shell: the right-hand panel fades in over 260 px (white ramp, tinted by the panel token).
    ramp = Image.new("RGBA", (260, 4), (255, 255, 255, 0))
    px = ramp.load()
    for x in range(260):
        for y in range(4):
            px[x, y] = (255, 255, 255, round(255 * x / 259))
    ramp.save(IMAGES / "page-fade.png")
    # Scroll edge fades (white alpha ramps, tinted with the page background): opaque at the named edge, clear 96 px in.
    for name, size, fn in (("edge-fade-l", (96, 4), lambda x, y: x), ("edge-fade-r", (96, 4), lambda x, y: 95 - x)):
        img = Image.new("RGBA", size, (255, 255, 255, 0))
        px2 = img.load()
        for yy in range(size[1]):
            for xx in range(size[0]):
                t = 1 - fn(xx, yy) / 95
                px2[xx, yy] = (255, 255, 255, round(255 * max(t, 0) ** 1.4))
        img.save(IMAGES / f"{name}.png")
    for name, fn in (("edge-fade-t", lambda y: y), ("edge-fade-b", lambda y: 95 - y)):
        img = Image.new("RGBA", (4, 96), (255, 255, 255, 0))
        px2 = img.load()
        for yy in range(96):
            for xx in range(4):
                t = 1 - fn(yy) / 95
                px2[xx, yy] = (255, 255, 255, round(255 * max(t, 0) ** 1.4))
        img.save(IMAGES / f"{name}.png")
    # Linear alpha ramps (white, tinted at run time): the web's stage gradients (.tv-key-art::after, .tv-stage-wash) are CSS linear
    # gradients from a token colour to transparent, so a stretched ramp bitmap reproduces them without stepped rectangles.
    for name, size, fn in (
        ("ramp-l", (256, 4), lambda x, y: 255 - x),
        ("ramp-r", (256, 4), lambda x, y: x),
        ("ramp-t", (4, 256), lambda x, y: 255 - y),
        ("ramp-b", (4, 256), lambda x, y: y),
    ):
        ramp_img = Image.new("RGBA", size, (255, 255, 255, 0))
        rpx = ramp_img.load()
        for yy in range(size[1]):
            for xx in range(size[0]):
                rpx[xx, yy] = (255, 255, 255, max(0, min(255, fn(xx, yy))))
        ramp_img.save(IMAGES / f"{name}.png")
    # Home's right rail frost (.tv-home-rails) uses a theme-specific alpha curve over 62% of the canvas.
    for name, stops in (
        ("home-rail-frost-light", [(0, 0), (0.12, 0.68), (0.34, 0.88), (0.62, 0.96), (1, 1)]),
        ("home-rail-frost-dark", [(0, 0), (0.12, 0.72), (0.34, 0.90), (0.62, 0.97), (1, 1)]),
    ):
        frost = Image.new("RGBA", (256, 4), (255, 255, 255, 0))
        fpx = frost.load()
        for x in range(256):
            position = x / 255
            for index in range(len(stops) - 1):
                left, right = stops[index], stops[index + 1]
                if position <= right[0]:
                    progress = (position - left[0]) / (right[0] - left[0])
                    alpha = round(255 * (left[1] + (right[1] - left[1]) * progress))
                    break
            for y in range(4):
                fpx[x, y] = (255, 255, 255, alpha)
        frost.save(IMAGES / f"{name}.png")
    # Media-card shadows (web, pinned in docs/design/page-layout.md section 5): colour rgb(56,38,33) under the 220 x 124 art
    # (radius 12). Focused Home card: 0 26px 52px .32 and 0 11px 22px .22. Resting card: 0 10px 20px .14 and 0 3px 8px .10.
    # A CSS blur radius B is a gaussian of sigma B / 2. The bitmap carries 90 px of room on every side; the y offset is baked in.
    from PIL import ImageFilter
    def card_shadow(name, layers):
        pad = 90
        out = Image.new("RGBA", (220 + 2 * pad, 124 + 2 * pad), (56, 38, 33, 0))
        for dy, blur, alpha in layers:
            layer = Image.new("RGBA", out.size, (56, 38, 33, 0))
            mask = Image.new("L", out.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle((pad, pad + dy, pad + 220, pad + dy + 124), radius=12, fill=round(255 * alpha))
            mask = mask.filter(ImageFilter.GaussianBlur(blur / 2))
            layer.putalpha(mask)
            out = Image.alpha_composite(out, layer)
        out.save(IMAGES / f"{name}.png")
    card_shadow("card-shadow", [(26, 52, 0.32), (11, 22, 0.22)])
    card_shadow("card-shadow-rest", [(10, 20, 0.14), (3, 8, 0.10)])
    # Player scrim (.player-scrim): black fading in from the top of the bottom 48 % to .92 at the bottom edge.
    scrim = Image.new("RGBA", (4, 256), (255, 255, 255, 0))
    spx = scrim.load()
    for y in range(256):
        for x in range(4):
            spx[x, y] = (255, 255, 255, round(255 * y / 255))
    scrim.save(IMAGES / "player-scrim.png")
    # Identity pill (.app-user-identity): 143.5 x 48.2, fully rounded, --surface at .66.
    rounded(144, 48, 24, 168).save(IMAGES / "nav-user-pill.png")
    # Active dock chip: 67.2 square, radius 16, ink at .09 (tinted by blendColor).
    rounded(67, 67, 16, 23).save(IMAGES / "nav-item-active.png")
    # Dock focus chip: the same shape, stronger.
    rounded(67, 67, 16, 46).save(IMAGES / "nav-item-focus.png")


if __name__ == "__main__":
    main()
