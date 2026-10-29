# Preview-only (never committed): the search field's blinking caret is an animation a pinned capture must not contain (web's refs show none).
# The player's spinner is real content and stays. Usage: patch_caret.py <Search.ets>.
import sys

search = sys.argv[1]
s = open(search).read()
assert ".caretColor(toResourceColor(activeColors().ink))" in s, search + ": caret colour not found"
open(search, "w").write(s.replace(".caretColor(toResourceColor(activeColors().ink))", ".caretColor(Color.Transparent)"))
