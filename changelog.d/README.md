# Changelog fragments

Do not edit `CHANGELOG.md` in a PR. Add one file per change here, named `<slug>.<category>.md`
(for example `peer-retry.fixed.md`), containing one or more `- ...` bullets. Categories: added,
changed, fixed, removed, security, deprecated, documentation, performance, testing.

The Fold board workflow folds these into `## [Unreleased]` with `scripts/fold-fragments.mjs` and deletes them.
