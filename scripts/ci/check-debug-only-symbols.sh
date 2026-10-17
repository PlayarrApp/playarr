#!/usr/bin/env bash
# Fails when a DEBUG-only parity symbol is used outside an `#if DEBUG` block in app sources.
# shortcut: a line-based scan; `#if DEBUG` nested in `#if` with && or || is treated as DEBUG-only. Upgrade to a Release compile if that bites.
set -euo pipefail
cd "$(dirname "$0")/../.."
symbols='ParityLaunch|ParityDownloads|ParityPlayerHost'
defs='clients/ios/Sources/PlayarrApp/ParityLaunch.swift clients/ios/Sources/PlayarrApp/ParityDownloads.swift'
status=0
while IFS= read -r f; do
  case " $defs " in *" $f "*) continue ;; esac
  out=$(awk -v re="\\\\<($symbols)\\\\>" '
    /^[ \t]*#if/ { d++; dbg[d] = ($0 ~ /#if[ \t]+DEBUG[ \t]*($|\/\/)/) ? 1 : (dbg[d-1] + 0); next }
    /^[ \t]*#endif/ { d--; next }
    /^[ \t]*#else|^[ \t]*#elseif/ { dbg[d] = 0; next }
    $0 ~ re && !dbg[d] && $0 !~ /^[ \t]*\/\// { printf "%s:%d: %s\n", FILENAME, FNR, $0 }
  ' "$f") || true
  [ -z "$out" ] || { echo "$out"; status=1; }
done < <(git ls-files 'clients/ios/Sources/*.swift' 'clients/apple-tv/Sources/*.swift' 'clients/apple-tv/macOS/*.swift' 'clients/shared/*.swift')
[ $status -eq 0 ] || echo "error: DEBUG-only symbol used outside #if DEBUG (breaks Release builds)" >&2
exit $status
