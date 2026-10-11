# Preview-only (never committed): the Pairing page logs its device code so the wall job can approve it as the Device Test
# account (the Previewer shows no QR scanner). Usage: patch_pairing.py <Pairing.ets>. The line `LINKCODE=<code>` goes to the log.
import sys
p = sys.argv[1]
s = open(p).read()
if 'PLAYARR_LINKCODE' in s:
    sys.exit(0)
needle = "    this.deviceCode = response;\n"
assert needle in s
s = s.replace(needle, needle + "    console.info('PLAYARR_LINKCODE=' + response.user_code + ' END');\n", 1)
open(p, 'w').write(s)
