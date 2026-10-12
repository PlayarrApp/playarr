# Preview-only (never committed): the Previewer's libhttp crashes (access violation in HttpExec::ReadResponse, the whole app freezes)
# some of the time when a request object is destroyed while its read thread is still winding down. Leaking the single-use request
# objects for the length of a capture run is harmless. Usage: patch_http.py <HttpTransport.ets> <ArtworkRepository.ets>.
import sys
for p in sys.argv[1:]:
    s = open(p).read()
    n = s.count("destroy();")
    s = s.replace("client.destroy();", "/* request left alive (libhttp crash) */").replace("req.destroy();", "/* request left alive (libhttp crash) */")
    open(p, 'w').write(s)
    assert "destroy();" not in s, p
