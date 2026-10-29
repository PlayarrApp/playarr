# Parity layout score

Owner decision 2026-10-24: "100% parity" is measured by a deterministic layout score. The raw pixel percentage stays on the
legend for reference. The layout score says: every visible web element has a device element with the same box, colours, font
size and weight, and text.

## Documents

One JSON file per screen and theme (`scripts/parity/layout-schema.json`):

```json
{ "screen": "home", "theme": "dark", "viewport": { "w": 1920, "h": 1080, "dpr": 1 }, "clockPinned": true,
  "elements": [ { "text": "On deck", "role": "heading", "rect": { "x": 783.34, "y": 163, "w": 62.19, "h": 24 },
                  "color": "#f4f0f1", "background": "#1b181b", "fontSize": 17.66, "fontWeight": 610, "radius": 12, "opacity": 0.8 } ] }
```

- `rect`: CSS px of the layout viewport (device px divided by dpr), origin at the top left of the app viewport, excluding system bars.
  For text elements it is the glyph-run bounds (the drawn glyphs of one rendered line, from `Range.getBoundingClientRect` per character; a wrapped paragraph is one element per line, each with that line's text; volatile text elements use the glyph run too), never the
  widget or view box: exporters must emit the bounds of the laid-out text, not a stretched label frame. Other elements use the border box.
  A focusable control (button, link, tab, input) is two elements when it has its own text: the control with its CSS border box (`text` = its
  accessible name, no text style) and, as a separate `text` element, the label with glyph-run bounds, colour, font size and weight.
  A volatile control keeps its border box too.
- `color`: text colour, `#rrggbb` or `#rrggbbaa`; `null` for elements without text. `background`: the colour behind and including
  the element, every ancestor background composited over white. `fontSize` (CSS px, after any zoom) and `fontWeight` (100 to 900):
  `null` without text. `radius` (top-left corner, px; web elements that draw no fill, border or shadow carry `painted: false` and their radius is not scored) and `opacity` (product with the ancestors) only when not 0 and not 1.
- `text`: the text as displayed (after text-transform), whitespace collapsed. Controls without own text use their accessible label.
- `role`: `text`, `heading`, `button`, `link`, `textbox`, `switch`, `select`, `image`, `video`, `container`, `tab`, `list`, or the ARIA
  role the web element carries. `system` marks OS chrome (status bar, home indicator): never matched, never reported.
- Which elements the web exports: exactly what a user can see. Leaf text elements, focusable controls (a card is a `link` named
  "Open <title>", nav items are `tab`/`link`, kept even without a visible box because natives must export them with their accessible
  name), images/svg/canvas/video, and containers with a visible fill: a background colour or image with alpha above 0, a border
  with width and a non-transparent colour, or a box shadow; a background colour identical to the one already behind it is not a fill. Order is DOM order, so two exports of the same page are identical.
- Dropped by the exporter (so a native app never has to invent them): elements without text, visible fill or focusability (page
  wrappers, nav groups, unstyled link boxes); `display: none`, `visibility: hidden`, effective opacity 0; boxes clipped away by an
  `overflow` ancestor or entirely outside the viewport; descendants of `[inert]`; descendants of `[aria-hidden="true"]` when that
  host contains something focusable (a hidden page region; decorative aria-hidden glyphs such as a "+" icon stay, they are visible);
  screen-reader-only elements (the element or an ancestor is 1x1 or smaller with `overflow`, `clip` or `clip-path` set, or has
  `clip: rect(0,0,0,0)` / `clip-path: inset(50%)`; no client can draw them, e.g. the calendar range `status`);
  and elements fully covered by an overlay. Occlusion is sampled deterministically: `elementFromPoint` at a 3x3 grid (20%, 50%, 80%)
  of the element's rect clipped to the viewport; the element is occluded when every sample lands on an element outside its own
  subtree that paints (an image/video/canvas/svg, or a background of alpha 0.5 or more, a background image, or a backdrop filter,
  looking up to the common ancestor). Transparent click layers and `pointer-events: none` elements never occlude. A partly covered
  element stays. The document counts what it dropped as `occluded`; `layout-score.mjs` prints it, so a drawer screen shows a
  non-zero count and a screen without an overlay shows 0. A native video plane that the platform composites above the browser (the Samsung emulator's AVPlay `<object>`, whose rect the app syncs to the player shell) is passed to the dumper as `opaquePlanes`: points inside its rect count as covered. Device documents carry `occluded` too.
- Text colour: the exporter reads `-webkit-text-fill-color` (which defaults to `color`). Fully transparent text (loading skeleton
  lines use `color: transparent` over a painted bar) is not text: the element exports as a container with its background and no
  text, font or colour. Text clipped to a gradient (`background-clip: text`) reports the gradient's first stop colour and
  `colorGradient: true`; the scorer compares it with the normal deltaE.
- Font size and scale: `fontSize` is the computed `font-size` in CSS px of the layout viewport (`viewport.w` x `viewport.h`),
  multiplied by every `zoom` on the element and its ancestors. The refs are rendered at the stage size (TV 1920x1080 at dpr 1,
  where the TV stage scale `tvStageScale.ts` is neutral, zoom 1; phone groups at their own CSS viewport), so no root zoom or
  transform applies and computed equals effective. A TV shell that fits the stage with CSS `zoom` (webOS, Tizen web) is covered by
  the zoom product. A shell that scales with a `transform` (VIDAA) reports rects in stage px already, so font sizes stay unscaled
  there too. Native exporters report the CSS-px size the rendered glyphs have (for example Qt `pixelSize` divided by the window
  scale), never the raw device px. A heading of 15.23 px on web is 15.23, not 16: the web value is the truth.
- `clockPinned` (device documents): the app's own clock was pinned to the fixture instant (see Freezing).

Layout refs: `<legend dir>/web/layout/<theme>/<screen>.json` for every ref group (`capture-refs.mjs` writes them with every capture;
`--layout-only` refreshes only these). Devices write `<legend dir>/<cand>/layout/<theme>/<screen>.json`.

## Scoring

`node scripts/parity/layout-score.mjs --ref <web json> --device <device json> [--json] [--max N]`

Matching (deterministic, in web order): 1. normalised text and role, nearest rect; 2. same text, other role (a `role` failure);
3. textless and volatile elements: same role, best overlap; 4. remaining elements: same role, best overlap (a `text` failure).
Score = web elements matched and equal / scored web elements. Tolerances: each rect edge 1 px, colour and background CIE76 deltaE 2
(translucent colours composited first), font size 0.5 px, weight 50, radius 1 px, opacity 0.05. Every failure lists the field,
the web and device values, and the delta. Extra device elements are counted, not penalised.

## Per-client exclusions

`scripts/parity/layout-exclusions.json`, keyed by legend client dir (`roku`, `firetv`, `xbox`, ...): web elements a
client legitimately cannot have because the product documents a capability gap (no downloads on Roku, Fire TV Vega, Xbox and
Nura; no in-app updater on Roku, Fire TV Vega, Xbox). Each entry is
`{ screen ("*" = all), match: { role?, text | textPrefix | textRegex }, reason, doc: "<repo path>#<heading anchor>" }`, and the doc
line must state the gap (`DEVICES.md` downloads and updater tables, `fire-tv.md`, `versioning-policy.md`). An entry without a
citation makes the loader throw.

`layout-score.mjs --client <dir>` (or `scoreLayout(ref, dev, { client, exclusions: loadExclusions() })`) removes the matched web
elements from the denominator and lists them as `excluded` with reason and doc. Nothing else moves: neighbouring elements keep
their web positions and are scored as before, so an exclusion can never excuse a shifted layout. Never use an exclusion for
styling differences or bugs; a missing element that web draws and the product supports is a failure.

## Volatile content

A volatile selector flags the matched element and each descendant `volatile`; none is merged into another, so every drawn text run and icon (the time code and its separator, the quality badge and label, the audio icon) keeps its own box and style.
Text cut by `text-overflow: ellipsis` cannot be read from the DOM (the engine draws the "…"): the dumper refuses such an element with an error and never reconstructs the cut, so the app must render a truncated string as real text that ends in "…" (as Harmony's FitLine does).

`scripts/parity/layout-volatile.json` (keyed by screen, `*` = all): elements whose text is expected to differ while box and style
must still match: header clock and date, the nav-rail app version ("v 0.1.0"; native builds carry their own), calendar-link URL and QR, the settings-server address, the player time code; the player audio button (web Chromium shows "Audio: Unavailable" because it lacks `audioTracks` support, a native app shows the clip's real track); the player quality button (which stream the player picks is playback behaviour, out of scope: only its box, style, role and name presence are scored); the player buffered bar (`omit`: left out of the refs, its length follows download timing). An entry with `opacityVolatile` (the player audio button: web direct-play never loads tracks, so web shows it dimmed) is exported with
`opacityVolatile: true` and no `opacity`; the scorer skips its opacity and still scores its box and style. The video
frame is `maskOnly`: not scored, and the pixel scorer blanks its rect. OS bars are exported as role `system`. The web document marks
such elements with `volatile`; the scorer matches them by role and overlap and skips their text.

## Freezing beats masking

A client with a freeze hook makes the clock NOT volatile: the header clock and date are scored on their text. Contract: a launch
argument or control command `parityNow=<ISO instant>` pins the app's own clock (clock, Today, entry times, in UTC and en-GB) to the
instant and stops it ticking. The fixture instant is `2026-10-07T12:00:00Z`; the web shows it as `12:00` and `WED 7 OCTOBER`. The
device driver sets `clockPinned: true` in its layout documents when the pin was applied. The scorer reports per run
`clock: { pinned, equalsFixture }`: `pinned` is what the device declared, `equalsFixture` whether the device's clock text equals the
web's (`null` when the screen has no clock). A pinned client whose `equalsFixture` is false has a freeze bug.

Pin status (`SUITE.md`, device drivers): pinned for web, Android, Fire TV (`cmd=clock`), webOS (CDP), Tizen web (page script), Roku
(`parityNow` launch argument), tvOS key runs. Not pinned yet: Harmony, iOS and the Apple simulators, Xbox, Sailfish, Nura. Those clients
score the clock as volatile until they add the hook.

## Exporters

Each lane exports its own native view tree into this schema, as close to the app as the platform tree allows, and writes
`<cand>/layout/<theme>/<screen>.json` in the same run as the screenshot (same screen state). Tizen web and webOS run the same
DOM dump as the web refs through their drivers (`layoutDump` in `drivers/tizen-webos.mjs`, built from `layout-dump.mjs`).

| Platform | Tree API |
| --- | --- |
| Android TV, Android phone and tablet, Fire TV (Android) | `uiautomator dump` (bounds, text, content-desc, class); font size, weight and colours need the app's own debug export (Compose semantics or a debug view-tree dump), since uiautomator carries none |
| iOS, iPadOS, tvOS, macOS | XCUITest `XCUIElement.debugDescription` or the accessibility hierarchy for frames, labels, traits; fonts and colours from a debug build that walks the view tree (`UIView`/SwiftUI) |
| Roku | ECP `query/app-ui` (node bounds, text, font, colours of Labels and Posters) |
| HarmonyOS (TV, phone) | `hdc shell uitest dumpLayout` (bounds, text, type, fontSize, fontColor, backgroundColor) |
| Xbox (UWP) | UI Automation tree plus `VisualTreeHelper` walk in a debug build (bounds, `TextBlock` font and brushes) |
| Sailfish, Nura (Qt) | QML `Item` tree walked by a debug build (`x/y/width/height` mapped to the window, `font.pixelSize`, `font.weight`, `color`); GTK: widget tree allocation and CSS computed style |
| Tizen native | the debug mirror build walks the Tizen.NET visual tree |
| Tizen web, webOS | DOM dump through the driver (`layoutDump`) |

Fonts, weights and colours are mandatory in the schema: where a platform tree lacks them the lane's debug build must export them
from the app's own style values, not guess from pixels.

## Role aliases (per client, default off)

Android (Compose) and Vega-style toolkits have no `link` role: a tappable text or card is a `button`. For those clients only, the scorer accepts a device `button` for a web `link`: `scoreLayout(..., { roleAliases: { link: ["button"] } })`, or `layout-score.mjs --role-alias link=button`. The alias is one way (web role to accepted device roles), applies to matching and to the role comparison, and is off unless the caller passes it. Pass it for android, android-phone, android-tablet and firetv (only if Vega cannot report a link). Every other client keeps the strict role match.

HarmonyOS (ArkUI API 18, TV and phone) has no heading role either: a title is a `text`. For `harmony` and `harmony-phone` pass `{ roleAliases: { heading: ["text"] } }` (CLI `--role-alias heading=text`). Only the role check and role-based matching accept the device `text` for a web `heading`; box, text and style still score. Aliases can be combined (repeat the flag).
