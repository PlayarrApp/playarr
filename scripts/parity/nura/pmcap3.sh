#!/usr/bin/env bash
# usage: pmcap3.sh <outdir> <route>...   routes go to the running app through its control file (PLAYARR_CONTROL); review before publishing
H=$(dirname "$0"); O=$1; shift; mkdir -p "$O"
"$H/pmssh.sh" "pgrep -f release/playarr-mobile >/dev/null" || { "$H/pmssh.sh" "rm -f /tmp/pa-route"; PLAYARR_ROUTE=home PLAYARR_CONTROL=/tmp/pa-route PLAYARR_KEEP_CONTROLS=1 "$H/pmrun.sh" >/dev/null 2>&1; sleep 40; "$H/pmfocus.sh"; }
for r in "$@"; do
  name=$(echo "$r" | tr ':' '_')
  "$H/pmssh.sh" "echo '$r' > /tmp/pa-route"
  # the app removes the file when it has taken the route; a busy main loop can take a while
  for i in $(seq 1 90); do "$H/pmssh.sh" "[ ! -f /tmp/pa-route ]" && break; sleep 4; done
  w=${WAIT:-40}; case $r in player) w=70;; profiles) w=110;; theme*) w=20;; esac
  sleep $w; case $r in theme*) ;; *)
    # repaint is slow on this VM: shoot until two shots 20 s apart are identical (max 8), so a half-drawn or previous page is never kept
    prev=""; for i in 1 2 3 4 5 6 7 8; do "$H/cap.sh" postmarketos "$O/$name.png" >/dev/null 2>&1; cur=$("$H/venv/bin/python" -c "import sys,hashlib;from PIL import Image;print(hashlib.md5(Image.open(sys.argv[1]).convert('RGB').crop((0,70,720,1410)).tobytes()).hexdigest())" "$O/$name.png"); [ "$cur" = "$prev" ] && break; prev=$cur; sleep 20; done;; esac
done
echo done > "$O/DONE"
