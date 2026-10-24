#!/usr/bin/env python3
"""Headless Nura display I/O over the VM's QMP socket (no VNC).

usage: display.py capture <out.png> | tap <x> <y> | key <qcode>... | type <text from stdin>

Coordinates are the guest's logical 720x1440 pixels. The socket defaults to
$XDG_RUNTIME_DIR/emu-postmarketos.qmp; override with PLAYARR_NURA_QMP.
"""
import json, os, socket, sys, time

W, H = 720, 1440
path = os.environ.get("PLAYARR_NURA_QMP", f"{os.environ.get('XDG_RUNTIME_DIR', '/run/user/%d' % os.getuid())}/emu-postmarketos.qmp")


def qmp(cmd, **args):
    s = socket.socket(socket.AF_UNIX)
    s.settimeout(30)
    s.connect(path)
    f = s.makefile("rw")
    f.readline()
    for c, a in (("qmp_capabilities", {}), (cmd, args)):
        f.write(json.dumps({"execute": c, "arguments": a}) + "\n")
        f.flush()
        while True:
            r = json.loads(f.readline())
            if "return" in r or "error" in r:
                break
    if "error" in r:
        sys.exit(f"qmp {cmd}: {r['error']['desc']}")


def abs_ev(axis, v, size):
    return {"type": "abs", "data": {"axis": axis, "value": int(v * 32767 / size)}}


def btn(down):
    return {"type": "btn", "data": {"button": "left", "down": down}}


a = sys.argv[1:]
if len(a) == 2 and a[0] == "capture":
    out = os.path.abspath(a[1])
    qmp("screendump", filename=out, format="png")
elif len(a) == 3 and a[0] == "tap":
    pos = [abs_ev("x", float(a[1]), W), abs_ev("y", float(a[2]), H)]
    qmp("input-send-event", events=pos)
    time.sleep(0.1)
    qmp("input-send-event", events=[btn(True)])
    time.sleep(0.1)
    qmp("input-send-event", events=[btn(False)])
elif a and a[0] == "key":
    for k in a[1:]:
        e = {"type": "qcode", "data": k}
        qmp("input-send-event", events=[{"type": "key", "data": {"down": True, "key": e}}])
        qmp("input-send-event", events=[{"type": "key", "data": {"down": False, "key": e}}])
elif a == ["type"]:
    # Text comes from stdin so credentials never appear in argv. US layout.
    shifted = dict(zip('~!@#$%^&*()_+{}|:"<>?', "`1234567890-=[]\\;',./"))
    names = {" ": "spc", "`": "grave_accent", "-": "minus", "=": "equal", "[": "bracket_left", "]": "bracket_right", "\\": "backslash",
             ";": "semicolon", "'": "apostrophe", ",": "comma", ".": "dot", "/": "slash"}
    for c in sys.stdin.read().rstrip("\n"):
        up = c.isupper() or c in shifted
        base = shifted.get(c, c.lower())
        q = names.get(base, base)
        evs = [{"type": "qcode", "data": "shift"}] if up else []
        evs.append({"type": "qcode", "data": q})
        qmp("input-send-event", events=[{"type": "key", "data": {"down": True, "key": e}} for e in evs])
        qmp("input-send-event", events=[{"type": "key", "data": {"down": False, "key": e}} for e in reversed(evs)])
else:
    sys.exit(__doc__)
