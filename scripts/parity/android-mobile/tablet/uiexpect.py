# uiexpect.py <regex>: exit 0 when any text or content-desc on emulator-5568 matches (case-insensitive search), else 1
import os, re, subprocess, sys
adb = [os.path.expanduser("~/Android/Sdk/platform-tools/adb"), "-s", "emulator-5568"]
for _ in range(4):
    subprocess.run(adb + ["shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
    xml = subprocess.run(adb + ["shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True).stdout
    if re.search(r'(?:text|content-desc)="[^"]*(?:%s)' % sys.argv[1], xml, re.I): sys.exit(0)
    import time; time.sleep(2)
sys.exit(1)
