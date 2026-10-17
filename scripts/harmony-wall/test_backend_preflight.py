import errno
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import backend_preflight


class Response:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def getcode(self):
        return self.status

    def read(self, *_args):
        raise AssertionError("preflight must not read the response body")


class BackendPreflightTests(unittest.TestCase):
    def test_success_gets_only_public_version_endpoint_with_bounded_timeout(self):
        requests = []

        def opener(request, *, timeout):
            requests.append((request, timeout))
            return Response(200)

        result = backend_preflight.check_backend(" https://service.example/base/ ", timeout=20, opener=opener)
        self.assertEqual(result, {"ready": True, "status": 200, "failure": None})
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0][0].full_url, "https://service.example/base/api/system/version")
        self.assertEqual(requests[0][0].method, "GET")
        self.assertEqual(requests[0][1], 3.0)

    def test_connection_error_retries_once_then_returns_sanitized_category(self):
        calls = []

        def opener(request, *, timeout):
            calls.append(timeout)
            raise urllib.error.URLError("private-hostname: connection refused")

        result = backend_preflight.check_backend("https://private-hostname.example", opener=opener)
        self.assertEqual(result, {"ready": False, "status": None, "failure": "connection-error"})
        self.assertEqual(len(calls), 2)

    def test_connection_refused_is_preserved_as_safe_failure_category(self):
        calls = []

        def opener(request, *, timeout):
            calls.append(1)
            raise urllib.error.URLError(ConnectionRefusedError(errno.ECONNREFUSED, "private socket detail"))

        result = backend_preflight.check_backend("https://service.example", opener=opener)
        self.assertEqual(result, {"ready": False, "status": None, "failure": "connection-refused"})
        self.assertEqual(len(calls), 2)

    def test_timeout_retries_once_then_returns_sanitized_category(self):
        calls = []

        def opener(request, *, timeout):
            calls.append(timeout)
            raise TimeoutError("private timeout detail")

        result = backend_preflight.check_backend("https://service.example", opener=opener)
        self.assertEqual(result, {"ready": False, "status": None, "failure": "timeout"})
        self.assertEqual(len(calls), 2)

    def test_server_http_error_retries_once_without_reading_body(self):
        calls = []

        def opener(request, *, timeout):
            calls.append(1)
            raise urllib.error.HTTPError(request.full_url, 503, "sensitive response", {}, io.BytesIO(b"secret"))

        result = backend_preflight.check_backend("https://service.example", opener=opener)
        self.assertEqual(result, {"ready": False, "status": 503, "failure": "http-status"})
        self.assertEqual(len(calls), 2)

    def test_client_http_error_does_not_retry(self):
        calls = []

        def opener(request, *, timeout):
            calls.append(1)
            raise urllib.error.HTTPError(request.full_url, 404, "not found", {}, io.BytesIO(b"secret"))

        result = backend_preflight.check_backend("https://service.example", opener=opener)
        self.assertEqual(result, {"ready": False, "status": 404, "failure": "http-status"})
        self.assertEqual(len(calls), 1)

    def test_invalid_url_fails_without_request(self):
        called = []
        result = backend_preflight.check_backend("https://user:password@service.example", opener=lambda *_args, **_kwargs: called.append(1))
        self.assertEqual(result, {"ready": False, "status": None, "failure": "invalid-server-url"})
        self.assertEqual(called, [])

    def test_cli_output_never_contains_server_url_or_error_details(self):
        server_url = "https://sensitive-host.example/path"
        with patch.dict("os.environ", {"PLAYARR_TEST_SERVER_URL": server_url}), \
                patch.object(backend_preflight.urllib.request, "urlopen",
                             side_effect=urllib.error.URLError("secret connection detail")), \
                patch("sys.stdout", new=io.StringIO()) as output:
            exit_code = backend_preflight.main([])
        rendered = output.getvalue()
        self.assertEqual(exit_code, 1)
        self.assertEqual(json.loads(rendered), {"ready": False, "status": None, "failure": "connection-error"})
        self.assertNotIn(server_url, rendered)
        self.assertNotIn("secret connection detail", rendered)

    def test_cli_writes_only_sanitized_result_to_requested_report(self):
        report = io.StringIO()
        open_context = MagicMock()
        open_context.__enter__.return_value = report
        with patch.dict("os.environ", {"PLAYARR_TEST_SERVER_URL": "https://private-host.example"}), \
                patch.object(backend_preflight.urllib.request, "urlopen", return_value=Response(200)), \
                patch("builtins.open", return_value=open_context) as open_file, \
                patch("sys.stdout", new=io.StringIO()) as output:
            exit_code = backend_preflight.main(["--output", "preflight.json"])
        rendered = output.getvalue()
        stored = report.getvalue()
        expected = {"ready": True, "status": 200, "failure": None}
        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(rendered), expected)
        self.assertEqual(json.loads(stored), expected)
        self.assertEqual(open_file.call_args.args, ("preflight.json", "w"))
        self.assertNotIn("private-host.example", stored)


if __name__ == "__main__":
    unittest.main()
