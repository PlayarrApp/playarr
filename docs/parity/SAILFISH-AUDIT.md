# Sailfish layout measurement audit

Task 61.10082 remains blocked on the shared reference and measurement contract. The audit of capture commit `6ff18fc194fe24c26d6f25b6d7e2a3f3dbbb20cf` does not accept the existing 100% layout claim. [PR #510](https://github.com/PlayarrApp/playarr/pull/510) remains open.

The 15 standard screens repeat byte for byte across two consecutive runs, including both themes, screenshots and layout JSON. Calendar-link also repeats byte for byte in a separate pair covering both themes, but its export matches only 17 of 34 scored elements in each theme. These are separate capture pairs, not two unified 16-screen runs. Repeatability alone does not establish measurement correctness.

## Measurement failures

- `MainPage.qml` declares three full-viewport `layoutEls` records with hard-coded dimensions and colours. `PlayarrPage.qml` draws one page background. `LayoutDump.js` emits these declarations without requiring corresponding rendered rectangles.
- The home and calendar-link web references also contain three full-viewport background records at `/elements/0`, `/elements/1` and `/elements/2`, including two identical fills. The shared visible-element contract must resolve the occluded duplicates. Adding invisible native layers or synthetic export entries is not a repair.
- `LayoutDump.js` estimates text bounds from Chromium ascent and descent constants, permits replacement text and dimensions, and emits wrapped paragraphs as one element. It must measure the actual laid-out native lines and style runs.
- Circle radii are exported as `50` to match a CSS percentage value. A resolved radius in viewport pixels needs a consistent reference definition.
- The player web dump marks a full-viewport video rectangle as `maskOnly`. Applying that rectangle to the composed screenshot erases the controls too. The resulting 100% pixel score has zero unmasked pixels and cannot validate the player. The existing configured regions, compared without volatile masks, give 99.19% dark and 99.20% light in the audited pair. Those regions also assume a different viewport height, so this diagnostic is not a replacement acceptance score.

## Work required before acceptance

The coordinator must withdraw Sailfish's layout validation, resolve reference visibility and radius units, and prevent the video mask from erasing controls. Preserve the web application's appearance and the original audit evidence.

Native work must replace metadata substitutes with measured elements, correct calendar-link roles and styling, clip the home progress card to its rounded corners, and resolve the navigation outline difference. The player capture must wait for the engine to report exactly 2.000 seconds after seeking and pausing. The current fixed delay does not prove that condition.

No font-rasteriser or platform exception is accepted. Aligned crops show card-corner and navigation-outline differences that are not glyph-edge differences. After these repairs, provide one command covering all 16 screens in both themes, run it twice and retain the per-screen scores, hashes and aligned difference evidence.
