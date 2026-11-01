# Preview-only (never committed): the Previewer's AVPlayer raises no events, so the player page never leaves 0:00. Route the controller's two
# media.createAVPlayer() calls to the parity stand-in (overlay util/PreviewPlayer.ets), which lands on the pinned 2.000 s and stays paused.
# The Previewer also draws a grey "Preview not available for this component." placeholder over an XComponent, which a device with a paused
# video never shows (the app's own black stage shows through): with a second argument (Player.ets) the XComponent is replaced by an empty Column
# that keeps the same size and accessible video role, so the black stage stays visible.
# Usage: patch_player.py <AvPlayerController.ets> [<Player.ets>]
import re, sys

def surface(path):
    t = open(path).read()
    pat = re.compile(r"XComponent\(\{\s*id: 'playarr-player-surface',.*?\}\)", re.S)
    assert len(pat.findall(t)) == 1, path + ": XComponent anchor missing"
    open(path, "w").write(pat.sub("Column()", t))


if len(sys.argv) > 2:
    surface(sys.argv[2])
p = sys.argv[1]
s = open(p).read()
if "createParityPlayer" in s:
    sys.exit(0)
call = "player = await media.createAVPlayer();"
assert s.count(call) == 2, p + ": expected two createAVPlayer calls"
s = s.replace(call, "player = await createParityPlayer();")
# the Previewer draws "Preview not available" for the XComponent, so no surface id ever arrives and the attach would wait for it for ever
wait = "    if (this.surfaceId !== null) {\n      return Promise.resolve();"
assert s.count(wait) == 1, p + ": waitForSurface anchor missing"
s = s.replace(wait, "    if (this.surfaceId !== null || PREVIEW_NO_SURFACE) {\n      return Promise.resolve();")
surface = "    const surfaceId = this.surfaceId;\n"
assert s.count(surface) == 1, p + ": surfaceId anchor missing"
s = s.replace(surface, "    const surfaceId = this.surfaceId ?? 'preview-surface';\n")
anchor = "import { logError, logInfo, logWarn } from '../util/Log';\n"
assert anchor in s, p + ": import anchor missing"
s = s.replace(anchor, anchor + "import { createParityPlayer, PREVIEW_NO_SURFACE } from '../util/PreviewPlayer';\n", 1)
open(p, "w").write(s)
