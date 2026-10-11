#!/usr/bin/env bash
# Apple device wall on a GitHub-hosted macOS runner (.github/workflows/apple-wall.yml).
#   wall.sh <build|up|capture|stream> <tvos|iphone|ipad|macos>
# Environment: SRC (checkout of the ref under test), TRUSTED (checkout of the default branch, source of every script that sees
# a secret), WORK (scratch dir), and per command: SERVER_URL TEST_USERNAME TEST_PASSWORD (up, capture, stream), OUT and REF
# (capture), STREAM_BIND PLAYARR_VNC_PASSWORD DEADLINE DISPATCH_AT (stream). Never prints a secret or a token.
set -euo pipefail
cmd=${1:?command}; DEVICE=${2:?device}
: "${SRC:?}" "${TRUSTED:?}" "${WORK:?}"
mkdir -p "$WORK"; STATE="$WORK/state.env"
log() { echo "wall[$DEVICE]: $*"; }

case $DEVICE in # kind, vnc port (health text on port+1), bundle id
  tvos)   KIND=tvos;  PORT=5904; BUNDLE=com.playarr.playarr.tvos ;;
  iphone) KIND=ios;   PORT=5911; BUNDLE=app.playarr.ios ;;
  ipad)   KIND=ios;   PORT=5913; BUNDLE=app.playarr.ios ;;
  macos)  KIND=macos; PORT=5915; BUNDLE=app.playarr.macos ;;
  *) echo "unknown device $DEVICE" >&2; exit 2 ;;
esac
# Screen ids (legend names) and the app's own route per id. The full D-pad suite replaces this list when an Apple driver lands.
if [[ $DEVICE == iphone || $DEVICE == ipad ]]; then
  SCREENS="home:home movies:movies series:series calendar-agenda:calendar settings:settings profiles:profiles"
else
  SCREENS="home:home movies:movies series:series music:music calendar-agenda:calendar settings:settings profiles:profiles"
fi

[[ -f $STATE ]] && . "$STATE"
save() { printf '%s=%q\n' "$1" "$2" >> "$STATE"; }
app_path() { find "$WORK/dd/Build/Products" -maxdepth 2 -name "$1" -type d | head -1; }

pick_sim() { # prints "<device type id> <runtime id>"
  python3 - "$DEVICE" <<'P'
import json, subprocess, sys
dev = sys.argv[1]
j = lambda *a: json.loads(subprocess.check_output(["xcrun", "simctl", "list", *a, "-j"]))
types, runtimes = j("devicetypes")["devicetypes"], [r for r in j("runtimes")["runtimes"] if r["isAvailable"]]
ver = lambda r: [int(x) for x in r["version"].split(".")]
if dev == "tvos":
    t = [d for d in types if "Apple-TV" in d["identifier"]]
    t = next((d for d in t if "1080p" in d["name"].lower()), None) or next((d for d in t if d["name"] == "Apple TV"), t[0])
    r = sorted([x for x in runtimes if ".tvOS-" in x["identifier"]], key=ver)[-1]
elif dev == "iphone":
    t = next(d for d in types if d["name"] == "iPhone 16")
    r = sorted([x for x in runtimes if ".iOS-" in x["identifier"]], key=ver)[-1]
else:  # the iPad sim must be iOS 18 (iPadOS 26 rotation fails on the landscape wall build); newest as fallback
    t = next(d for d in types if d["name"].startswith("iPad Air 13-inch"))
    ios = sorted([x for x in runtimes if ".iOS-" in x["identifier"]], key=ver)
    r = next((x for x in reversed(ios) if ver(x)[0] == 18), None)
    if r is None: sys.exit("no iOS 18 runtime on this runner (iPadOS 26 does not rotate): iPad skipped")
print(t["identifier"], r["identifier"])
P
}

token() { # a fresh access token for the Device Test profile, masked in the log
  local t; t=$(DEVICE_NAME="wall-$DEVICE" python3 "$TRUSTED/scripts/apple-wall/login.py")
  echo "::add-mask::$t"; printf '%s' "$t"
}

shot() { # <file.png|jpg>: one frame of the device, never the desktop
  local f=$1 raw="$WORK/raw.$$.png"
  case $DEVICE in
    tvos|iphone) xcrun simctl io "$UDID" screenshot --type="${f##*.}" "$f" >/dev/null 2>&1 ;;
    ipad) xcrun simctl io "$UDID" screenshot --type=png "$raw" >/dev/null 2>&1 && sips -r 90 "$raw" --out "$f" >/dev/null 2>&1; rm -f "$raw" ;;
    macos)
      rm -f "$WORK/mac-snap.png"; "$WORK/notify" "snapshot:$WORK/mac-snap.png"
      for _ in $(seq 40); do [[ -s $WORK/mac-snap.png ]] && break; sleep 0.25; done
      [[ -s $WORK/mac-snap.png ]] && { if [[ $f == *.jpg ]]; then sips -s format jpeg -s formatOptions 80 "$WORK/mac-snap.png" --out "$f" >/dev/null 2>&1; else cp "$WORK/mac-snap.png" "$f"; fi; } ;;
  esac
  [[ -s $f ]]
}

