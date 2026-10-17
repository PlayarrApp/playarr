# Repository working agreement

These instructions apply to the entire repository.

## Client product bar (native, parity, performance)

Canonical policy: [`docs/architecture/client-principles.md`](docs/architecture/client-principles.md).
It overrides weaker or older wording elsewhere in the tree.

- **Every Playarr app is fully native** for its platform (Compose, SwiftUI,
  SceneGraph, UWP/XAML, ArkUI, vendor TV package + native player plane, or a
  first-class browser app on Web). Do not introduce WebView shells of Playarr
  Web as the signed-in product on native-capable OS targets.
- **Android TV especially:** fully native Compose + Media3 only. Never use a
  WebView of Playarr Web, Chromium freezes, or SPA residual AE=0 gates as the
  television product or as the parity success path. Binding detail:
  `clients/android/AGENTS.md` and `docs/architecture/clients/android-tv.md`.
- **Full product parity** across complete clients: same tasks, hierarchy, and
  server contract. Do not thin a client because another surface already has
  the UI.
- **Native-class performance**: prefer direct play and the platform media
  pipeline; use real scroll and focus systems; do not accept a browser-engine
  tax where a native toolkit exists.
- **Graceful degradation only for missing capability** (for example offline
  downloads on platforms that cannot support them). Hide or disable with an
  honest reason; never crash or pretend success.
- Temporary fallbacks (browser on Xbox, hosted Web on VIDAA, transitional TV
  web packages) stay labelled as fallbacks until the native path matches.
  Known deviations are listed in the principles doc; do not extend them.

## No media titles or real media assets

This repository is public. **Never write the name of a real film, series, episode, album, track, artist or
studio franchise anywhere in it**: not in code, tests, fixtures, comments, docs, `TASKS.md`, `tasks.d/`,
`CHANGELOG.md`, `changelog.d/`, scripts, branch names, commit messages or PR text. Use neutral references
(`Test Movie A`, `Sample Series 1`, "a 4K Dolby Vision remux at about 64 Mbps", "a test series with three seasons").
Likewise never commit real posters, backdrops, stills, album art, cast photos, video clips or screenshots that show
real titles or artwork; generate placeholders instead (solid colours, gradients, procedural art). Openly licensed
demo media that the product genuinely needs is the only exception and must be justified where it is used.
That exception covers the public screenshots (README, `site/`, Play listing): they show the openly licensed
open-movie demo library with attribution, never the parity fixture. Produce them only with `scripts/showcase`
(see `clients/android/fastlane/README.md`); `scripts/ci/check-public-screenshots.sh` enforces it. Keep the film
names out of code, tests, fragments, commits and PR text, except for the attribution in the README
"Third-party media" section and the showcase catalogue under `scripts/showcase`.
Do not keep a list of forbidden titles in the repository: such a list would itself leak them.

## Delivery

- Do not leave completed work only in the working tree. Commit and push each logical change as
  soon as its relevant validation passes.
- Never add a `Co-authored-by:` trailer (for example "Co-authored-by: Claude ...") to any commit,
  squash message or PR merge body. Commits are authored by Thomas McFarlane alone. CI
  (`scripts/ci/check-no-coauthor.sh`) fails a PR that contains one.
- Keep commits small and atomic: one intent per commit, with its directly related tests,
  documentation, generated contracts, and migration files.
