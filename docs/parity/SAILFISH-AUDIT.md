# Sailfish layout measurement audit

Task 61.10082 remains blocked on target validation of a native measurement exporter and verification of the remaining parity target. [PR #510](https://github.com/PlayarrApp/playarr/pull/510) and [PR #552](https://github.com/PlayarrApp/playarr/pull/552) are merged. App and capture fixes improve visible clipping, player capture readiness, navigation styling and repeatable profile headings, but do not make the layout exporter acceptable.

Full runs C and D each captured 32 screens across both themes. Their PNGs, decoded RGBA data, diagnostic layout JSON and scores matched byte for byte. The 149 inventoried capture inputs were unchanged across that pair, and guest QML plus native executable hashes were stable. This proves repeatability for C/D against the same refreshed references; it does not prove visual parity or layout acceptance. The earlier A run's whole-pair freeze failed because shared layout references changed during capture, so A is excluded from this comparison.

## Measurement failures

- Commit `f53df3ee6` removed fabricated full-screen wrapper exports. The exporter remains NOT CLEAN. This change maps the four corners of item rectangles into root coordinates, intersects viewport, ancestor and self clip polygons, and keeps walking children when an unclipped parent is offscreen. Flat fill sampling retains transformed polygons. Radius values are retained only for uniform scale and rotation; nonuniform rounded geometry emits a limitation diagnostic.
- This geometry was checked with 15 Node regressions and a 9-case Qt Quick probe using host Qt 5.15.19. The probe exercises `mapToItem`, default centre rotation, negative scale, clipping, inherited scale, offscreen parents and one real `LayoutDump.dump()` walk. Host Qt 5.15 is not Sailfish Qt 5.6, so these results are not target runtime proof.
- Text is no longer reconstructed: each displayed line is a Text item of its own (`FitText`), and the exporter reads its `contentWidth` and `contentHeight`. It stops on a Text with several lines or one Qt elided. Rounded pictures sit in a masked layer and export the drawn mask radius as it is.
- No current web-reference defect has been established. The duplicate/offscreen and circle-radius observations from the older reference set were superseded by the refresh; they are not established visibility blockers.
- A native exporter replacement has not been built or independently audited. The required bounded build executor is unavailable, so the native build and target measurement remain blocked. Host Qt 5.15 is not the Sailfish Qt 5.6 target.

## Verified app and capture changes

The home progress artwork is clipped to its rounded corners. Player capture seeks while paused, waits for engine and source positions to equal exactly 2,000 ms, and waits for the busy indicator to stop and fade before requesting a fresh layout export. Calendar-link reports its matching route. The navigation bar no longer paints the border and blur removed by the web cascade, and its shadow uses a full-height shape translated down. The two profile headings use Qt text rendering; focused repeated captures produced identical PNGs and layout JSON in both themes. Focused app captures passed for these changes. They do not establish full pixel parity.

## Work required before acceptance

Keep Sailfish layout validation withdrawn. The exporter must report actual visible geometry after clipping and transforms, rendered colours and effect semantics, actual per-line and per-style-run glyph bounds, and real accessible names and roles. Preserve the web application's appearance; do not change references to accommodate the exporter. Run a fresh independent read-only audit after exporter changes and only then consider layout scores. C/D repeatability is useful evidence, but it does not satisfy the layout gate or the 100 percent parity goal.

## Update 2026-10-29: accessibility, border and picture fixes

- Names and roles are the items' real `Accessible.name` and `Accessible.role`, read by the app (`harbour-playarr.qml`) through the QML `Accessible` attached object and handed to `LayoutDump.js`, which only translates the Qt role number to the web's role word. The custom `parityRole`, `a11yName` and `parityLabel` hints are gone from the QML; the D-pad focus log reads `Accessible.name` too. The calendar-link close button keeps the web's name, "Close filters", because the web names it that.
- A Rectangle border counts as drawn when its pen differs from the default pen of a fresh Rectangle (read at run time and passed in), not from a hard-coded 1 px black pen. A source test keeps the QML free of a deliberate black 1 px border, which would read as unset.
- The painted shape of a control is a child Rectangle that covers 95 percent or more of the control, not one that merely lies inside it. A picture inside a rounded container of its own size takes its rounding from the container; a picture that carries its own rounding (calendar posters) reports the mask's radius.
- Page surfaces nest as in the web: shell, app frame and page are Rectangles in the tree with the content inside them, so a later full-screen drawer does not hide the layers it sits on. Single-line cuts that the web makes with the ellipsis straight after the last letter are drawn by `CutLabel`, so the exported text is exactly the drawn text; the exporter also checks an elided run against Qt's own content width.
- Still open: the player quality button is one volatile element on the web (the button box with the style of its text); the native control is a box plus separate text runs, so its style fields cannot match without the exporter inventing a merge.
