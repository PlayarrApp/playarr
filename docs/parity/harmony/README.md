# HarmonyOS parity (TV, 1920x1080)

Huawei serves HarmonyOS emulator images only in mainland China (row 5.10013), so HarmonyOS parity runs on the
**DevEco Studio Previewer** for now: TV device, 1920x1080, screen density 160 (1 vp = 1 px = 1 web CSS px), dark theme,
signed in to a real server as the device test account. It is a UI preview, not an emulator:

- No video playback (no AVPlayer), so the player screens cannot be compared.
- Image decoding (`@kit.ImageKit`) is mocked by the Previewer, so artwork does not render.
- The Previewer only runs `EntryAbility` in debug mode, and this Previewer build ignores the module `routerMap`, so a
  local, uncommitted preview overlay adds a `navDestination` route builder to `pages/Index.ets` and Previewer mocks for
  `deviceInfo` (`tv`) and a persistent Asset Store. None of it ships in the app.

Captures of real media are never committed (AGENTS.md); the side-by-sides stay in the worker's scratch folder.

## Scoring note: artwork

The Previewer draws no artwork (image decoding is mocked), while the web reference shows it. Mismatch on artwork-heavy
screens (Home rails, library grids, search results, detail heroes) is therefore inflated by the artwork area alone, and
a layout can be correct at 20 to 30% mismatch. This is a known Previewer limit, not a layout defect. Until both sides can
be masked to the same regions, judge those screens by the side-by-sides' structure (positions, sizes, text, marks) and by
the screens with no artwork (profiles, settings, calendar, search idle, filters), which score directly.

## Status

Home (nav rail, clock, rails), library pages (hero, landscape grid, alphabet rail, Filters), calendar (agenda, week, month,
Filters), search (with Filters), settings (Appearance, Player, Server connection), the profile picker (alien avatar,
theme select) and the QR link screen exist and are compared dark and light. Open gaps are tracked on rows 13.10014 to
13.10021 and 13.809. Player screens and D-pad behaviour are not testable in the Previewer.