- Use Conventional Commits in the form `type(scope): imperative summary`. Prefer `feat`, `fix`,
  `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or `chore`; keep the subject concise and do
  not end it with a full stop.
- Push each completed commit to the current branch's configured upstream. Never force-push unless
  the user explicitly requests it.
- Before and after every push, verify the branch, upstream, and repository status. Report the real
  pushed commit hash rather than assuming the push succeeded.

## Deployment configuration (this repository is public)

- Never commit environment data: real hostnames or domains, node names, LAN, tailnet or public
  host addresses, hostPaths, registry hosts, image pins, cluster Secret names or personal paths.
  Use placeholders in code, tests and docs (`example.com`, `<node>`, RFC 5737 addresses such as
  `203.0.113.10`, `/srv/...`). `scripts/ci/check-env-data.sh` enforces this in CI; genuinely
  generic IPv4 examples go in `scripts/ci/env-data-allowlist.txt`.
- Kubernetes manifests and Helm charts here are generic templates with neutral defaults
  (`infra/kubernetes/helm/playarr-dev` renders nothing on its own; its README lists the values).
  Deployment of the server (values, image pins, rollouts) is out of scope of this repository.
- The `regional-image` workflow publishes `ghcr.io/<owner>/playarr:<sha8>` for each
  `main` commit. Consumers pin an image tag in their own deployment configuration; never move a
  pin to an older image.

## Runners

This repository is public: every workflow job runs on a GitHub-hosted runner (`ubuntu-latest`,
`windows-latest` or `macos-latest`). Never add a self-hosted runner, a runner group or a
`runs-on` expression. `scripts/ci/check-hosted-runners.sh` enforces this in CI.

## Merging

PRs target `integration/parity`; the coordinator batches `integration/parity` into `main` with a merge commit
once `ci-required` is green. Agents do not merge, and there is no `ready` label.

## Changelog

- **Do not edit `CHANGELOG.md` in a PR** (it is a merge-conflict hotspot; CI rejects such PRs).
  Add one fragment file per change under `changelog.d/`, named `<slug>.<category>.md`
  (categories: added, changed, fixed, removed, security, deprecated, documentation, performance,
  testing), containing one or more `- ...` bullets. The `Fold board` workflow folds fragments into
  `## [Unreleased]` and deletes them after they land on `main`. See `changelog.d/README.md`.
- Include user-visible behaviour, fixes, security changes, operational changes, tests,
  documentation, generated contracts, and developer workflow changes.
- A change whose only purpose is to maintain the changelog or task board does not need to describe itself.

## Task tracking

- `TASKS.md` stays the live board, in the canonical "epic table" format: one `## <N>. <Epic name>` heading per epic (N unique and stable: never renumbered or reused;
  a new epic takes the highest + 1) and one table per epic with the header `| ID | Task | Status | Owner | Branch | Depends | ETA | Notes |`.
  Status is one of `todo`, `in_progress`, `in_review`, `blocked`, `blocked_on_owner`, `parked`, `done`. **Do not
  edit it directly in a PR** (CI rejects that). Add or update rows with fragment files
  `tasks.d/<row-number>.md` (a `section:` line, the bare epic name or `N. Name`, plus the complete eight-column row; an existing row
  number replaces that row in place and keeps its epic; `section:` must name a current epic heading
  (old names are aliased, an unknown one fails `--check`); `section-new: <name>` creates an epic on purpose, numbered highest + 1). The `Fold board` workflow folds them into `TASKS.md` after they land on `main`.
  Use only the row number the coordinator gives you; never pick or reuse one. `--check` fails when a fragment's title
  differs materially from the existing row with that number (a different task reusing it); `retitle: true` allows a deliberate rename.
  See `tasks.d/README.md`. Validate fragments and the board format with
  `node scripts/fold-fragments.mjs --check`.
- A task's reference is `<epic>.<task>` (for example `3.9926`; the ID column keeps the bare ID). Agents name
  tasks by reference everywhere: Depends (comma-separated, each resolving to a row), Notes, commit messages,
  PR titles and bodies, chat and reports.
- Every `in_progress` and `in_review` row carries an ETA (`YYYY-MM-DD HH:MM ICT`; the board zone is
  ICT, Asia/Bangkok; for `in_review` it is the expected merge). `fold-fragments.mjs --check` fails on a
  missing ETA and warns on a past one: revise it as soon as it slips. Work nobody is doing is `todo`
  (Owner empty), `blocked`, `blocked_on_owner` or `parked`, never a stale `in_progress`. The board mod computes
  the epic ETA itself; do not add ETA lines under headings.
- The `Fold board` workflow (`fold-board.yml`, `scripts/fold-main.sh`) folds any pending fragments on every
  push to `main`, committing with a `Merge-Train: yes` trailer (exempt in `check-fragments.sh`) and the deploy key. Fragments never sit unfolded for long.
