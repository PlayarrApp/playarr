#!/usr/bin/env bash
# usage: design.sh <outdir> [theme...]   Design report capture of every Nura screen: sign in to the static server,
# capture each screen the native app has, in dark and light, at the device's native 720x1440 frame (no crop, no scoring,
# no publish) into <outdir>/<theme>/<screen>.png. Screen ids follow design-report/SCREENS-ALL.md.
# Env as run.sh: PLAYARR_NURA_SERVER, PLAYARR_PARITY_STATIC_PASSWORD, SKIP_SIGNIN=1, PLAYARR_NURA_EXPECTED_SUB;
# ONLY="a b" restricts to those screen ids.
set -euo pipefail
H=$(cd -- "$(dirname -- "$0")" && pwd)
O=${1:?usage: design.sh <outdir> [theme...]}; shift
THEMES=${*:-dark light}
export PLAYARR_CONTROL=${PLAYARR_CONTROL:-/tmp/pa-route} PLAYARR_CAPTURE_IDENTITY_GUARD=$H/guard.sh
export PLAYARR_PARITY_CLOCK=${PLAYARR_PARITY_CLOCK:-2026-10-07T12:00:00Z}
"$H/pmfresh.sh" "$H/../../.."
FILM=ca309574-c0f4-4564-bb54-4512eab7e531 SERIES=7ab4ce97-d59e-43d6-8e03-31d4d29a5c90
if [ -z "${SKIP_SIGNIN:-}" ]; then
  PLAYARR_NURA_EXPECTED_SUB=$("$H/signin.py" | sed -n 's/^sub //p')
  export PLAYARR_NURA_EXPECTED_SUB
fi
mkdir -p "$O"
python3 -I "$H/seed-playlist.py"
# route:screen-id pairs; the app route is what the control file takes.
SCREENS="home:home movies:movies series:series music:music calendar-month:calendar-month calendar-week:calendar-week
calendar-agenda:calendar-agenda search:search search:the:search-results film:$FILM:film-detail series-detail:$SERIES:series-detail
settings:settings filters:filters profiles:profiles actions:actions downloads:downloads watchlist:watchlist requests:requests
playlists:playlists music-detail:music-detail settings-appearance:settings-appearance
settings-profile-avatar:settings-profile-avatar settings-player:settings-player settings-server:settings-server
settings-profile-lock:settings-profile-lock settings-invite:settings-invite"
want() { [ -z "${ONLY:-}" ] || [[ " $ONLY " == *" $1 "* ]]; }
for t in $THEMES; do
  mkdir -p "$O/$t"
  "$H/pmrun.sh" </dev/null; sleep 15; "$H/pmfocus.sh"
  for pair in $SCREENS; do
    id=${pair##*:}; route=${pair%:*}
    want "$id" || continue
    [ -z "${RESUME:-}" ] || [ ! -s "$O/$t/$id.png" ] || continue
    # The avatar grid is solid green art in places, which the VM-green guard cannot tell from an unpainted tile.
    green=; [ "$id" = settings-profile-avatar ] && green=true
    # The web opens a series from the Series list, so the detail page's back button reads "Back to Series".
    case $route in series-detail:*) "$H/pmssh.sh" "printf %s series > $PLAYARR_CONTROL" </dev/null; sleep 8;; esac
    for try in 1 2 3; do
      rm -f -- "$O/$t/${route//:/_}.png"
      PLAYARR_CAPTURE_GREEN_CHECK=${green:-python3 -I $H/nogreen.py} WAIT=${WAIT:-45} "$H/pmcap3.sh" "$O/$t" "theme:$t" "$route" </dev/null && break
      [ "$try" = 3 ] && { echo "capture failed: $id" >&2; exit 1; }
    done
    [ "${route//:/_}" = "$id" ] || mv -- "$O/$t/${route//:/_}.png" "$O/$t/$id.png"
  done
  # Player: its own start, paused at 2 s; once with the controls hidden (player), once with them pinned (player-controls).
  # `player` (controls hidden) is absent natively: a paused player always shows its controls (player.rs, `!playing.get()`).
  for pair in player-controls:player; do
    id=${pair%%:*}; keep=
    want "$id" || continue
    [ "$id" = player-controls ] && keep=1
    for try in 1 2 3; do
      PLAYARR_KEEP_CONTROLS=$keep PLAYARR_PARITY_PAUSE_MS=2000 "$H/pmrun.sh" </dev/null; sleep 15; "$H/pmfocus.sh"
      rm -f -- "$O/$t/player.png"
      PLAYARR_CAPTURE_GREEN_CHECK=true "$H/pmcap3.sh" "$O/$t" "theme:$t" player </dev/null || continue
      [ "$id" = player ] || mv -- "$O/$t/player.png" "$O/$t/$id.png"; break
    done
    [ -s "$O/$t/$id.png" ] || { echo "capture failed: $id" >&2; exit 1; }
  done
done
echo done > "$O/DESIGN-DONE"
