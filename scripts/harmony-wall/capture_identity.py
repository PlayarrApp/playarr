"""Privacy-conscious identity checks for Harmony parity captures."""

import hashlib
import ipaddress
import time
import urllib.parse
import urllib.request


def verify_signed_in_identity(state):
    """Require a current app profile whose private ID digest matched the approver."""
    if not isinstance(state, dict) or state.get("auth_verified") is not True:
        raise ValueError("the app identity did not match the approved test account; refusing capture")
    if state.get("auth_current") is not True:
        raise ValueError("the authenticated profile is not current; refusing capture")


def parse_identity_digest(output):
    """Read the approver's tagged digest without exposing it in logs."""
    import re

    matches = re.findall(r"^IDENTITY_SHA256=([0-9a-f]{64})$", output, re.MULTILINE)
    if len(matches) != 1:
        raise ValueError("the approved account identity could not be verified; refusing capture")
    return matches[0]


def match_profile_identity(profile_id, expected_digest, is_current):
    """Return privacy-safe booleans for the transient app-reported profile ID."""
    if not isinstance(profile_id, str) or not isinstance(expected_digest, str):
        return False, False
    matched = bool(expected_digest) and hashlib.sha256(profile_id.encode()).hexdigest() == expected_digest
    return matched, bool(matched and is_current)


def require_capture_enabled(identity_verified):
    """Fail before any frame read or debug image write until identity was checked."""
    if identity_verified is not True:
        raise ValueError("signed-in identity has not been verified; refusing frame capture")


def guarded_frame(identity_verified, frame_source):
    """Call the frame source only after the signed-in identity gate passes."""
    require_capture_enabled(identity_verified)
    return frame_source()


def install_expected_identity_digest(control_url, digest, opener=None):
    """Install the approver digest in the loopback bridge before authorising the device code."""
    parsed = urllib.parse.urlparse(control_url)
    try:
        is_loopback = parsed.hostname is not None and ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        is_loopback = False
    if (parsed.scheme != "http" or not is_loopback or parsed.path != "/state" or parsed.query
            or parsed.username is not None or parsed.password is not None or parsed.fragment
            or not isinstance(digest, str) or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)):
        raise ValueError("identity control endpoint is invalid")
    query = urllib.parse.urlencode({"clear_identity": "1", "expected_digest": digest})
    request = urllib.request.Request(control_url + "?" + query)
    open_url = opener or urllib.request.urlopen
    with open_url(request, timeout=10) as response:
        if response.status != 200:
            raise ValueError("identity control endpoint rejected the expected account")


def authorize_after_identity_setup(user_code, token, digest, control_url, authorize,
                                   installer=install_expected_identity_digest):
    """Require bridge identity setup to complete before the account authorises the device code."""
    if control_url:
        installer(control_url, digest)
    return authorize("/api/v1/oauth/device/authorize", {"user_code": user_code}, token)


def wait_for_verified_identity(read_state, attempts=60, delay=1, sleep=time.sleep):
    """Wait for the app's authenticated current-profile report without navigating away from pairing."""
    for attempt in range(attempts):
        state = read_state()
        if isinstance(state, dict) and state.get("auth_verified") is True:
            verify_signed_in_identity(state)
            return state
        if attempt + 1 < attempts:
            sleep(delay)
    raise ValueError("the app identity did not match the approved test account; refusing capture")
