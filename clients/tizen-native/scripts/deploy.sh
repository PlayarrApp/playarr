#!/usr/bin/env bash
# Build the tpk signed with the Samsung profile, install it on a Tizen TV emulator or device and launch it.
# Usage: PLAYARR_TIZEN_CERT_DIR=<dir with author.p12 + distributor.p12> PLAYARR_TIZEN_SECRETS=<file with PLAYARR_TIZEN_SAMSUNG_CERT_PASSWORD=...> \
#        scripts/deploy.sh [sdb-serial]
# The password is read from the file and handed to MSBuild through the environment, never printed or put on a command line.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
serial=${1:-}
export DOTNET_CLI_TELEMETRY_OPTOUT=1
pw=$(grep '^PLAYARR_TIZEN_SAMSUNG_CERT_PASSWORD=' "${PLAYARR_TIZEN_SECRETS:?}" | head -1 | cut -d= -f2- | tr -d "'\"")
cert=${PLAYARR_TIZEN_CERT_DIR:?}
PLAYARR_TIZEN_CERT_PASS=$pw dotnet build "$here/src/Playarr.Tizen" -c Release \
  -p:AuthorPath="$cert/author.p12" -p:DistributorPath="$cert/distributor.p12" -v q -nologo ${PLAYARR_BUILD_ARGS:-} >&2
tpk=$(ls "$here"/src/Playarr.Tizen/bin/Release/net8.0-tizen10.0/*.tpk)
sdb=${SDB:-sdb}; [ -n "$serial" ] && sdb="$sdb -s $serial"
$sdb install "$tpk"
${TIZEN:-tizen} run -p tv.playarr.native ${serial:+-s "$serial"}
