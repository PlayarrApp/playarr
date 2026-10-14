#!/usr/bin/env python3
"""Sanitized readiness check for the public application version endpoint."""
import argparse
import errno
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request


def _network_failure_category(reason) -> str:
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return "timeout"
    if isinstance(reason, ConnectionRefusedError) or (
            isinstance(reason, OSError) and reason.errno == errno.ECONNREFUSED):
        return "connection-refused"
    return "connection-error"


def check_backend(server_url: str, *, timeout: float = 2.0, retries: int = 1, opener=None) -> dict:
    """GET the public version endpoint without returning its URL, headers, or body."""
    if isinstance(server_url, str):
        server_url = server_url.strip()
    try:
        parsed = urllib.parse.urlsplit(server_url)
    except (TypeError, ValueError):
        return {"ready": False, "status": None, "failure": "invalid-server-url"}
    if (parsed.scheme not in ("http", "https") or not parsed.netloc or
            parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment):
        return {"ready": False, "status": None, "failure": "invalid-server-url"}

    try:
        bounded_timeout = max(0.1, min(float(timeout), 3.0))
    except (TypeError, ValueError):
        bounded_timeout = 2.0
    attempts = 2 if retries > 0 else 1
    request = urllib.request.Request(server_url.rstrip("/") + "/api/system/version", method="GET")
    open_url = opener or urllib.request.urlopen
    last_failure = "connection-error"

    for attempt in range(attempts):
        try:
            with open_url(request, timeout=bounded_timeout) as response:
                status = response.getcode()
            if status == 200:
                return {"ready": True, "status": 200, "failure": None}
            return {"ready": False, "status": status, "failure": "http-status"}
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            if 500 <= status < 600 and attempt + 1 < attempts:
                last_failure = "http-status"
                continue
            return {"ready": False, "status": status, "failure": "http-status"}
        except (TimeoutError, socket.timeout):
            last_failure = "timeout"
        except urllib.error.URLError as error:
            last_failure = _network_failure_category(error.reason)
        except OSError as error:
            last_failure = _network_failure_category(error)
        except Exception:
            last_failure = "request-error"

        if attempt + 1 < attempts:
            continue

    return {"ready": False, "status": None, "failure": last_failure}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    result = check_backend(os.environ.get("SERVER_URL", ""))
    rendered = json.dumps(result, separators=(",", ":"))
    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as report:
                report.write(rendered + "\n")
        except OSError:
            result = {"ready": False, "status": result["status"], "failure": "report-write-error"}
            rendered = json.dumps(result, separators=(",", ":"))
    print(rendered, flush=True)
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
