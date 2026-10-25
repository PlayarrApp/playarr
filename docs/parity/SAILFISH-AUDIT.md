# Sailfish layout measurement audit

Task 61.10082 remains blocked on a clean native measurement exporter and verification of the remaining parity target. [PR #510](https://github.com/PlayarrApp/playarr/pull/510) is merged. App and capture fixes are in the draft [PR #552](https://github.com/PlayarrApp/playarr/pull/552); they improve visible clipping, player capture readiness, navigation styling and repeatable profile headings, but do not make the layout exporter acceptable.

Full runs C and D each captured 32 screens across both themes. Their PNGs, decoded RGBA data, diagnostic layout JSON and scores matched byte for byte. The 149 inventoried capture inputs were unchanged across that pair, and guest QML plus native executable hashes were stable. This proves repeatability for C/D against the same refreshed references; it does not prove visual parity or layout acceptance. The earlier A run's whole-pair freeze failed because shared layout references changed during capture, so A is excluded from this comparison.

## Measurement failures

- Commit `f53df3ee6` removed fabricated full-screen wrapper exports. The exporter remains NOT CLEAN: it does not consistently apply ancestor clipping and transforms, or fully represent final effect composition and occlusion.
- QML can expose `Text.lineLaidOut` line boxes and values from the `Accessible.*` attached properties. The current exporter still does not measure actual glyph and style-run bounds or final paint/effect semantics, and it does not consistently report real accessibility names and roles. Item metadata alone is not sufficient for acceptance.
- No current web-reference defect has been established. The duplicate/offscreen and circle-radius observations from the older reference set were superseded by the refresh; they are not established visibility blockers.
- A native exporter replacement has not been built or independently audited. The available Sailfish VM has a hard 6 GiB memory limit, while bounded `memory.high` and swap controls are not available to this session. The user scope bus is unavailable, so the required bounded build setup cannot currently be applied. Host Qt 5.15 is not the Sailfish Qt 5.6 target.

## Verified app and capture changes

The home progress artwork is clipped to its rounded corners. Player capture seeks while paused, waits for engine and source positions to equal exactly 2,000 ms, and waits for the busy indicator to stop and fade before requesting a fresh layout export. Calendar-link reports its matching route. The navigation bar no longer paints the border and blur removed by the web cascade, and its shadow uses a full-height shape translated down. The two profile headings use Qt text rendering; focused repeated captures produced identical PNGs and layout JSON in both themes. Focused app captures passed for these changes. They do not establish full pixel parity.

## Work required before acceptance

Keep Sailfish layout validation withdrawn. The exporter must report actual visible geometry after clipping and transforms, rendered colours and effect semantics, actual per-line and per-style-run glyph bounds, and real accessible names and roles. Preserve the web application's appearance; do not change references to accommodate the exporter. Run a fresh independent read-only audit after exporter changes and only then consider layout scores. C/D repeatability is useful evidence, but it does not satisfy the layout gate or the 100 percent parity goal.
