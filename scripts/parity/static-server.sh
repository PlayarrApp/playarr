#!/usr/bin/env bash
# The static Playarr parity server: a frozen, seeded library for every parity capture (web refs and real devices).
#
#   scripts/parity/static-server.sh            # build what is missing, then serve until Ctrl-C / SIGTERM
#   scripts/parity/static-server.sh --build    # build only (pristine DB, artwork, clip, web), do not serve
#
# - The pristine DB is built from scratch by static/build-db.mjs (never a copy of a live DB) and kept untouched.
# - Every start copies it to a fresh working directory, which is deleted on exit: a run's writes never persist.
# - The backend runs from this repo, inside a memory cgroup, on the LAN address and port of parity.env, with
#   PLAYARR_STATIC=1: no arr or peer sync, relay, ACME, backups, metadata refresh or other upstream job.
# - Web client: the server-hosted build (clients/tv-web, build:server) at <url>/tv.
# Env: PARITY_STATIC_HOME (default ~/.cache/playarr-parity-static), PLAYARR_SERVER_BIN (skip the cargo build).
# Needs PLAYARR_PARITY_STATIC_PASSWORD in ~/.secrets. The password is never printed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
eval "$(node scripts/parity/parity-config.mjs --shell)"

HOME_DIR="${PARITY_STATIC_HOME:-$HOME/.cache/playarr-parity-static}"
scoped() { systemd-run --user --scope --quiet -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- "$@"; }
[[ -n "${PARITY_SERVER_HOST:-}" ]] && ip -4 -o addr show | grep -q " ${PARITY_SERVER_HOST}/" || { echo "static-server: ${PARITY_SERVER_HOST:-no LAN address} is not an address of this host (set PARITY_SERVER_HOST)" >&2; exit 1; }
mkdir -p "$HOME_DIR"

# 1. Backend binary.
BIN="${PLAYARR_SERVER_BIN:-}"
if [[ -z "$BIN" ]]; then
  (cd backend && scoped cargo build --bin playarr-server >&2)
  BIN="$(cd backend && cargo metadata --format-version 1 --no-deps | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')/debug/playarr-server"
fi
[[ -x "$BIN" ]] || { echo "static-server: backend binary not found: $BIN" >&2; exit 1; }

# 2. Web build (server-hosted, base /tv/).
WEB="$ROOT/clients/tv-web/web/dist-server"
if [[ ! -f "$WEB/index.html" ]]; then
  # The build rewrites the tracked public/build-manifest.json; restore it with git checkout when done.
  (cd clients/tv-web && scoped bash -c 'pnpm install --frozen-lockfile && pnpm --filter "./packages/**" run build && pnpm --filter "@playarr-tv/web..." run build:server') >&2
fi

# 3. Pristine DB, artwork and clip. Rebuilt when the seed, the migrations or the binary change.
STAMP="$( (git rev-parse HEAD:backend/migrations; sha1sum scripts/parity/static/build-db.mjs scripts/parity/static/catalogue.mjs scripts/parity/parity.env scripts/parity/screens.json; stat -c %Y "$BIN") | sha1sum | cut -c1-16)"
if [[ ! -f "$HOME_DIR/pristine.db" || "$(cat "$HOME_DIR/pristine.stamp" 2>/dev/null)" != "$STAMP" ]]; then
  echo "static-server: building the pristine DB" >&2
  scoped node scripts/parity/static/build-db.mjs --server-bin "$BIN" --home "$HOME_DIR" >&2
  echo "$STAMP" >"$HOME_DIR/pristine.stamp"
fi
[[ "${1:-}" == "--build" ]] && exit 0

# 4. A fresh working copy per start.
WORK="$(mktemp -d "$HOME_DIR/run.XXXXXX")"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 143' TERM INT
cp "$HOME_DIR/pristine.db" "$WORK/playarr.db"
cp -r "$WEB" "$WORK/tv"
printf '{"sha":"%s","builtAt":"%s","run":"parity-static"}\n' "$(git rev-parse HEAD)" "$PARITY_CLOCK" >"$WORK/tv/build-info.json"

node scripts/parity/static/art-server.mjs "$HOME_DIR/art" "$PARITY_ART_PORT" &
PIDS+=($!)

echo "static-server: serving $PARITY_SERVER_URL (web: $PARITY_SERVER_URL/tv, account: $PARITY_ACCOUNT_NAME, clock $PARITY_CLOCK)" >&2
# exec: $! is then the backend itself (systemd-run --scope execs the command), so cleanup stops it.
( exec systemd-run --user --scope --quiet -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- env -i PATH="$PATH" HOME="$HOME" \
  DATABASE_URL="sqlite://$WORK/playarr.db?mode=rwc" \
  PLAYARR_HTTP_BIND_ADDR="$PARITY_SERVER_HOST:$PARITY_SERVER_PORT" \
  PLAYARR_METRICS_BIND_ADDR="127.0.0.1:$((PARITY_BUILD_PORT + 1))" \
  PLAYARR_JWT_SECRET="$(openssl rand -hex 32)" \
  PLAYARR_AUTH_MODE=full-account PLAYARR_STATIC=1 PLAYARR_LANGUAGE_INDEXER=off \
  PLAYARR_ARTWORK_CACHE_DIR="$WORK/artwork" PLAYARR_TV_ASSETS_DIR="$WORK/tv" \
  PLAYARR_LOG="${PLAYARR_LOG:-info}" \
  "$BIN" ) &
PIDS+=($!)
wait "${PIDS[-1]}"
