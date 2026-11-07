"""Make each kid's frozen albedo: an even, near-white ice with a faint trace of their own colors.

Avoid visible frost patches here: on a figure this small they read as stains, not ice.
"""

from pathlib import Path

import numpy as np
from PIL import Image

TEX = Path(__file__).resolve().parent.parent / "assets" / "textures_low"
KIDS = ("leo", "maya", "sam", "zoe", "toby")
LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)
ICE_SHADOW = np.array([0.78, 0.88, 0.96], dtype=np.float32)
ICE_LIGHT = np.array([0.98, 0.99, 1.0], dtype=np.float32)
# How much of the kid's own color survives, so they can still just be told apart.
OWN_COLOR = 0.10


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def eye_mask(position):
    """Soft mask over both eyes, feathered so the whitening leaves no visible edge on the face."""
    x = np.abs((position[..., 0] - 0.5) * 1.2)
    y = (position[..., 1] - 0.5) * 0.6
    height = position[..., 2] * 1.72
    across = smoothstep(0.01, 0.03, x) * (1 - smoothstep(0.125, 0.15, x))
    down = smoothstep(1.375, 1.395, height) * (1 - smoothstep(1.465, 1.485, height))
    return across * down * (y > 0)


def main():
    position = np.asarray(Image.open(TEX / "kid_position.png").convert("RGB"), dtype=np.float32) / 255
    eyes = eye_mask(position)[..., None]
    for name in KIDS:
        source = np.asarray(Image.open(TEX / f"kid_{name}_albedo.png").convert("RGB"), dtype=np.float32) / 255
        luma = (source @ LUMA)[..., None]
        # A steep curve keeps folds and creases as soft shading without bringing back the clothes.
        ice = ICE_SHADOW + (ICE_LIGHT - ICE_SHADOW) * smoothstep(0.02, 0.45, luma)
        result = ice * (1 - OWN_COLOR) + source * OWN_COLOR
        # Frozen eyes are blank white, with no iris or pupil left.
        result = result * (1 - eyes) + ICE_LIGHT * eyes
        Image.fromarray((np.clip(result, 0, 1) * 255 + 0.5).astype(np.uint8)).save(TEX / f"kid_{name}_frozen.png")
        print("wrote", name)


if __name__ == "__main__":
    main()
