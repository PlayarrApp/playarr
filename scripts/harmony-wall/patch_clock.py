# Preview-only (never committed): pin the app's clock to the parity clock (2026-10-07T12:00:00Z, scripts/parity/screens.json determinism.clock)
# so the header clock and the Calendar's today and week match the web references. Usage: patch_clock.py <Clock.ets> <Calendar.ets>.
import sys

FIXED = "new Date(1791374400000)"
for p in sys.argv[1:]:
    s = open(p).read()
    if FIXED in s:
        continue
    assert "new Date()" in s, p + ": no new Date() to pin"
    open(p, "w").write(s.replace("new Date()", FIXED))
