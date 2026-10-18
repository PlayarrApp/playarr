# Nura (postmarketOS) parity capture scripts

Helpers for capturing the native Linux phone client (`clients/linux-mobile`) on the postmarketOS qemu VM
(`pmbootstrap` qemu-amd64, ssh on 127.0.0.1:2231, display over VNC). Run from this directory; each script resolves paths from its own location.
The VM key is read from `$PLAYARR_NURA_KEY` (default `run/pmkey` next to the scripts); see Local files.

| Script | Use |
|---|---|
| `pmsync.sh <playarr dir>` | Copy `clients/linux-mobile` and the shared avatars to the VM, then build there with `cargo build --release`. |
| `pmrun.sh` | (Re)start the app on the VM. Honours `PLAYARR_ROUTE`, `PLAYARR_CONTROL`, `PLAYARR_KEEP_CONTROLS`. |
| `nudge.sh` | Click the display's left margin and wait. `pmcap3.sh` runs it once per route before the first screenshot: after the app has sat idle for tens of seconds the VM display keeps showing the frame from before a sheet or drawer opened until an input event reaches the app (a click does it; a pointer move or key press does not). |
| `pmcap3.sh <outdir> <route>...` | Verify the signed-in device identity, send routes to an already-running app through its control file, and capture each screen only after it stabilises. Routes: see `PLAYARR_ROUTE` in the README, plus `rail-end:<n>` (focus the last card of Home rail n) and `theme:dark\|light`. |
| `nogreen.py <frame.png>` | Exit 1 when the frame holds a solid block of the VM display's green fill (an unpainted tile that stays until the guest repaints). `pmcap3.sh` runs it on every screenshot, nudges the display and recaptures instead of accepting such a frame; override with `PLAYARR_CAPTURE_GREEN_CHECK`. |
| `cap2all.sh <dark\|light> <outdir>` | Capture all 14 screens for one theme. |
| `pmcapture.sh <outdir> <dark\|light>` | Tap-driven run that also reaches `player-controls`. |
| `pmtap.sh`, `pmfocus.sh` | Tap the display; bring the app forward if Phosh shows the overview. |

`cap.sh`, `nudge.sh` and `pmcap3.sh` call `vnc.sh <vm> capture|move|click ...`, a thin wrapper around vncdotool for the VM's VNC
display. It holds the VNC address and password for your host, so it is not committed: provide your own next to
these scripts. Captures are 720x1440; crop to y 64..1410 (720x1346) before scoring against the web refs.
Run `reset-deck-canonical.mjs` (parity scratch) right before the Home capture so On deck is the canonical state.
`cap.sh <name> <out.png>` preserves the full-size capture. Scaling requires both a positive divisor and an
explicit destination: `cap.sh <name> <out.png> <scale-div> <scaled-out.png>`.

Before using `pmcap3.sh`, set `PLAYARR_CONTROL` to the isolated VM control-file path and
`PLAYARR_CAPTURE_IDENTITY_GUARD` to an executable that fails closed unless the
capture process is alive at the exact PID recorded by the isolated-session setup,
its `XDG_DATA_HOME` matches that session, and its current signed-in profile is
the authorised device-test identity. The verifier receives the route and runs
before requesting it and immediately before every screenshot. A generic
process-name search is not sufficient: it can accept another signed-in app
instance. The script fails if the guard rejects the process or identity, route
acknowledgement times out, capture or hashing fails, or the configured stability
attempts do not produce two matching image hashes. It removes any existing
`DONE` marker before validating configuration, and writes `DONE` only after all
requested captures succeed. Tests can replace the VM SSH, capture, and image-hash helpers
with `PLAYARR_NURA_SSH`, `PLAYARR_NURA_CAP`, and
`PLAYARR_CAPTURE_HASHER`; the retry and stability settings are configurable
through `PLAYARR_CAPTURE_ACK_ATTEMPTS`, `PLAYARR_CAPTURE_STABILITY_ATTEMPTS`,
and `PLAYARR_CAPTURE_STABILITY_DELAY`.

## Local files (not committed)

`run/` and `vnc.sh` hold secrets and host addresses, so they stay out of git (`run/` is ignored here).

- `run/pmkey`: the VM login key. Create it once with `ssh-keygen -t ed25519 -N '' -f run/pmkey` and append `run/pmkey.pub` to
  `~/.ssh/authorized_keys` of user `user` inside the VM (for example via `pmbootstrap chroot` on the image, or a password login
  once). Alternatively point `PLAYARR_NURA_KEY` at an existing private key. `pmssh.sh` fails with a clear message when the key is missing.
- `vnc.sh`: see above.

## Scoring and canonical state

- `score.mjs <dir> <dark|light>` scores the `<route>.png` captures in `<dir>` against the published web refs
  (`PARITY_ROOT=<parity scratch root>`, refs under `<root>/postmarketos/web`). It needs `npm ci` in `scripts/parity`.
  Captures are cropped from the 720x1440 frame to the 720x1346 ref window; the player compares its control regions only.
- `reset-deck.mjs -- <command...>` seeds the canonical On deck item (one resume item, all other progress cleared),
  runs the command, then restores the account's progress. Supply locally: `PARITY_LOCK_DIR` (scratch lock directory),
  `PARITY_CLIENT=nura`, `PLAYARR_PARITY_NURA_USERNAME` / `PLAYARR_PARITY_NURA_PASSWORD` (the device-test account) and
  `PARITY_DECK_MEDIA_FILE_ID`. Run the Home capture inside it, for example
  `node reset-deck.mjs -- ./pmcap3.sh out theme:dark home`.
- `pmrun.sh` starts the app with `PLAYARR_PARITY_CLOCK` (default: the suite fixture clock, `screens.json`), which pins
  the calendar's "today" and the timezone to UTC so the calendar matches the refs.
