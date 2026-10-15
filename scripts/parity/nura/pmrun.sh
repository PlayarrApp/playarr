#!/usr/bin/env bash
# usage: [PLAYARR_ROUTE=film] [PLAYARR_SEARCH=x] pmrun.sh  (re)start the Playarr mobile app on the Nura VM; log ~/app.log
H=$(dirname "$0"); P=${PLAYARR_BROKER_PLATFORM:-linux-phone}
E="PLAYARR_BROKER_PLATFORM=$P PLAYARR_AUDIO_SINK=fakesink GSK_RENDERER=${GSK:-cairo}"
for v in PLAYARR_ROUTE PLAYARR_CONTROL PLAYARR_KEEP_CONTROLS PA_NOFADE PA_ART GTK_DEBUG PA_FILL PA_IMG; do [ -n "${!v}" ] && E="$E $v=${!v}"; done
"$H/pmssh.sh" "killall playarr-mobile 2>/dev/null; U=\$(id -u); cd ~; XDG_RUNTIME_DIR=/run/user/\$U WAYLAND_DISPLAY=wayland-0 $E setsid nohup ~/src/clients/linux-mobile/target/release/playarr-mobile > ~/app.log 2>&1 < /dev/null & sleep 2; true"
