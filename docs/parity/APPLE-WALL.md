# Hosted Apple wall

The Apple devices of the device wall (Apple TV, iPhone, iPad and the macOS app) can run on GitHub-hosted macOS runners
instead of a developer's Mac: `.github/workflows/apple-wall.yml`. Each device is one job. It builds the app from the chosen
ref, boots a simulator (the macOS app runs invisible), signs in as the device test account on the "Device Test" profile,
captures the parity screens in dark and light, uploads them as an artifact, and, with `stream=true`, serves the
simulator over VNC on an ephemeral, tagged tailnet node until the run ends.

This is a long-running stream on hosted runners, which goes beyond what GitHub Actions is meant for (building and
testing). The repository owner has decided to use it anyway. Runs are never self-hosted.

## Run it

Actions > Apple wall > Run workflow, or `gh workflow run apple-wall.yml -f devices=tvos -f stream=false`.

| Input | Meaning |
| --- | --- |
| `devices` | `tvos`, `iphone`, `ipad`, `macos`, comma separated |
| `ref` | branch, tag or SHA of the apps (default: the default branch) |
| `capture` | run the parity captures and upload them (default on) |
| `stream` | join the tailnet and stream until the run ends (default off) |
| `chain` | while streaming, start the next run before this one ends (default on) |
| `length` | minutes the run lasts, 1 to 345 (default: 345 minus a per-device offset of 0, 30, 60, 90 minutes) |

Captures: the artifact `apple-wall-<device>-<run id>` holds `dark/<screen>.png`, `light/<screen>.png` and `build.json`
(`branch`, `sha`, `pr`, `captured_at`). A run that cannot sign in, or whose frames are empty or all identical, uploads
nothing. Until an Apple driver for the shared suite (`scripts/parity/drivers/apple-sim.mjs`, `docs/parity/SUITE.md`)
exists in the default branch, the run captures only the screens the apps can open by route (Home, Movies, Series, Music
on tvOS and macOS, Calendar, Settings, Profiles); with the driver, `dpad.json` and `playback.json` join the artifact.

## Streaming and handover

- The node is `tag:ci`, hostname `ci-wall-<device>-<run id>`, created ephemeral by a Tailscale OAuth client
  (repository secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`). The tailnet policy must let the tag accept connections only
  from the wall host on the VNC ports and reach nothing else (proposal kept with the owner's runbook).
- VNC ports: Apple TV 5904, iPhone 5911, iPad 5913, macOS 5915 (each with a health text on the next port). Passwords are
  repository secrets `PLAYARR_VNC_{TVOS,IPHONE,IPAD,MACOS}_PASSWORD`. The server binds to the node's tailnet address only.
- The wall host finds the nodes by polling the tailnet for the tag and the hostname prefix; no callback and no secret leave
  the job.
- A hosted job stops after 6 hours. A streaming run lasts at most 345 minutes and dispatches its successor 25 minutes
  before it ends (`GITHUB_TOKEN` dispatch is allowed), so the new node is up before the old one leaves. At most one device
  hands over at a time (the offsets keep them apart) to stay under the macOS concurrency limit of the plan.

## Safety

- Triggers are `workflow_dispatch` only, never `pull_request`, so forks never receive secrets.
- Scripts that see a secret run from a checkout of the default branch (`trusted/`); the ref under test is only built.
  Secrets are set on the steps that need them, never echoed (tokens are masked).
- Actions are pinned to commit SHAs.
- The simulators and the invisible macOS window are captured, never a desktop.
