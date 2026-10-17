#!/usr/bin/env bash
# usage: pmcap3.sh <outdir> <route>...; requires an explicit identity guard and control path.
set -euo pipefail

H=$(cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -lt 2 ]; then
  echo "usage: pmcap3.sh <outdir> <route>..." >&2
  exit 2
fi

O=$1
shift
mkdir -p -- "$O"
rm -f -- "$O/DONE"
CONTROL=${PLAYARR_CONTROL:-}
IDENTITY_GUARD=${PLAYARR_CAPTURE_IDENTITY_GUARD:-}
SSH=${PLAYARR_NURA_SSH:-$H/pmssh.sh}
CAP=${PLAYARR_NURA_CAP:-$H/cap.sh}
HASHER=${PLAYARR_CAPTURE_HASHER:-}
ACK_ATTEMPTS=${PLAYARR_CAPTURE_ACK_ATTEMPTS:-90}
STABILITY_ATTEMPTS=${PLAYARR_CAPTURE_STABILITY_ATTEMPTS:-8}
STABILITY_DELAY=${PLAYARR_CAPTURE_STABILITY_DELAY:-20}

if [ -z "$CONTROL" ]; then
  echo "PLAYARR_CONTROL must name the VM route-control file" >&2
  exit 2
fi
if [ -z "$IDENTITY_GUARD" ] || [ ! -x "$IDENTITY_GUARD" ]; then
  echo "PLAYARR_CAPTURE_IDENTITY_GUARD must name an executable identity verifier" >&2
  exit 2
fi
if [ ! -x "$SSH" ] || [ ! -x "$CAP" ]; then
  echo "capture SSH and capture helpers must be executable" >&2
  exit 2
fi
if ! [[ "$ACK_ATTEMPTS" =~ ^[1-9][0-9]*$ && "$STABILITY_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "acknowledgement and stability attempt counts must be positive integers" >&2
  exit 2
fi
if ! [[ "$STABILITY_DELAY" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "stability delay must be a non-negative number" >&2
  exit 2
fi

hash_image() {
  local path=$1
  if [ -n "$HASHER" ]; then
    "$HASHER" "$path"
  else
    "$H/venv/bin/python" -c 'import hashlib,sys; from PIL import Image; image=Image.open(sys.argv[1]).convert("RGB").crop((0,70,720,1410)); print(hashlib.sha256(image.tobytes()).hexdigest())' "$path"
  fi
}

quote_remote() {
  local value=$1
  value=${value//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

captures=0

for route in "$@"; do
  name=${route//:/_}
  image=$O/$name.png
  control_q=$(quote_remote "$CONTROL")
  route_q=$(quote_remote "$route")

  # The guard also verifies that the isolated capture process is alive. A
  # process-name search could accept a different signed-in app instance.
  # A route can trigger playback or expose account data, so verify before
  # requesting it as well as immediately before each screenshot.
  "$IDENTITY_GUARD" "$route" || { echo "identity verification failed for route: $route" >&2; exit 1; }
  "$SSH" "printf %s $route_q > $control_q" || { echo "failed to request route: $route" >&2; exit 1; }

  acknowledged=0
  for ((attempt=1; attempt<=ACK_ATTEMPTS; attempt++)); do
    if "$SSH" "[ ! -e $control_q ]"; then
      acknowledged=1
      break
    fi
    sleep 4
  done
  if [ "$acknowledged" -ne 1 ]; then
    echo "timed out waiting for route acknowledgement: $route" >&2
    exit 1
  fi

  wait_seconds=${WAIT:-40}
  case $route in player) wait_seconds=70;; profiles) wait_seconds=110;; theme*) wait_seconds=20;; esac
  sleep "$wait_seconds"
  case $route in
    theme*) continue ;;
  esac

  previous=
  stable=0
  for ((attempt=1; attempt<=STABILITY_ATTEMPTS; attempt++)); do
    rm -f -- "$image"
    # Verify identity immediately before each screenshot, including retries.
    "$IDENTITY_GUARD" "$route" || { echo "identity verification failed for route: $route" >&2; exit 1; }
    if ! "$CAP" postmarketos "$image" >/dev/null 2>&1 || [ ! -s "$image" ]; then
      echo "capture failed for route: $route" >&2
      exit 1
    fi
    current=$(hash_image "$image") || { echo "image hashing failed for route: $route" >&2; exit 1; }
    if [ -z "$current" ]; then
      echo "image hashing returned an empty digest for route: $route" >&2
      exit 1
    fi
    if [ "$current" = "$previous" ]; then
      stable=1
      break
    fi
    previous=$current
    if [ "$attempt" -lt "$STABILITY_ATTEMPTS" ]; then sleep "$STABILITY_DELAY"; fi
  done
  if [ "$stable" -ne 1 ]; then
    echo "capture did not stabilise for route: $route" >&2
    exit 1
  fi
  captures=$((captures + 1))
done

if [ "$captures" -eq 0 ]; then
  echo "no screen captures were requested" >&2
  exit 1
fi
echo done > "$O/DONE"
