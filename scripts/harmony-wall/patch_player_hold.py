# Preview-only (never committed into the app): hold the player paused at exactly 2.000 s, on every device, with no play-then-pause. The chrome is
# handed a fixed position and the paused state, so the time label, progress fill and Play glyph match the web ref's pinned frame every run
# (docs/parity/DEVICES.md, "Pausing the player at exactly 2.000 s"). Usage: patch_player_hold.py <Player.ets>. Production builds never run this.
import sys

p = sys.argv[1]
s = open(p).read()
if "parity-player-hold" in s:
    sys.exit(0)
for old, new in (("positionMs: this.positionMs,\n            durationMs: this.durationMs,", "positionMs: 2000, // parity-player-hold\n            durationMs: this.durationMs,"),
                 ("isPlaying: this.isPlaying,\n            keepAliveSignal", "isPlaying: false,\n            keepAliveSignal")):
    assert old in s, p + ": chrome binding not found: " + old
    s = s.replace(old, new, 1)
open(p, "w").write(s)
