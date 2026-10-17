# Releasing Playarr

One workflow, `.github/workflows/release.yml` (Actions > **Release**), releases every app from a
single trigger and publishes one GitHub Release `v<version>`.

## Cutting a release

1. In a PR, bump the version that is committed in the tree and merge it through the merge train:
   - `backend/Cargo.toml` (`[package]` and `[workspace.package]`), `backend/Cargo.lock` (the
     `playarr-*` entries) and `[server] version` in `backend/config/client-compatibility.toml`;
   - `clients/android/version.properties`;
   - the Google Play notes `clients/android/fastlane/metadata/android/{en-GB,en-US}/changelogs/<version>.txt`
     (1 to 500 characters).
2. Run **Release** on `main` with `version` = `X.Y.Z`; the run creates the `vX.Y.Z` tag together with
   the release. There is no tag trigger: the signing environments admit only `main`. Use `dry_run` first
   if anything in the release path changed: it builds and signs everything but pushes no image,
   creates no release and uploads nothing to a store.

The version must be newer than the latest `v*` release and must not exist yet. Release version tags are
applied by the multi-arch server publisher; the regional publisher uses immutable commit SHA tags.

## What it does

Three stages: (1) fast tests (backend, Linux phone, Fire TV, tv-web; the other clients test inside their
build jobs), (2) signed builds of every client plus the GitHub Release, (3) store uploads. Fire TV (Vega)
and Sailfish are not built (see Variants below). All Ubuntu jobs use `ubuntu-24.04`, not `ubuntu-latest`.

