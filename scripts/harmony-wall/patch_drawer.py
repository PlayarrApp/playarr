# Preview-only (never committed): phone parity captures follow capture-web.mjs's FREEZE_CSS policy and omit
# Drawer backdrop filtering, whose raster output is not part of the accepted frozen reference. Product Drawer.ets keeps blur.
# Usage: patch_drawer.py <copied Drawer.ets>.
import sys


MARKER = "    // Phone preview parity: match capture-web.mjs FREEZE_CSS by omitting backdrop blur."
BLUR_DECLARATION = "const DRAWER_BACKDROP_BLUR: number = 38;\n"
BLUR_MODIFIER = "    .backdropBlur(DRAWER_BACKDROP_BLUR)\n"


def transform(source: str) -> str:
    if MARKER in source:
        assert BLUR_MODIFIER not in source, "preview blur marker exists but blur modifier remains"
        assert BLUR_DECLARATION not in source, "preview blur marker exists but blur declaration remains"
        return source

    assert source.count(BLUR_DECLARATION) == 1, "drawer blur declaration not found exactly once"
    assert source.count(BLUR_MODIFIER) == 1, "drawer blur modifier not found exactly once"
    return source.replace(BLUR_DECLARATION, "", 1).replace(BLUR_MODIFIER, MARKER + "\n", 1)


def main() -> None:
    path = sys.argv[1]
    with open(path, encoding="utf-8") as file:
        source = file.read()
    transformed = transform(source)
    with open(path, "w", encoding="utf-8") as file:
        file.write(transformed)


if __name__ == "__main__":
    main()
