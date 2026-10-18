#!/usr/bin/env bash
# preview.sh build|run <tv|phone>: the HarmonyOS Previewer of the public SDK on hosted runners (build: Linux, run: macOS).
#  build: copies clients/harmony to $WORK/app, applies the preview-only overlay (never committed) and runs hvigor PreviewBuild.
#  run:   starts the bridge (harmony_vnc.py: frames, keys, routes on 127.0.0.1:$CTL) and the darwin Previewer; needs SDK_MAC_DIR.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_SRC=$(cd "$HERE/../../clients/harmony" && pwd)
WORK=${WORK:-$RUNNER_TEMP/harmony-wall}
CACHE=${OHOS_SDK_CACHE:-$HOME/.cache/ohos-sdk}
DEVICE=${2:-tv}
case $DEVICE in
  tv) CTL=40017; WS=40007; DBG=40027; DEV_ARGS=(-device tv -sd 160 -or 1920 1080 -cr 1920 1080 -o landscape) ;;
  phone) CTL=40117; WS=40107; DBG=40127; DEV_ARGS=(-device phone -sd 480 -or 1080 2340 -cr 1080 2340 -o portrait) ;;
  *) echo "device must be tv or phone" >&2; exit 2 ;;
esac
if [ "$1" = build ]; then
  # shellcheck disable=SC1091
  source "$CACHE/env.sh"
  DEFAULT_SDK="$DEVECO_SDK_HOME/default"
fi
I="$WORK/app/entry/.preview/default/intermediates"

build() {
  rm -rf "$WORK/app"; mkdir -p "$WORK"; cp -R "$APP_SRC" "$WORK/app"; cd "$WORK/app"
  cp -R "$HERE/overlay/." entry/
  if [ "$DEVICE" = phone ]; then sed -i "s/'deviceType': 'tv'/'deviceType': 'phone'/; s/Previewer TV/Previewer Phone/" entry/src/mock/deviceinfo.mock.ets; fi
  python3 "$HERE/patch_index.py" entry/src/main/ets/pages/Index.ets
  python3 "$HERE/patch_prefs.py" entry/src/main/ets/auth/SettingsStore.ets
  python3 "$HERE/patch_theme.py" entry/src/main/ets/pages/Profiles.ets
  python3 "$HERE/patch_language.py" entry/src/main/ets/AppContainer.ets "${PREVIEW_LANGUAGE:-en}"
  if [ "$DEVICE" = phone ]; then python3 "$HERE/patch_drawer.py" entry/src/main/ets/design/components/Drawer.ets; fi
  python3 "$HERE/patch_pairing.py" entry/src/main/ets/pages/Pairing.ets
  python3 "$HERE/patch_route.py" entry/src/main/ets/pages/Index.ets "$CTL"
  python3 "$HERE/patch_state.py" entry/src/main/ets
  [ "${RAIL_PATCH:-yes}" = no ] || python3 "$HERE/patch_rail.py" entry/src/main/ets/design/components/MediaRail.ets
  python3 "$HERE/patch_artwork.py" entry/src/main/ets/data/ArtworkRepository.ets "$CTL"
  python3 "$HERE/patch_http.py" entry/src/main/ets/net/HttpTransport.ets entry/src/main/ets/data/ArtworkRepository.ets entry/src/main/ets/util/PreviewState.ets
  sed -i "s/PREVIEW_PORT: number = 40017/PREVIEW_PORT: number = $CTL/" entry/src/main/ets/util/PreviewState.ets
  python3 -c "import json;p='entry/src/main/resources/base/profile/main_pages.json';d=json.load(open(p));d['src'].append('pages/PreviewBoot');json.dump(d,open(p,'w'),indent=2)"
  ohpm install --all
  # PreviewBuild keeps watching after it succeeds: stop it once it reports the result.
  hvigorw --mode module -p module=entry@default -p product=default -p previewMode=true -p buildRoot=.preview --no-daemon PreviewBuild > "$WORK/hvigor.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 600); do grep -q -E "BUILD (SUCCESSFUL|FAILED)" "$WORK/hvigor.log" && break; sleep 1; done
  kill "$pid" 2>/dev/null || true
  pkill -f "[h]vigor.*$WORK/app" 2>/dev/null || true # hvigor workers outlive the wrapper
  grep -E -A2 "ERROR|BUILD|Error Message" "$WORK/hvigor.log" | tail -30 || true
  grep -q "BUILD SUCCESSFUL" "$WORK/hvigor.log"
  mkdir -p "$I/loader_out/default/ets/apiMock"
  cp "$DEFAULT_SDK/hms/previewer/apiMock/jsMockHmos.abc" "$I/loader_out/default/ets/apiMock/"
  rm -rf "$WORK/hms-previewer"; cp -R "$DEFAULT_SDK/hms/previewer" "$WORK/hms-previewer"
}

run() {
  # Linux cannot render Stage apps (run 38146946225): debug mode logs "Linux is not supported" and normal mode segfaults in
  # librender_service_client. So this runs on macOS with the public SDK's darwin-x64 Previewer (SDK_MAC_DIR), on the build
  # that the Linux job made (WORK/app/entry/.preview, WORK/hms-previewer).
  local bin="$SDK_MAC_DIR/previewer/common/bin" I="$WORK/app/entry/.preview/default/intermediates"
  cp "$HERE/harmony_vnc.py" "$HERE/../sim-vnc/sim_vnc.py" "$WORK/"
  PLAYARR_VNC_PASSWORD=selftest1 python3 "$WORK/harmony_vnc.py" --bind 127.0.0.1 --port "$((5900 + CTL % 100))" --ws "$WS" --ctl "$CTL" \
    --debug-port "$DBG" --cmd-name "playarr_cmd_$DEVICE" --password-env PLAYARR_VNC_PASSWORD > "$WORK/bridge-$DEVICE.log" 2>&1 &
  cd "$bin"
  ./Previewer -refresh full -sm dynamic -projectID playarrharmony -ts playarr_trace -j "$I/loader_out/default/ets" \
    -s "playarr_cmd_$DEVICE" -cpm false -shape rect "${DEV_ARGS[@]}" -n entry -av ACE_2_0 \
    -url pages/Index -d -p "$DBG" -pages main_pages -arp "$I/res/default" -pm Stage -hsp "$WORK/hms-previewer/systemHsp" \
    -l en_GB -cm dark -lws "$WS" -ljPath "$I/loader/default/loader.json" -abp ets/entryability/EntryAbility -abn EntryAbility \
    -staticCard false -foldable false -bn io.playarr.harmony -srmPath "$I/router_map/default/router_map.json" > "$WORK/previewer-$DEVICE.log" 2>&1 &
  echo "started: bridge control on 127.0.0.1:$CTL, logs in $WORK"
}

"$1"
