#!/usr/bin/env bash
# Debug build of the Tizen web package for the suite driver: the clean dist plus netlog.js (host log sink and eval channel),
# signed with a Samsung certificate, installed on the Tizen TV emulator and launched.
#   TIZEN_STAGE=<scratch dir> TIZEN_CERT_DIR=<dir with author.p12 and distributor.p12> [TIZEN_SERIAL=emulator-26111] tizen-deploy-debug.sh
# The certificate password is read from ~/.secrets (PLAYARR_TIZEN_SAMSUNG_CERT_PASSWORD) at run time. It goes into a temporary
# profiles file in a private directory that is deleted on exit; the shared profiles.xml is never touched.
# Build first: pnpm --filter @playarr-tv/app-tizen... run build. Hold the emulator lock if the emulator is shared.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dist=$here/../../../clients/tv-web/apps/tv-tizen/dist
stage=${TIZEN_STAGE:?set TIZEN_STAGE to a scratch directory}
cert=${TIZEN_CERT_DIR:?set TIZEN_CERT_DIR}
serial=${TIZEN_SERIAL:-emulator-26111}
tizen=${TIZEN_CLI:-$HOME/tizen-studio/tools/ide/bin/tizen}
secrets=${PLAYARR_TIZEN_SECRETS:-$HOME/.secrets}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
pw=$(grep '^PLAYARR_TIZEN_SAMSUNG_CERT_PASSWORD=' "$secrets" | head -1 | cut -d= -f2- | tr -d "'\"")
[ -n "$pw" ] || { echo "PLAYARR_TIZEN_SAMSUNG_CERT_PASSWORD is not set" >&2; exit 1; }
cat > "$work/profiles.xml" <<XML
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<profiles active="parity" version="3.1">
<profile name="parity">
<profileitem ca="" distributor="0" key="$cert/author.p12" password="$pw" rootca=""/>
<profileitem ca="" distributor="1" key="$cert/distributor.p12" password="$pw" rootca=""/>
<profileitem ca="" distributor="2" key="" password="" rootca=""/>
</profile>
</profiles>
XML
chmod 600 "$work/profiles.xml"
"$tizen" cli-config "profiles.path=$work/profiles.xml" >/dev/null
trap '"$tizen" cli-config "profiles.path=$HOME/tizen-studio-data/profile/profiles.xml" >/dev/null 2>&1; rm -rf "$work"' EXIT
mkdir -p "$stage/app"
rsync -a --delete "$dist/" "$stage/app/"
"$here/write-build-info.sh" "$stage/app"
cp "$here/netlog.js" "$stage/app/netlog.js"
sed -i 's#<head>#<head><script src="./netlog.js"></script>#' "$stage/app/index.html"
rm -f "$stage/Playarr.wgt"
"$tizen" package -t wgt -s parity -- "$stage/app" | tail -1
mv "$stage/app/Playarr.wgt" "$stage/Playarr.wgt"
"$tizen" install -n Playarr.wgt -s "$serial" -- "$stage" | grep -E "install (failed|completed)|reason|Installed" || true
"$tizen" run -p StrmarrTV1.Playarr -s "$serial" | tail -1
