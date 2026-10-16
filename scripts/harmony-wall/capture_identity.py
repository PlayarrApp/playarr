"""Fail-closed proof that Previewer output belongs to the configured test account."""


def verify_identity(actual, expected):
    if not isinstance(expected, str) or not expected.strip():
        raise ValueError("TEST_USERNAME is required to verify the signed-in Device Test account")
    if not isinstance(actual, str) or actual != expected.strip():
        raise ValueError("capture blocked: the app has not confirmed the configured Device Test account")
