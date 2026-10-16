# Shared settings for scripts/fixtures/*.sh. Source it; do not execute it.
FIX_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_REPO_ROOT="$(cd "${FIX_SCRIPT_DIR}/../.." && pwd)"

# Everything the environment writes lives under one directory (git-ignored).
FIX_DIR="${PLAYARR_FIXTURE_DIR:-${FIX_REPO_ROOT}/.fixtures}"
FIX_PORT="${PLAYARR_FIXTURE_PORT:-18484}"
FIX_BIND="${PLAYARR_FIXTURE_BIND:-127.0.0.1}"
FIX_URL=""
if [[ -n "${PLAYARR_TEST_SERVER_URL:-}" ]]; then
  FIX_SERVER_DATA="$(node --input-type=module - "$PLAYARR_TEST_SERVER_URL" <<'NODE'
import { isIP } from "node:net";
const value = process.argv[2];
let url;
try { url = new URL(value); } catch { process.exit(2); }
const host = url.hostname.replace(/^\[|\]$/g, "");
const ipVersion = isIP(host);
const loopback = (ipVersion === 4 && Number(host.split(".")[0]) === 127) || (ipVersion === 6 && host === "::1");
if (!loopback || url.protocol !== "http:" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) process.exit(2);
process.stdout.write(`${host}\n${url.port}\n${url.href.replace(/\/$/, "")}`);
NODE
  )" || { echo "fixture server URL must be a plain HTTP loopback URL with an explicit port" >&2; exit 1; }
  FIX_SERVER_PARTS=()
  while IFS= read -r FIX_SERVER_PART; do FIX_SERVER_PARTS+=("${FIX_SERVER_PART}"); done <<<"${FIX_SERVER_DATA}"
  [[ -z "${PLAYARR_FIXTURE_BIND:-}" || "${PLAYARR_FIXTURE_BIND}" == "${FIX_SERVER_PARTS[0]}" ]] || { echo "PLAYARR_FIXTURE_BIND must match PLAYARR_TEST_SERVER_URL" >&2; exit 1; }
  [[ -z "${PLAYARR_FIXTURE_PORT:-}" || "${PLAYARR_FIXTURE_PORT}" == "${FIX_SERVER_PARTS[1]}" ]] || { echo "PLAYARR_FIXTURE_PORT must match PLAYARR_TEST_SERVER_URL" >&2; exit 1; }
  FIX_BIND="${FIX_SERVER_PARTS[0]}"
  FIX_PORT="${FIX_SERVER_PARTS[1]}"
  FIX_URL="${FIX_SERVER_PARTS[2]}"
fi
FIX_STUB_PORT="${PLAYARR_FIXTURE_STUB_PORT:-18490}"
FIX_METRICS_PORT="${PLAYARR_FIXTURE_METRICS_PORT:-18491}"
# Fixture-only credentials: public on purpose, the server only holds placeholders.
FIX_STUB_KEY="fixture-stub-key"
FIX_JWT_SECRET="fixture-jwt-secret-not-for-production-0123456789"

FIX_MEDIA_DIR="${FIX_DIR}/media"
FIX_DATA_DIR="${FIX_DIR}/data"
FIX_LOG_DIR="${FIX_DIR}/logs"
FIX_RUN_DIR="${FIX_DIR}/run"
