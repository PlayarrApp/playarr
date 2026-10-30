# uiexpect.py <regex>: exit 0 when any text or content-desc on $ANDROID_SERIAL matches (case-insensitive search), else 1
import os, re, subprocess, sys
adb = [os.path.expanduser("~/Android/Sdk/platform-tools/adb"), "-s", os.environ.get("ANDROID_SERIAL", "emulator-5562")]
for _ in range(4):
    subprocess.run(adb + ["shell", "rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml"], capture_output=True, timeout=30)
    xml = subprocess.run(adb + ["shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True, timeout=30).stdout
    if re.search(r'(?:text|content-desc)="[^"]*(?:%s)' % sys.argv[1], xml, re.I): sys.exit(0)
    import time; time.sleep(2)
sys.exit(1)
