# VIDAA keepalive and session broker

`keepalive.py` replaces the old 5-minute `playarr-vidaa-watchdog` timer. It holds one MQTT client to the TV
(port 36669), queries state every 45 s (also while the `vidaa-busy` lock is held), logs a wedge (TLS handshake
timeout) and reconnects with backoff. It never sends power or volume.

It is also the session broker. The TV leaks sessions on connection churn and then stops answering the TLS
handshake, so the `vidaa` CLI (and through it the parity driver) sends `state`, `apps`, `key`, `launch` and
`open-debug` over the Unix socket `$PLAYARR_DATA_DIR/vidaa.sock` (`VIDAA_SOCK` overrides) instead of connecting.
Only if nothing listens on the socket does the CLI open one direct session. Key sends keep at least 150 ms apart.
Other commands (`volume`, `events`, `pair`) stay direct. Protocol: `broker.py` (one JSON line each way).

Log: `.data/PlayarrApp/playarr/scratch/20261017-parity-vidaa/keepalive.log`.

## Install (as the owner user)

1. Copy `keepalive.py`, `broker.py` and `vidaa.py` together to `.data/PlayarrApp/playarr/scripts/vidaa/` (the unit runs that copy; keepalive imports the `vidaa.py` and `broker.py` beside it). Re-copy all three after any change here.
2. `systemctl --user disable --now playarr-vidaa-watchdog.timer`
3. Fill the placeholders: `sed -e "s#@DATA@#<path to .data/PlayarrApp/playarr>#g" -e "s#@VIDAA_HOST@#<TV address>#" playarr-vidaa-keepalive.service > ~/.config/systemd/user/playarr-vidaa-keepalive.service && systemctl --user daemon-reload`
4. `systemctl --user enable --now playarr-vidaa-keepalive.service`

Test: `python3 -m unittest test_keepalive test_broker` in this directory.
