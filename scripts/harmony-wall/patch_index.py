# Preview-only patch of pages/Index.ets: this Previewer build ignores the module routerMap, so map route
# names to the pages' exported builders through Navigation.navDestination. Never committed.
# Pages that do not exist on the branch being previewed (Watchlist, Requests) are left out.
import os, sys
p = sys.argv[1]
s = open(p).read()
if 'previewRoutes' in s:
    sys.exit(0)
pages_dir = os.path.dirname(p)
optional = [("Watchlist", "WatchlistBuilder"), ("Requests", "RequestsBuilder"), ("Playlists", "PlaylistsBuilder"), ("Downloads", "DownloadsBuilder")]
have = [(n, b) for n, b in optional if os.path.exists(os.path.join(pages_dir, n + ".ets"))]
imports = (
    "import { ServerSetupBuilder } from './ServerSetup';\n"
    "import { PairingBuilder } from './Pairing';\n"
    "import { ProfilesBuilder } from './Profiles';\n"
    "import { HomeBuilder } from './Home';\n"
    "import { LibraryBuilder } from './Library';\n"
    "import { DetailBuilder } from './Detail';\n"
    "import { PlayerBuilder } from './Player';\n"
    "import { DesignGalleryBuilder } from './DesignGallery';\n"
    "import { CalendarBuilder } from './Calendar';\n"
    "import { SearchBuilder } from './Search';\n"
    "import { SettingsBuilder } from './Settings';\n")
for n, b in have:
    imports += "import { %s } from './%s';\n" % (b, n)
s = s.replace("import { ROUTES } from '../navigation/Routes';", imports + "import { ROUTES } from '../navigation/Routes';", 1)
extra = "".join("    } else if (name === '%s') {\n      %s()\n" % (n, b) for n, b in have)
builder = """
  @Builder
  previewRoutes(name: string, param: Object) {
    if (name === 'ServerSetup') {
      ServerSetupBuilder()
    } else if (name === 'Pairing') {
      PairingBuilder()
    } else if (name === 'Profiles') {
      ProfilesBuilder()
    } else if (name === 'Home') {
      HomeBuilder(name, param)
    } else if (name === 'Library') {
      LibraryBuilder(name, param)
    } else if (name === 'Detail') {
      DetailBuilder(name, param)
    } else if (name === 'Player') {
      PlayerBuilder(name, param)
    } else if (name === 'DesignGallery') {
      DesignGalleryBuilder()
    } else if (name === 'Calendar') {
      CalendarBuilder()
    } else if (name === 'Search') {
      SearchBuilder()
    } else if (name === 'Settings') {
      SettingsBuilder()
""" + extra + """    }
  }

  build() {"""
s = s.replace("\n  build() {", builder, 1)
s = s.replace("    .hideTitleBar(true)\n  }\n}", "    .hideTitleBar(true)\n    .navDestination(this.previewRoutes)\n  }\n}", 1)
assert '.navDestination(this.previewRoutes)' in s
open(p, 'w').write(s)
