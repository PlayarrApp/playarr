#!/usr/bin/env bash
# Publishes a finished webOS or Tizen web run into the legend candidate directory, exactly as the run's captures.json describes it.
#   publish.sh <cand dir> <run dir> <pr number> [branch]
# Env: PARITY_LEGEND_DIR (the legend directory holding update.mjs; required).
# - every capture goes to the path captures.json names (dark/<id>.png, light/<id>.png), layout documents and dpad.json beside them;
# - build.json takes its sha from captures.json provenance.build (the build that was captured), never from the checkout or the publisher;
# - `node update.mjs` runs in the legend directory afterwards and the publish fails when it prints a "skip <cand>" line for this candidate.
set -euo pipefail
cand=${1:?candidate directory}; run=${2:?run directory}; pr=${3:?pr number}; branch=${4:-$(git rev-parse --abbrev-ref HEAD)}
legend=${PARITY_LEGEND_DIR:?set PARITY_LEGEND_DIR to the legend directory}
[ -f "$run/captures.json" ] || { echo "no captures.json in $run" >&2; exit 1; }
sha=$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const b=m.provenance&&m.provenance.build;if(!/^[0-9a-f]{40,64}$/i.test(b||""))process.exit(1);console.log(b)' "$run/captures.json") \
  || { echo "captures.json has no provenance.build" >&2; exit 1; }
mkdir -p "$cand/dark" "$cand/light" "$cand/layout/dark" "$cand/layout/light"
node -e '
const fs=require("fs"),path=require("path"),[run,cand]=process.argv.slice(1);
const m=JSON.parse(fs.readFileSync(path.join(run,"captures.json"),"utf8"));
for(const c of m.captures){
  for(const p of [c.path,c.layout&&c.layout.path].filter(Boolean)){
    fs.mkdirSync(path.dirname(path.join(cand,p)),{recursive:true});
    fs.copyFileSync(path.join(run,p),path.join(cand,p));
  }
}' "$run" "$cand"
for th in dark light; do cp "$run"/layout/$th/*.json "$cand/layout/$th/"; done
cp "$run/dpad.json" "$run/captures.json" "$cand/"
printf '{"branch":"%s","sha":"%s","pr":%s,"captured_at":"%s","server":"static server"}\n' "$branch" "$sha" "$pr" "$(date -u +%FT%TZ)" > "$cand/build.json"
cp "$cand/build.json" "$cand/light/build.json"
out=$(cd "$legend" && node update.mjs 2>&1) || { echo "$out" >&2; exit 1; }
echo "$out" | tail -n 3
name=$(basename "$cand")
if echo "$out" | grep -E "skip [^ ]*${name}" >&2; then echo "legend rejected $name captures" >&2; exit 1; fi
