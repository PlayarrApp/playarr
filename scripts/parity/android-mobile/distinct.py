# distinct.py <out dir with dark/ and light/>: exit 1 when two screens share a PNG or an identical element array (wrong-scene capture).
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1]); bad = 0
for theme in ("dark", "light"):
    seen = {}
    for kind, files in (("png", sorted((root / theme).glob("*.png"))), ("elements", sorted((root / theme / "layout").glob("*.json")))):
        seen = {}
        for f in files:
            if kind == "png":
                key = hashlib.sha256(f.read_bytes()).hexdigest()
            else:
                d = json.loads(f.read_text()); key = hashlib.sha256(json.dumps(d.get("elements", d.get("nodes")), sort_keys=True).encode()).hexdigest()
            if key in seen:
                print(f"IDENTICAL {kind} {theme}: {seen[key]} == {f.stem}"); bad = 1
            seen[key] = f.stem
sys.exit(bad)
