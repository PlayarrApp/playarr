# Preview-only (never committed into the app): the Previewer mocks AVPlayer, so the TV player's video surface is black while the web
# ref shows the paused static clip (2 s, colour bars) behind the controls. Draw that frame as a still above the surface so the
# translucent controls blend as they do over real video. Usage: patch_player_still.py <Player.ets>. Production builds never run this.
import re
import sys

p = sys.argv[1]
s = open(p).read()
if "parity-player-still" in s:
    sys.exit(0)
pat = re.compile(r"(        XComponent\(\{\n          id: 'playarr-player-surface',.*?\n          \.height\('100%'\)\n)", re.S)
m = pat.search(s)
assert m, p + ": player surface not found"
still = ("\n        Image($rawfile('parity-player-still.png'))\n          .width('100%')\n          .height('100%')\n"
         "          .objectFit(ImageFit.Fill)\n          .interpolation(ImageInterpolation.High)\n          .hitTestBehavior(HitTestMode.None)\n")
open(p, "w").write(s[:m.end()] + still + s[m.end():])
