#!/usr/bin/python3
"""xclick.py <display> click X Y | text STRING | textenv VARNAME | press KEYSYM  (XTest input for headless Xvnc displays)"""
import sys
import time
from Xlib import X, XK, display
from Xlib.ext import xtest

d = display.Display(sys.argv[1])
cmd = sys.argv[2]
NAMES = {" ": "space", "-": "minus", ".": "period", "_": "underscore", "@": "at"}
if cmd == "click":
    x, y = int(sys.argv[3]), int(sys.argv[4])
    d.screen().root.warp_pointer(x, y)
    d.sync()
    time.sleep(0.1)
    xtest.fake_input(d, X.ButtonPress, 1)
    d.sync()
    time.sleep(0.05)
    xtest.fake_input(d, X.ButtonRelease, 1)
elif cmd == "hold":
    code = d.keysym_to_keycode(XK.string_to_keysym(sys.argv[3]))
    xtest.fake_input(d, X.KeyPress, code); d.sync()
    time.sleep(float(sys.argv[4]) / 1000)
    xtest.fake_input(d, X.KeyRelease, code)
elif cmd in ("text", "press", "textenv"):
    import os
    source = os.environ[sys.argv[3]] if cmd == "textenv" else sys.argv[3]
    chars = [source] if cmd == "press" else list(source)
    for c in chars:
        sym = XK.string_to_keysym(NAMES.get(c, c))
        code = d.keysym_to_keycode(sym)
        shift = len(c) == 1 and (c.isupper() or c in "_@")
        if shift:
            xtest.fake_input(d, X.KeyPress, d.keysym_to_keycode(XK.XK_Shift_L))
        xtest.fake_input(d, X.KeyPress, code)
        xtest.fake_input(d, X.KeyRelease, code)
        if shift:
            xtest.fake_input(d, X.KeyRelease, d.keysym_to_keycode(XK.XK_Shift_L))
        d.sync()
        time.sleep(0.03)
d.sync()
