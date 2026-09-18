from io import BytesIO
from typing import Optional

import imagehash
from PIL import Image


def compute_phash(image_bytes: bytes) -> str:
    """Perceptual hash of an image, as a hex string. Two visually similar
    images hash to similar (low Hamming-distance) strings, even if the
    files themselves differ (recompressed, resized, re-photographed)."""
    img = Image.open(BytesIO(image_bytes)).convert("L")
    return str(imagehash.phash(img))


def hamming_distance(hash_a: str, hash_b: str) -> Optional[int]:
    try:
        return imagehash.hex_to_hash(hash_a) - imagehash.hex_to_hash(hash_b)
    except ValueError:
        return None