- When a PR merges, the `Board sync` workflow (`scripts/board-sync.mjs`) folds fragments straight onto `main`
  (Actions may not open PRs here) that flip rows naming it from `in_review` (or `in_progress` with "PR open" in Notes)
  to `done` with "PR #n merged <date>" appended to Notes, or to `in_progress` while other listed PRs
  are open. A fragment with status `in_review` must name its PR number in Notes (`PR open: #123`);
  `fold-fragments.mjs --check` enforces it.
- Work in other repositories (for example Dubarr) is not tracked on this board; remove such rows
  with a `remove: <row-number>` fragment.
- Add every newly discovered unit of work as a task row (fragment) immediately, using the numbered
  MC3-style table pattern. Do not leave blockers, follow-up work, or acceptance gaps only in chat,
  logs, or hand-off notes.
- Update each active row's status, owner, notes, and concrete evidence as work starts, progresses,
  becomes blocked, or completes. Keep the board current during the work rather than reconciling it
  only at the end.
- Every new owner requirement or bug must get a task row in the same PR that starts the work.
  The coordinator logs requirements passed verbally (chat, calls, hand-offs) as rows straight away,
  so nothing exists only in conversation.
- Any agent working in this repository must read and maintain the board; when delegating work,
  include the relevant task reference (`<epic>.<task>`) and require status/evidence to be returned for the board.

## Safety before committing or pushing

- Inspect the complete staged diff with `git diff --cached` and run `git diff --cached --check`.
- Scan every staged change with `gitleaks git --staged --redact`.
- Never commit secrets, credentials, tokens, private keys, personal data, local databases,
  downloaded models, caches, browser-automation state, build outputs, or environment-specific
  scratch files.
- Use placeholders in examples and documentation. Do not publish private hosts, private media
  identifiers, personal absolute paths, or real account details.
- If a safety check finds a possible exposure, stop and remove or sanitise it before committing.

## Validation

- Run the narrowest relevant checks before each commit, then run the repository's broader
  validation before the final push.
- Do not claim a test passed unless its command completed successfully in the current worktree.
- Preserve unrelated user changes and never use destructive Git cleanup commands to make a commit
  easier.

## Scrolling and directional navigation

- Use a real browser scroll container (`overflow: auto` or an axis-specific equivalent) for every
  viewport that can overflow. Do not make content reachable only through focus-driven or
  arrow-driven JavaScript scrolling; mouse wheels, scrollbars, touch dragging, and trackpads must
  work without focus.
- Mark shared and nested scroll viewports with `data-tv-scroll-container`, their
  `data-tv-scroll-axis`, and a stable `data-navigation-scroll-key` when their position must be
  restored. Fullscreen surfaces may lock the page root only when every overflowing panel owns a
  native scroll viewport.
- In spatial navigation, single-line text inputs must release ArrowUp and ArrowDown so focus can
  leave the field after an on-screen keyboard closes. Preserve Left and Right for caret movement,
  and preserve native arrow behaviour for textareas, selects, number inputs, and range inputs.
- Add regression coverage whenever the shared scroll-root or form-control arrow policy changes.

## React — prefer derived state over effects

Follow [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect). This is a
performance rule as well as a correctness rule: every `useEffect` → `setState` pair is an extra
render (and under TV remote navigation, often a long task).

- If a value can be computed from props or existing state, **derive it during render** (or with
  `useMemo` when expensive). Do not store it in `useState` and sync it from an effect.
- `useEffect` is for **synchronising with external systems** only (network, subscriptions, DOM
  measurement APIs, timers, imperative third-party widgets). It is not for chaining React state.
- Event handlers (and focus/scroll handlers), not effects, should drive state that changes because
  the user did something.
- When props reset local UI (e.g. route `kind` changes), adjust state **during render** with the
  “store previous prop” pattern, or remount with `key={...}`. Do not `useEffect(() => setX(...), [prop])`.
- Prefer one source of truth (focused index, selected id, filter) and derive windows, labels,
  “is-selected”, empty/loading flags, and secondary chrome from it.
- Reach for `useEffect` only after ruling out: derived value, `useMemo`, event handler, `key` reset,
  or lifting state up.
