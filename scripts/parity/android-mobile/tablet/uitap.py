# uitap.py <regex> [tap-up|long-up]: act on the first node on emulator-5568 whose text fully matches; "-up" aims 120 px above the caption, at the card art
import os, re, subprocess, sys
adb = [os.path.expanduser("~/Android/Sdk/platform-tools/adb"), "-s", "emulator-5568"]
mode = sys.argv[2] if len(sys.argv) > 2 else "tap"
subprocess.run(adb + ["shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
xml = subprocess.run(adb + ["shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True).stdout
for m in re.finditer(r"<node ([^>]*)>", xml):
    a = m.group(1); t = re.search(r'text="([^"]*)"', a); b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', a)
    if t and b and re.fullmatch(sys.argv[1], t.group(1).strip()):
        x, y = (int(b.group(1)) + int(b.group(3))) // 2, (int(b.group(2)) + int(b.group(4))) // 2
        if mode.endswith("-up"): y -= 120
        cmd = ["swipe", str(x), str(y), str(x), str(y), "1200"] if mode.startswith("long") else ["tap", str(x), str(y)]
        subprocess.run(adb + ["shell", "input"] + cmd); sys.exit(0)
sys.exit(1)
