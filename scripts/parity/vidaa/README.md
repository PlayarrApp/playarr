# VIDAA keepalive and session broker

`keepalive.py` replaces the old 5-minute `playarr-vidaa-watchdog` timer. It holds one MQTT client to the TV
(port 36669), queries state every 45 s (also while the `vidaa-busy` lock is held), logs a wedge (TLS handshake
timeout) and reconnects with backoff. It never sends power or volume.

It is also the session broker. The TV leaks sessions on connection churn and then stops answering the TLS
handshake, so the `vidaa` CLI (and through it the parity driver) sends `state`, `apps`, `key`, `launch` and
`open-debug` over the Unix socket `$PLAYARR_DATA_DIR/vidaa.sock` (`VIDAA_SOCK` overrides) instead of connecting.
Only if nothing listens on the socket does the CLI open one direct session. Key sends keep at least 150 ms apart.
While the keepalive runs (it holds `$PLAYARR_DATA_DIR/vidaa-keepalive.lock`) the CLI never opens its own session: if the socket does not answer it refuses (`VIDAA_ALLOW_DIRECT=1` overrides, for the owner). So `volume` and `events` are refused too, as a second session next to the keepalive's makes the TV freeze; `pair` is the owner's own flow. Two missed liveness checks drop the session and the reconnect backs off 15 s, 30 s, .. 300 s, reset only by a healthy check. Protocol: `broker.py` (one JSON line each way).

Log: `.data/PlayarrApp/playarr/scratch/20261017-parity-vidaa/keepalive.log`.

## Install (as the owner user)

1. Copy `keepalive.py`, `broker.py` and `vidaa.py` together to `.data/PlayarrApp/playarr/scripts/vidaa/` (the unit runs that copy; keepalive imports the `vidaa.py` and `broker.py` beside it). Re-copy all three after any change here.
2. `systemctl --user disable --now playarr-vidaa-watchdog.timer`
3. Fill the placeholders: `sed -e "s#@DATA@#<path to .data/PlayarrApp/playarr>#g" -e "s#@VIDAA_HOST@#<TV address>#" -e "s#@PARITY_SERVER_URL@#<static server URL, see parity.env>#" -e "s#@PARITY_ACCOUNT_NAME@#parity#" playarr-vidaa-keepalive.service > ~/.config/systemd/user/playarr-vidaa-keepalive.service && systemctl --user daemon-reload`
4. `systemctl --user enable --now playarr-vidaa-keepalive.service`

The two PARITY values make the broker's account guard trust the static parity server (`scripts/parity/static-server.sh`) and its seeded account, like the node tools; leave them empty for the old Device Test account.
`receiver.py` takes the same two variables, and `vidaa open-debug --seed` (once per server change) has it log the account in and replace the TV page's saved sign-in.

Test: `python3 -m unittest test_keepalive test_broker` in this directory.
