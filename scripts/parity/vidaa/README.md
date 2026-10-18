# VIDAA keepalive

`keepalive.py` replaces the old 5-minute `playarr-vidaa-watchdog` timer. It holds one MQTT client to the TV
(port 36669), queries state every 45 s, logs a wedge (TLS handshake timeout) and reconnects with backoff.
It never sends power or volume. It stands down while the `vidaa-busy` lock is held.

Log: `.data/PlayarrApp/playarr/scratch/20261017-parity-vidaa/keepalive.log`.

## Install (as the owner user)

1. Copy `keepalive.py` to `.data/PlayarrApp/playarr/scripts/vidaa/` (next to `vidaa.py`, which it imports; the unit runs it from there).
2. `systemctl --user disable --now playarr-vidaa-watchdog.timer`
3. `cp playarr-vidaa-keepalive.service ~/.config/systemd/user/ && systemctl --user daemon-reload`
4. `systemctl --user enable --now playarr-vidaa-keepalive.service`

Test: `python3 -m unittest test_keepalive` in this directory.
