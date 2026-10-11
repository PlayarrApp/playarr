#!/usr/bin/env python3
"""Spike: attach the debugger (so the Previewer runs the app), then save the first JPEG frame of the Previewer websocket.
Usage: grab_frame.py <ws-port> <debug-port> <out.jpg> [timeout-s]"""
import sys, threading, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sim-vnc"))
import harmony_vnc as h
ws, dbg, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
limit = float(sys.argv[4]) if len(sys.argv) > 4 else 120
threading.Thread(target=h.run_debugger, args=(dbg,), daemon=True).start()
end = time.time() + limit
while time.time() < end:
    try:
        sock, buf = h.ws_connect(ws, "")
        for _, m in h.ws_messages(sock, buf):
            i = m.find(b"\xff\xd8")
            if i >= 0:
                open(out, "wb").write(m[i:]); print("frame", len(m) - i); sys.exit(0)
    except (OSError, ConnectionError) as e:
        time.sleep(1)
print("no frame"); sys.exit(1)