launch() { # <theme> [route]: (re)launch the app signed in, muted, on the route (default Home)
  local theme=$1 route=${2:-home}
  case $KIND in
    tvos)
      xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
      if [[ -n ${ACCESS_TOKEN:-} ]]; then
        xcrun simctl launch "$UDID" "$BUNDLE" -PlayarrServerURL "$SERVER_URL" -PlayarrAccessToken "$ACCESS_TOKEN" -PlayarrParityRoute "$route" -PlayarrTheme "$theme" -PlayarrMuted >/dev/null
      else xcrun simctl launch "$UDID" "$BUNDLE" -PlayarrTheme "$theme" -PlayarrMuted >/dev/null; fi ;;
    ios)
      xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
      xcrun simctl ui "$UDID" appearance "$theme"
      xcrun simctl launch "$UDID" "$BUNDLE" -PlayarrMuted --playarr-parity-server "$SERVER_URL" --playarr-parity-user "$TEST_USERNAME" \
        --playarr-parity-password "$TEST_PASSWORD" --playarr-parity-route "$route" --playarr-parity-theme "$theme" \
        $([[ $DEVICE == ipad ]] && echo --playarr-parity-landscape) >/dev/null ;;
    macos)
      pkill -x PlayarrMac 2>/dev/null || true; sleep 1
      mkdir -p "$WORK/machome"
      open -n -g -j "$APP" --env CFFIXED_USER_HOME="$WORK/machome" --stdout "$WORK/app.log" --stderr "$WORK/app.log" \
        --args -PlayarrInvisible -PlayarrMuted -PlayarrTheme "$theme" -ApplePersistenceIgnoreState YES \
        -PlayarrServerURL "$SERVER_URL" -PlayarrAccessToken "${ACCESS_TOKEN:-$(token)}" -PlayarrParityRoute "$route" ;;
  esac
}

case $cmd in
build)
  case $DEVICE in
    tvos) xcodebuild build -project "$SRC/clients/apple-tv/PlayarrTV.xcodeproj" -scheme PlayarrTV -configuration Debug \
            -destination "generic/platform=tvOS Simulator" -derivedDataPath "$WORK/dd" CODE_SIGNING_ALLOWED=NO ;;
    iphone|ipad) bash "$SRC/clients/ios/scripts/prepare.sh"
          xcodebuild build -workspace "$SRC/clients/ios/Playarr.xcworkspace" -scheme PlayarrApp -configuration Debug \
            -destination "generic/platform=iOS Simulator" -derivedDataPath "$WORK/dd" CODE_SIGNING_ALLOWED=NO ;;
    macos) xcodebuild build -project "$SRC/clients/apple-tv/PlayarrTV.xcodeproj" -scheme PlayarrMac -configuration Debug \
            -destination "platform=macOS" -derivedDataPath "$WORK/dd" CODE_SIGNING_ALLOWED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES
          swiftc -O -o "$WORK/notify" "$TRUSTED/scripts/apple-wall/notify.swift" ;;
  esac ;;
up)
  : "${SERVER_URL:?}" "${TEST_USERNAME:?}" "${TEST_PASSWORD:?}"
  if [[ $KIND == macos ]]; then
    save APP "$(app_path PlayarrMac.app)"; . "$STATE"; [[ -n $APP ]] || { log "no built app"; exit 1; }
    launch dark; sleep 15
  else
    read -r type runtime < <(pick_sim); log "device type $type, runtime $runtime"
    udid=$(xcrun simctl create "Playarr wall $DEVICE" "$type" "$runtime"); save UDID "$udid"; . "$STATE"
    xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b >/dev/null
    app=$(app_path '*.app')
    if [[ $DEVICE == ipad ]]; then # full-screen copy so the app runs landscape in the iPad frame
      mkdir -p "$WORK/ipad-app"; cp -R "$app" "$WORK/ipad-app/"; app="$WORK/ipad-app/$(basename "$app")"
      /usr/libexec/PlistBuddy -c "Add :UIRequiresFullScreen bool true" "$app/Info.plist" || true; codesign -f -s - "$app" >/dev/null 2>&1 || true
    fi
    xcrun simctl install "$UDID" "$app"
    save BUNDLE "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")"; . "$STATE"
    [[ $KIND == tvos ]] && python3 "$TRUSTED/scripts/sim-vnc/seed_session.py" --udid "$UDID" --bundle "$BUNDLE"
    launch dark; sleep 25 # a fresh simulator shows system banners for a few seconds
  fi ;;
