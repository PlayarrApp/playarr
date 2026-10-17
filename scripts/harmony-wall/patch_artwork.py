# Preview-only (never committed): the Previewer mocks image.createImageSource/createPixelMap (the mock yields an empty PixelMap, so every
# poster is an empty box). The fetched bytes are fine: they are posted to the bridge (harmony_vnc.py /imgput, /img/<id>) and the
# "PixelMap" becomes that loopback URL, which Image() loads for real (types are erased at run time; every Image(this.artwork) call site
# accepts a string). Usage: patch_artwork.py <ArtworkRepository.ets> <bridge-port>.
import sys
p, port = sys.argv[1], sys.argv[2]
s = open(p).read()
if 'PREVIEW_IMG_SEQ' in s:
    sys.exit(0)
old = """function decodePixelMapFromBytes(bytes: ArrayBuffer): Promise<image.PixelMap> {
  const imageSource: image.ImageSource = image.createImageSource(bytes);
  return imageSource.createPixelMap();
}"""
assert old in s
new = """let PREVIEW_IMG_SEQ: number = 0;

function decodePixelMapFromBytes(bytes: ArrayBuffer): Promise<image.PixelMap> {
  PREVIEW_IMG_SEQ += 1;
  const base: string = 'http://127.0.0.1:%s';
  const id: string = PREVIEW_IMG_SEQ.toString();
  const req = http.createHttp();
  return req.request(base + '/imgput?id=' + id, { method: http.RequestMethod.POST, extraData: bytes, connectTimeout: 60000, readTimeout: 60000 })
    .then((): image.PixelMap => {
      req.destroy();
      return (base + '/img/' + id) as Object as image.PixelMap;
    });
}""" % port
s = s.replace(old, new, 1)
s = s.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { http } from '@kit.NetworkKit';", 1)
open(p, 'w').write(s)
