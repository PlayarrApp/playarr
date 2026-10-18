# VIDAA keepalive

`keepalive.py` replaces the old 5-minute `playarr-vidaa-watchdog` timer. It holds one MQTT client to the TV
(port 36669), queries state every 45 s, logs a wedge (TLS handshake timeout) and reconnects with backoff.
It never sends power or volume. It stands down while the `vidaa-busy` lock is held.

Log: `.data/PlayarrApp/playarr/scratch/20261017-parity-vidaa/keepalive.log`.

## Install (as the owner user)

1. Copy `keepalive.py` and `vidaa.py` together to `.data/PlayarrApp/playarr/scripts/vidaa/` (the unit runs that copy; keepalive imports the `vidaa.py` beside it). Re-copy both after any change here.
2. `systemctl --user disable --now playarr-vidaa-watchdog.timer`
3. Fill the placeholders: `sed -e "s#@DATA@#<path to .data/PlayarrApp/playarr>#g" -e "s#@VIDAA_HOST@#<TV address>#" playarr-vidaa-keepalive.service > ~/.config/systemd/user/playarr-vidaa-keepalive.service && systemctl --user daemon-reload`
4. `systemctl --user enable --now playarr-vidaa-keepalive.service`

Test: `python3 -m unittest test_keepalive` in this directory.
