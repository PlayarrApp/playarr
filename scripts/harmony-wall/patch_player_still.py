# Preview-only (never committed into the app): the Previewer mocks AVPlayer, so the TV player's video surface is black while the web
# ref shows the paused static clip (2 s, colour bars) behind the controls. Draw that frame as a still above the surface so the
# translucent controls blend as they do over real video. Usage: patch_player_still.py <Player.ets>. Production builds never run this.
import re
import sys

p = sys.argv[1]
s = open(p).read()
if "parity-player-still" in s:
    sys.exit(0)
# patch_state.py has already swapped the SURFACE XComponent for an empty Column (the Previewer draws a grey placeholder for it)
pat = re.compile(r"        Column\(\)\.width\('100%'\)\.height\('100%'\)\n")
m = pat.search(s)
assert m, p + ": the patched player surface placeholder is not found"
still = ("\n        Image($rawfile('parity-player-still.png'))\n          .width('100%')\n          .height('100%')\n"
         "          .objectFit(ImageFit.Fill)\n          .interpolation(ImageInterpolation.High)\n          .hitTestBehavior(HitTestMode.None)\n")
s = s[:m.end()] + still + s[m.end():]
# The Previewer's mocked player never reports a negotiated quality; web's ref shows the static clip's "Original · 0.3 Mbps".
old = "@State private qualityLabel: string = '';"
assert old in s, p + ": qualityLabel state not found"
open(p, "w").write(s.replace(old, "@State private qualityLabel: string = 'Original \\u00b7 0.3 Mbps';", 1))

# The still is the web ref's video plane: tag it so the layout export reports it as the video element.
s = open(p).read()
old = "        Image($rawfile('parity-player-still.png'))\n          .width('100%')\n          .height('100%')\n"
assert old in s, p + ": the player still is not found"
open(p, "w").write(s.replace(old, old + "          .id('px:video:')\n", 1))
