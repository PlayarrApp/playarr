# Preview-only (never committed): the Previewer's AVPlayer raises no events, so the player page never leaves 0:00. Route the controller's two
# media.createAVPlayer() calls to the parity stand-in (overlay util/PreviewPlayer.ets), which lands on the pinned 2.000 s and stays paused.
# Usage: patch_player.py <AvPlayerController.ets>
import sys

p = sys.argv[1]
s = open(p).read()
if "createParityPlayer" in s:
    sys.exit(0)
call = "player = await media.createAVPlayer();"
assert s.count(call) == 2, p + ": expected two createAVPlayer calls"
s = s.replace(call, "player = await createParityPlayer();")
anchor = "import { logError, logInfo, logWarn } from '../util/Log';\n"
assert anchor in s, p + ": import anchor missing"
s = s.replace(anchor, anchor + "import { createParityPlayer } from '../util/PreviewPlayer';\n", 1)
open(p, "w").write(s)
