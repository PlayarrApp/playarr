import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("patch_previewer_http.py")
SPEC = importlib.util.spec_from_file_location("patch_previewer_http", MODULE_PATH)
patcher = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(patcher)


class PreviewerHttpPatchTests(unittest.TestCase):
    def setUp(self):
        self.original_sha = patcher.ORIGINAL_SHA256
        self.patched_sha = patcher.PATCHED_SHA256
        self.offset = patcher.FILE_OFFSET
        self.call = patcher.ORIGINAL_CALL
        self.patched_call = patcher.PATCHED_CALL

    def tearDown(self):
        patcher.ORIGINAL_SHA256 = self.original_sha
        patcher.PATCHED_SHA256 = self.patched_sha
        patcher.FILE_OFFSET = self.offset
        patcher.ORIGINAL_CALL = self.call
        patcher.PATCHED_CALL = self.patched_call

    def fixture(self, content):
        patcher.FILE_OFFSET = 8
        patcher.ORIGINAL_CALL = b"CALL!!"
        patcher.PATCHED_CALL = b"......"
        patched = bytearray(content)
        patched[8:14] = patcher.PATCHED_CALL
        patcher.ORIGINAL_SHA256 = hashlib.sha256(content).hexdigest()
        patcher.PATCHED_SHA256 = hashlib.sha256(patched).hexdigest()
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "libhttp.dll"
        path.write_bytes(content)
        return path, bytes(patched)

    def test_patches_only_the_verified_call_and_is_idempotent(self):
        content = b"fixture!CALL!!tail"
        path, expected = self.fixture(content)

        self.assertEqual(patcher.patch(path), "patched")
        self.assertEqual(path.read_bytes(), expected)
        self.assertEqual(patcher.patch(path), "already-patched")

    def test_rejects_unknown_binary_hash(self):
        content = b"unrecognised binary payload"
        path, _ = self.fixture(b"fixture!CALL!!tail")
        path.write_bytes(content)

        with self.assertRaisesRegex(ValueError, "unsupported Previewer"):
            patcher.patch(path)

    def test_rejects_modified_binary_with_patched_digest_expected(self):
        original = b"fixture!CALL!!tail"
        path, expected = self.fixture(original)
        changed = bytearray(expected)
        changed[-1] ^= 1
        path.write_bytes(changed)

        with self.assertRaisesRegex(ValueError, "unsupported Previewer"):
            patcher.patch(path)

    def test_rejects_expected_hash_with_wrong_opcode(self):
        content = b"fixture!wrong!tail"
        path, _ = self.fixture(b"fixture!CALL!!tail")
        patcher.ORIGINAL_SHA256 = hashlib.sha256(content).hexdigest()
        path.write_bytes(content)

        with self.assertRaisesRegex(ValueError, "call bytes did not match"):
            patcher.patch(path)


if __name__ == "__main__":
    unittest.main()
