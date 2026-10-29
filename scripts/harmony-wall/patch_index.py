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

# The Previewer window is larger than the stage (TV 3000 x 1740 px, stage at (240, 60); phone 1800 x 3600 px, stage 360 x 780 vp at (60, 60) vp)
# the stage keeps its fixed size and offset, the capture crops it out and the exporter subtracts the offset. Boxes the inspector still clamps at the
# window's trailing edge are restored by the exporter from the measured size (its limits list what it cannot restore).
s = open(p).read()
if '.clip(false)' not in s:
    if os.environ.get('DEVICE', 'tv') == 'tv':
        fixed = '.width(1920)\n    .height(1080)\n    .margin({ left: 240, top: 60 })'
    else:
        fixed = '.width(360)\n    .height(780)\n    .margin({ left: 60, top: 60 })'
    s = s.replace('.mode(NavigationMode.Stack)', '.mode(NavigationMode.Stack)\n    ' + fixed + '\n    .clip(false)', 1)
    open(p, 'w').write(s)

# The device profile is read from the stage, not the larger window.
svc = os.path.join(os.path.dirname(pages_dir), 'device', 'DeviceProfileService.ets')
t = open(svc).read()
stage_w, stage_h = ('1920', '1080') if os.environ.get('DEVICE', 'tv') == 'tv' else ('360', '780')
old = "    widthVp: rect.width / densityPixels,\n    heightVp: rect.height / densityPixels,"
if old in t:
    open(svc, 'w').write(t.replace(old, "    widthVp: %s + rect.width * 0,\n    heightVp: %s + rect.height * 0," % (stage_w, stage_h), 1))
