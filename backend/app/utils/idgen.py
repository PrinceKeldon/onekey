import secrets
import string

# Excludes ambiguous characters (0/O, 1/I/L) so codes are easy to read off a
# printed label or type in by hand.
ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "0O1IL")


def generate_onekey_code(length: int = 6) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def generate_qr_tag_value(length: int = 10) -> str:
    """Value used as identity_value for the qr_tag fallback path — separate
    namespace from onekey_code so a printed tag's payload and the public
    short URL code are never accidentally the same string."""
    return "QR-" + "".join(secrets.choice(ALPHABET) for _ in range(length))
