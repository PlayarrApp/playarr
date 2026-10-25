# Preview-only (never committed): the search field's blinking caret and the player's buffering spinner are animations a pinned capture must not
# contain (web's refs show neither). Usage: patch_caret.py <Search.ets> <Player.ets>.
import sys

search, player = sys.argv[1:3]
s = open(search).read()
n = s.count(".caretColor(toResourceColor(activeColors().ink))")
assert n >= 1, search + ": caret colour not found"
open(search, "w").write(s.replace(".caretColor(toResourceColor(activeColors().ink))", ".caretColor(Color.Transparent)"))
p = open(player).read()
assert "LoadingProgress()\n" in p, player + ": spinner not found"
open(player, "w").write(p.replace("LoadingProgress()\n", "LoadingProgress()\n          .visibility(Visibility.Hidden)\n", 1))
