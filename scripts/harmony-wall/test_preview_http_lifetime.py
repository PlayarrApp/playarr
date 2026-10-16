import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent


class PreviewHttpLifetimeTests(unittest.TestCase):
    def run_patch(self, patcher, *args):
        subprocess.run([sys.executable, str(HERE / patcher), *map(str, args)], check=True)

    def test_http_patch_retains_transport_artwork_and_preview_state_requests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            transport = root / "HttpTransport.ets"
            artwork = root / "ArtworkRepository.ets"
            state = root / "PreviewState.ets"
            transport.write_text(
                "const client = http.createHttp();\n"
                "export async function sendHttpRequest(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {\n"
                "  client.destroy();\n}\n",
                encoding="utf-8",
            )
            artwork.write_text("const req = http.createHttp();\nreq.destroy();\n", encoding="utf-8")
            state.write_text(
                "const req = http.createHttp();\nreq.destroy();\n"
                "const req = http.createHttp();\nreq.destroy();\n",
                encoding="utf-8",
            )

            self.run_patch("patch_http.py", transport, artwork, state)

            for path in (transport, artwork, state):
                with self.subTest(path=path.name):
                    patched = path.read_text(encoding="utf-8")
                    self.assertNotIn(".destroy();", patched)
                    self.assertIn("retainPreviewHttpRequest(", patched)
            self.assertIn("retainPreviewHttpRequest(client);", transport.read_text(encoding="utf-8"))
            self.assertIn("retainPreviewHttpRequest(req);", artwork.read_text(encoding="utf-8"))
            self.assertEqual(state.read_text(encoding="utf-8").count("retainPreviewHttpRequest(req);"), 2)

            # PreviewState already owns explicit retains at its two telemetry request sites. Applying the source patch must not
            # duplicate those registry entries and consume the bounded lifetime budget twice as quickly.
            self.run_patch("patch_http.py", transport, artwork, state)
            self.assertEqual(state.read_text(encoding="utf-8").count("retainPreviewHttpRequest(req);"), 2)


if __name__ == "__main__":
    unittest.main()
