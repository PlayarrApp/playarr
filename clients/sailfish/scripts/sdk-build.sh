#!/usr/bin/env bash
# Builds the RPM with the official Sailfish SDK Target + Tooling tarballs, unpacked once, run in an unprivileged
# bubblewrap user namespace. No Docker, no VirtualBox, no root.
#   scripts/sdk-build.sh setup <sdk-dir> [arch=i486] [release=<sfos release>]   download + unpack (needs curl, bsdtar, rsync)
#   scripts/sdk-build.sh build <sdk-dir> <out-dir> [arch=i486]            qmake + make + rpmbuild
#   scripts/sdk-build.sh test  <sdk-dir>                                  host logic tests inside the target
# arm targets: set up armv7hl/aarch64 the same way; their binaries need qemu-user to run the target's own tools,
# so build those in CI (see README) rather than here.
set -euo pipefail
cmd=${1:?setup|build|test}; sdk=$(realpath -m "${2:?sdk dir}")
here=$(cd "$(dirname "$0")/.." && pwd); repo=$(cd "$here/../.." && pwd)
rel=${REL:-5.1.0.${SFOS_BUILD:-11}}

case $cmd in
setup)
  arch=${3:-i486}; mkdir -p "$sdk/dl" "$sdk/root-$arch"
  base=https://releases.sailfishos.org/sdk/targets
  for part in Target Tooling; do
    f=Sailfish_OS-$rel-Sailfish_SDK_$part-$arch.tar.7z
    [ "$part" = Tooling ] && f=Sailfish_OS-$rel-Sailfish_SDK_Tooling-i486.tar.7z
    [ -f "$sdk/dl/$f" ] || curl -fsSL -o "$sdk/dl/$f" "$base/$f"
    curl -fsSL "$base/$f.md5sum" | awk '{print $1"  '"$sdk/dl/$f"'"}' | md5sum -c -
    mkdir -p "$sdk/x-$part"; bsdtar -xf "$sdk/dl/$f" -C "$sdk/x-$part"
    dest=$sdk/root-$arch; [ "$part" = Tooling ] && dest=$sdk/tooling
    mkdir -p "$dest"; bsdtar -xf "$sdk/x-$part"/*.tar -C "$dest" --no-same-owner --exclude './dev/*'
    rm -rf "$sdk/x-$part"
  done
  # Same release, so the tooling's compilers drop straight into the target tree.
  rsync -a --ignore-existing "$sdk/tooling/" "$sdk/root-$arch/"
  ;;
build|test)
  arch=${3:-i486}; [ "$cmd" = test ] && arch=i486; out=$(realpath -m "${3:-$sdk/out}"); [ "$cmd" = build ] && arch=${4:-i486}
  root=$sdk/root-$arch; mkdir -p "$out"
  version=$(sed -n 's/^Version: *//p' "$here/rpm/harbour-playarr.spec")
  bw=(bwrap --bind "$root" / --proc /proc --dev /dev --tmpfs /tmp --ro-bind "$repo" /repo --bind "$out" /out --uid 0 --gid 0 --setenv HOME /tmp --chdir /tmp)
  if [ "$cmd" = test ]; then
    "${bw[@]}" sh -c 'mkdir t && cd t && qmake /repo/clients/sailfish/tests/tests.pro && make -j4 && ./tst_util'
  else
    "${bw[@]}" sh -c '
      set -e
      top=/tmp/rpmbuild; mkdir -p $top/SOURCES $top/SPECS
      mkdir -p /tmp/s/harbour-playarr-'"$version"'
      t=/tmp/s/harbour-playarr-'"$version"'
      cp -r /repo/clients/sailfish/. $t/
      # Shared files live outside clients/sailfish; stage them into the source tree for the build.
      mkdir -p $t/assets/avatars $t/assets/fonts
      cp /repo/clients/shared/profile-avatars/plates/*.png $t/assets/avatars/
      cp /repo/docs/parity/fonts/NunitoSans-wght-web.ttf $t/assets/fonts/
      tar -C /tmp/s -cjf $top/SOURCES/harbour-playarr-'"$version"'.tar.bz2 harbour-playarr-'"$version"'
      cp /repo/clients/sailfish/rpm/harbour-playarr.spec $top/SPECS/
      rpmbuild -bb --define "_topdir $top" --target '"$arch"' $top/SPECS/harbour-playarr.spec
      cp $top/RPMS/*/*.rpm /out/'
  fi
  ;;
esac
