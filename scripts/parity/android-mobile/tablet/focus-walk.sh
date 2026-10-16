cd ~/build-host-tablet; export PATH=$HOME/Android/Sdk/platform-tools:$PATH ANDROID_SERIAL=emulator-5568
pkg=io.playarr.mobile; mkdir -p out/foc
adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1
foc() { adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; adb shell cat /sdcard/u.xml | python3 -c "
import re,sys
x=sys.stdin.read()
nodes=[]
for m in re.finditer(r'<node ([^>]*?)/?>',x):
    a=m.group(1); b=re.search(r'bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"',a)
    if not b: continue
    t=re.search(r'text=\"([^\"]*)\"',a); d=re.search(r'content-desc=\"([^\"]*)\"',a)
    nodes.append((tuple(map(int,b.groups())),(t.group(1) if t else '')or(d.group(1) if d else ''),'focused=\"true\"' in a))
f=[n for n in nodes if n[2]]
if not f: print('-'); sys.exit()
(x0,y0,x1,y1)=f[0][0]
labs=[l for (bb,l,_) in nodes if l and bb[0]>=x0-2 and bb[1]>=y0-2 and bb[2]<=x1+2 and bb[3]<=y1+2]
print((f[0][1] or ' | '.join(labs[:3]) or '-'))"; }
run() { name=$1; route=$2; shift 2
  adb shell am force-stop $pkg; adb shell am start -n $pkg/.MainActivity --ez parity_no_insets true --es parity_route "$route" >/dev/null; sleep 22; adb shell input keyevent 59; sleep 2
  echo "== $name"; echo "start: $(foc)"
  for k in "$@"; do adb shell input keyevent $k; sleep 0.6; echo "key $k: $(foc)"; done; }
run settings settings 20 20 20 22 20 20
run search search 20 20 20 22 22
run movies movies 22 22 20 20 21 19
run calendar-week "calendar?query=view%3Dweek%26date%3D2026-10-14" 22 22 20 20 21
run home home 22 22 20 22 19
