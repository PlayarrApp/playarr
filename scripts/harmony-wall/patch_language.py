# Preview-only (never committed): the Previewer reports an English device, so pin the language the string layer resolves
# against, for a Thai or Japanese visual check. Usage: patch_language.py <AppContainer.ets> <en|th|ja>.
import sys
p, lang = sys.argv[1], sys.argv[2]
assert lang in ("en", "th", "ja"), lang
s = open(p).read()
old = "    return i18n.System.getSystemLanguage();\n"
new = "    return '%s';\n" % lang
if lang == "en" or new in s:
    sys.exit(0)
assert s.count(old) == 1, "getSystemLanguage line not found exactly once"
open(p, "w").write(s.replace(old, new, 1))