| Job | Workflow | Output |
|---|---|---|
| Server | `backend-release.yml` | `playarr-server-<version>-linux-{amd64,arm64}.tar.gz` (+ `.sha256`), `playarr-server-<version>-SHA256SUMS`, `latest.json`; image `ghcr.io/<owner>/playarr:<version>` and `:latest` |
| Regional image | `regional-image.yml` | `ghcr.io/<owner>/playarr:<sha8>` |
| Android APK | `android-ci.yml` | signed sideload `playarr-android.apk` and its update manifest `playarr-android.json`; the release also carries `playarr-android-<version>.apk` |
| TV packages | `tv-web-ci.yml` | `playarr-webos-<version>.ipk`, `playarr-tizen-<version>-unsigned.zip` (Tizen package root; a `.wgt` needs the owner's Samsung certificate profile); the release also carries them as `playarr-lg-webos-<version>.ipk` and `playarr-samsung-tizen-web-<version>-unsigned.zip` |
| Samsung Tizen native | inline (`tizen-native`) | `playarr-samsung-tizen-native-<version>.tpk`, test-signed with the Tizen SDK certificate (no Samsung signing secret exists) |
| Web (playarr.app) | `web-ci.yml` | the web client and Worker deployed from the release commit, after the GitHub Release exists; a failed deploy fails the release and the summary reports the version and commit (the post-merge auto-deploy of every `main` merge stays on as well) |
| Roku | inline | `playarr-roku-<version>.zip` (sideload channel) |
| Xbox | `xbox-ci.yml` | `playarr-xbox-<version>-x64-unsigned.appx` (no signing certificate yet) |
| HarmonyOS | `harmony-ci.yml` | `playarr-harmony-<version>-unsigned.hap` (no AppGallery signing material yet) |
| Linux phone | inline | `playarr-linux-<version>-x86_64.tar.gz`, also released as `playarr-linux-phone-<version>-x86_64.tar.gz` |
| macOS | inline | `playarr-macos-<version>-unsigned.zip` (no Developer ID yet) |
| Stores | inline (`stores`) | Roku, Samsung, LG, Huawei AppGallery, Microsoft Partner Center, Amazon Appstore: one job each that logs "store pending: no account yet (board 59.x)" and succeeds. When a store is wired, add its `release-<store>` environment, credential secret and upload step together. Skipped in a dry run |
| GitHub Release | inline | release `v<version>` with every package above, `clients.json`, a combined `SHA256SUMS` and `playarr-<version>-CHANGELOG.md` |
| Google Play | `android-play-internal.yml` | closed-testing (alpha) track, after the release exists |
| TestFlight | `ios-release.yml` | iOS and tvOS builds, after the release exists; then each build is added to the external TestFlight groups (below) |
| Summary | inline | per-platform result table in the run summary |

## Variants and `clients.json`

Every client variant has its own entry in `scripts/release/variants.json` (id, family, name, minimum OS,
route, asset name template, store URL, note). The release job fills in the version, checks that each
download asset exists in the release directory and attaches the result as `clients.json`
(`{version, published_at, variants[]}`); a dry run keeps it as the `clients-json` workflow artefact. A
download whose file is missing (an optional platform failed to build) is listed as `pending`. Asset names
follow `playarr-<variant>-<version>[-<arch>][-unsigned].<ext>`; the older names (`playarr-android.apk` and
`.json` for the updater, `playarr-webos-<version>.ipk`, `playarr-roku-<version>.zip`, the Tizen zip and the
Linux tarball) stay beside the new ones because the downloads Worker and the Android updater read them.
Change a minimum OS in the JSON file only; `node --test scripts/release/` checks it.

| Variant | Route | Asset or store |
|---|---|---|
| Samsung Tizen (web) | download | `playarr-samsung-tizen-web-<version>-unsigned.zip` |
| Samsung Tizen (native) | download | `playarr-samsung-tizen-native-<version>.tpk` |
| LG webOS | download | `playarr-lg-webos-<version>.ipk` |
| Hisense VIDAA | hosted | hosted Web App, no package |
| Roku | download | `playarr-roku-<version>.zip` |
| Fire TV (Vega OS 1.2) | pending | the Vega SDK needs an Amazon developer account and Docker |
| Fire OS / Android TV | download | `playarr-android-<version>.apk` |
| Android phone and tablet | download | `playarr-android-<version>.apk` |
| Android (Google Play) | store | closed testing |
| iOS, iPadOS, Apple TV | testflight | TestFlight |
| macOS 14 | download | `playarr-macos-<version>-unsigned.zip` |
| Xbox | download | `playarr-xbox-<version>-x64-unsigned.appx` |
| HarmonyOS 5.0 | download | `playarr-harmony-<version>-unsigned.hap` |
| Linux phone | download | `playarr-linux-phone-<version>-x86_64.tar.gz` |
| Sailfish OS | pending | the SDK target build is unproven on a hosted runner |
| Web | web | https://playarr.app |

### Android APK from main

Every push to `main` also builds a signed sideload APK in `ci.yml` (job `android-apk`, environment
`release-android`) and uploads it as the workflow artefact `playarr-android-main-<version>-main.<commits>`
(the APK, `SHA256SUMS` and `playarr-android-main.json`; kept 30 days). It is for testers and is never
published to Google Play or a GitHub Release. The versionName is `<version.properties>-main.<commit count>`
and the versionCode is `(major*1e4 + minor*1e2 + patch)*1e5 + commit count`, the Google Play formula, so it
rises with every commit and is above every release (`scripts/ci/android-main-version.sh`). It installs over a
release without uninstalling; a later release APK has a lower versionCode than a main build, so going back to
a release needs an uninstall. Pull requests do not run this job (they cannot read the signing secrets);
`android-check` covers them, affected-only.

The server and the Android APK are required: without them no release is created. Any other platform
that fails is left out of the release and marked in the summary. VIDAA uses the hosted Web App
(`docs/clients/vidaa.md`), so it has no package. The per-platform workflows still run on their own
tags (`backend-v*`, `android-v*`, `ios-v*`, `harmony-v*`, `xbox-v*`, `tv-web-v*`) when a single
platform needs a release of its own.

Release notes come from `scripts/release-notes.mjs`: the `## [Unreleased]` entries of `CHANGELOG.md`
that were not already there at the previous `v*` tag. The GitHub Release body is a short summary
(`--summary`: a few entries per category, a count of the rest, and the artefact table); the full notes
are attached to the release as `playarr-<version>-CHANGELOG.md`, which keeps the body inside GitHub's
125,000-character limit.

## External TestFlight groups

App Store Connect cannot auto-distribute to external groups, so after each upload `ios-release.yml`
runs `clients/ios/scripts/asc_distribute_testflight.py`. iOS and tvOS share one App Store Connect app
record, so one group receives both platforms' builds. The group ids live in the repository variable
`TESTFLIGHT_EXTERNAL_GROUP_IDS` (comma-separated; add an id to add a group, nothing is committed). For
each platform the script waits for the build to process, answers export compliance to match
`ITSAppUsesNonExemptEncryption` when the build has no answer, creates the en-US "What to Test" notes from
the Google Play release notes for the version, adds the build to each group and submits it for beta app
review (an "already submitted" reply is fine). A dry run only logs the calls it would make. A failure is a
warning and a line under "External TestFlight groups" in the release summary; it never fails the
uploaded build. It never submits an App Store version for review.

## Version numbers

| Platform | Version | Build number |
|---|---|---|
| Server, webOS, Tizen, Roku, Xbox, HarmonyOS | `X.Y.Z` | Roku `build_version` = patch; Xbox `X.Y.Z.0`; HarmonyOS `versionCode` = 1000000 + X·10⁶ + Y·10³ + Z |
| Android sideload (`io.playarr.mobile`) | `X.Y.Z` | `versionCode` = X·10⁶ + Y·10³ + Z |
| Google Play (`app.playarr.mobile`) | `X.Y.Z` | `versionCode` = (X·10⁴ + Y·10² + Z)·10⁵ + commit count, so it stays above the per-commit builds `main` publishes |
| iOS and tvOS | `X.Y.Z` | `<commit count>.<run attempt>`, above every earlier TestFlight build |

## Downloads

`https://playarr.app/downloads/...` (the Worker, `clients/tv-web/web/worker.js`) serves every client
download from GitHub Releases only; see the table in `docs/deployment/playarr-cloudflare.md`.

## Credentials

Signing material lives in the `release-android` and `release-ios` environments, whose deployment
policies admit `main` (and the per-platform tags). Images and the release use the run's `GITHUB_TOKEN`. Container
packages created by this repository's workflows are linked to it and public.