capture)
  : "${OUT:?}" "${REF:?}"
  ACCESS_TOKEN=$(token)
  rm -rf "$OUT"; mkdir -p "$OUT"
  for theme in dark light; do
    mkdir -p "$OUT/$theme"
    for pair in $SCREENS; do
      id=${pair%%:*}; route=${pair#*:}
      ACCESS_TOKEN=$ACCESS_TOKEN launch "$theme" "$route"
      sleep 14
      shot "$OUT/$theme/$id.png" || { log "no frame for $theme/$id"; rm -rf "$OUT"; exit 1; }
      [[ $(stat -f %z "$OUT/$theme/$id.png") -gt 20000 ]] || { log "$theme/$id looks empty"; rm -rf "$OUT"; exit 1; }
      log "captured $theme/$id"
    done
    [[ $(stat -f %z "$OUT/$theme/home.png") -gt 150000 ]] || { log "$theme/home.png is too plain: an error or signed-out screen"; rm -rf "$OUT"; exit 1; }
    # An app stuck on one screen (sign-in, error) gives identical frames: publish nothing then.
    [[ $(shasum "$OUT/$theme"/*.png | awk '{print $1}' | sort -u | wc -l) -ge 3 ]] || { log "$theme frames are nearly identical: not signed in or stuck"; rm -rf "$OUT"; exit 1; }
  done
  printf '{"branch":"%s","sha":"%s","pr":null,"captured_at":"%s","runner":"github-hosted"}\n' \
    "$REF" "$(git -C "$SRC" rev-parse HEAD)" "$(date -u +%FT%TZ)" > "$OUT/build.json"
  # Back to Home, dark, for the stream.
  ACCESS_TOKEN= launch dark ;;
stream)
  : "${STREAM_BIND:?}" "${PLAYARR_VNC_PASSWORD:?}" "${DEADLINE:?}"
  frame="$WORK/frame.jpg"; health="$WORK/health.txt"
  if [[ $DEVICE == tvos || $DEVICE == iphone ]]; then
    python3 "$TRUSTED/scripts/sim-vnc/sim_vnc.py" --udid "$UDID" --bind "$STREAM_BIND" --port "$PORT" --source simctl --no-keys --fps 5 \
      --metrics-file "$health" > "$WORK/vnc.log" 2>&1 &
  else
    echo "starting" > "$health"; shot "$frame"
    python3 "$TRUSTED/scripts/sim-vnc/sim_vnc.py" --bind "$STREAM_BIND" --port "$PORT" --frame-file "$frame" --fps 2 --no-keys \
      --metrics-file "$health" > "$WORK/vnc.log" 2>&1 &
  fi
  VNC=$!; sleep 3; kill -0 $VNC || { log "VNC server did not start"; tail -n 5 "$WORK/vnc.log"; exit 1; }
  log "streaming on port $PORT until $(date -u -r "$DEADLINE" +%FT%TZ)"
  dispatched=0; last_launch=$(date +%s)
  while kill -0 $VNC 2>/dev/null && [[ $(date +%s) -lt $DEADLINE ]]; do
    if [[ $DEVICE == ipad || $DEVICE == macos ]]; then
      tmp="$WORK/frame.tmp.jpg"; shot "$tmp" && mv "$tmp" "$frame"
    fi
    { echo "time $(date -u +%FT%TZ)"; echo "device $DEVICE"; } > "$health.tmp"; mv "$health.tmp" "$health"
    # Chain: start the successor run early so it is up before this one ends (6 h cap per hosted job).
    if [[ $dispatched == 0 && -n ${DISPATCH_AT:-} && $(date +%s) -ge $DISPATCH_AT ]]; then
      if bash -c "$CHAIN_CMD"; then dispatched=1; log "successor dispatched"; else log "successor dispatch failed, retrying"; DISPATCH_AT=$(( $(date +%s) + 60 )); fi
    fi
    # A signed-in token for the macOS app only lives about 15 minutes: relaunch it every 10.
    if [[ $DEVICE == macos && $(( $(date +%s) - last_launch )) -gt 600 ]]; then ACCESS_TOKEN=$(token) launch dark; last_launch=$(date +%s); sleep 15; fi
    sleep 1
  done
  kill $VNC 2>/dev/null || true; log "stream ended" ;;
*) echo "unknown command $cmd" >&2; exit 2 ;;
esac
