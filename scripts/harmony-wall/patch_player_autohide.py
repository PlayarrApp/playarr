# Preview-only (never committed into the app): the Previewer mocks AVPlayer, so the player never reports "playing" and the chrome's
# 3.5 s auto-hide never starts. The design report's `player` frame is the hidden-controls state, so once the capture script posts the
# route `autohide:on` (patch_route.py sets the AppStorage flag), the chrome runs its own countdown without the playing test.
# Usage: patch_player_autohide.py <PlayerChrome.ets>. Production builds never run this.
import sys

p = sys.argv[1]
s = open(p).read()
if "previewAutoHide" in s:
    sys.exit(0)
needle = "    if (!this.isPlaying || this.focusedCount > 0) {\n      return;\n    }\n    this.autoHideTimerHandle = setTimeout("
assert needle in s, p + ": scheduleAutoHide is not as expected"
s = s.replace(needle, needle.replace("!this.isPlaying ||", "(!this.isPlaying && AppStorage.get<boolean>('previewAutoHide') !== true) ||"), 1)
open(p, "w").write(s)
