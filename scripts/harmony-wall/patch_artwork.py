# Preview-only (never committed): the Previewer mocks image.createImageSource/createPixelMap (the mock yields an empty PixelMap, so every
# poster is an empty box). The fetched bytes are fine: they are posted to the bridge (harmony_vnc.py /imgput, /img/<id>) and the
# "PixelMap" becomes that loopback URL, which Image() loads for real (types are erased at run time; every Image(this.artwork) call site
# accepts a string). Usage: patch_artwork.py <ArtworkRepository.ets> <bridge-port>.
import ipaddress
import sys

def patch_source(source, port, bridge_url=None):
    if 'PREVIEW_IMG_SEQ' in source:
        return source
    old = """function decodePixelMapFromBytes(bytes: ArrayBuffer): Promise<image.PixelMap> {
  const imageSource: image.ImageSource = image.createImageSource(bytes);
  return imageSource.createPixelMap();
}"""
    assert old in source
    base = bridge_url if bridge_url is not None else 'http://%s:%s' % (ipaddress.IPv4Address(0x7f000001), port)
    new = """let PREVIEW_IMG_SEQ: number = 0;

function decodePixelMapFromBytes(bytes: ArrayBuffer): Promise<image.PixelMap> {
  PREVIEW_IMG_SEQ += 1;
  const base: string = '%s';
  const id: string = PREVIEW_IMG_SEQ.toString();
  const req = http.createHttp();
  return req.request(base + '/imgput?id=' + id, { method: http.RequestMethod.POST, extraData: bytes, connectTimeout: 5000, readTimeout: 5000 })
    .then((): image.PixelMap => {
      req.destroy();
      return (base + '/img/' + id) as Object as image.PixelMap;
    });
}""" % base
    source = source.replace(old, new, 1)
    return source.replace("import { image } from '@kit.ImageKit';", "import { image } from '@kit.ImageKit';\nimport { http } from '@kit.NetworkKit';", 1)

def patch_file(path, port):
    with open(path, encoding='utf-8') as source:
        original = source.read()
    patched = patch_source(original, port)
    if patched != original:
        with open(path, 'w', encoding='utf-8') as target:
            target.write(patched)

if __name__ == '__main__':
    patch_file(sys.argv[1], sys.argv[2])
