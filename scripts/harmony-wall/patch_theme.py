# Preview-only (never committed): web's reference picker shows the colour theme chosen explicitly ("Dark" or "Light"), while the Previewer
# starts on System. Label the picker's theme select with the Previewer's colour mode so it reads as web's does; the stored setting is untouched.
# Usage: patch_theme.py <Profiles.ets>.
import sys
p = sys.argv[1]
s = open(p).read()
old = "          value: this.themeSetting,\n"
new = "          value: this.themeSetting === 'system' ? (this.sysColorMode === ColorMode.DARK ? 'dark' : 'light') : this.themeSetting,\n"
if new in s:
    sys.exit(0)
assert s.count(old) == 1, "theme select value line not found exactly once"
open(p, 'w').write(s.replace(old, new, 1))
