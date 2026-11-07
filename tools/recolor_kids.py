"""Recolor the baked kid albedo into one texture per entry in KIDS_CONFIG."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

TEX = Path(__file__).resolve().parent.parent / "assets" / "textures"

# Colors from KIDS_CONFIG in raw/Game.tsx.
KIDS = {
    "leo": {"shirt": "#ef4444", "pants": "#1e3a8a", "skin": "#fcd5b5", "hair": "#451a03"},
    "maya": {"shirt": "#3b82f6", "pants": "#374151", "skin": "#e0ac69", "hair": "#171717"},
    "sam": {"shirt": "#eab308", "pants": "#1e40af", "skin": "#fcd5b5", "hair": "#d97706"},
    "zoe": {"shirt": "#a855f7", "pants": "#047857", "skin": "#8d5524", "hair": "#0f172a"},
    "toby": {"shirt": "#f97316", "pants": "#1f2937", "skin": "#ffdbac", "hair": "#78350f"},
}

# Sampled from the baked atlas. Neutral covers soles and eye whites, which stay as baked.
REFERENCE = {
    "shirt": (179, 58, 19),
    "pants": (8, 32, 67),
    "skin": (232, 152, 132),
    "hair": (39, 10, 1),
    "shoes": (48, 85, 40),
    "neutral": (190, 190, 195),
}
NAMES = list(REFERENCE)
SHIRT, PANTS, SKIN, HAIR, SHOES, NEUTRAL = range(6)
# Shaded skin on the neck and under the chin, which otherwise reads as shirt.
SKIN_SHADOW = (191, 105, 89)
RECOLORED = (SHIRT, PANTS, SKIN, HAIR)
LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)
SIGMA = 16.0
L_WEIGHT = 0.35
HAIR_RATIO_CAP = 1.8


def to_rgb(value):
    return np.array([int(value[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255


def ref_rgb(index):
    return np.array(REFERENCE[NAMES[index]], dtype=np.float32) / 255


def lab(rgb):
    """Convert sRGB in 0..1 to CIE Lab."""
    linear = np.where(rgb > 0.04045, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    matrix = np.array(
        [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]],
        dtype=np.float32,
    )
    xyz = (linear @ matrix.T) / np.array([0.9505, 1.0, 1.089], dtype=np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack(
        [116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1
    )


def class_weights(rgb):
    pixels = lab(rgb)
    scale = np.array([L_WEIGHT, 1, 1], dtype=np.float32)

    def distance(color):
        ref = lab(np.array(color, dtype=np.float32) / 255)
        return (((pixels - ref) * scale) ** 2).sum(-1)

    distances = [distance(color) for color in REFERENCE.values()]
    distances[SKIN] = np.minimum(distances[SKIN], distance(SKIN_SHADOW))
    distances = np.stack(distances, -1)
    # Relative to the nearest class, so very saturated or dark pixels still get assigned.
    weights = np.exp(-(distances - distances.min(-1, keepdims=True)) / SIGMA**2)
    return weights / weights.sum(-1, keepdims=True)


def load_position():
    """Return x, y, z per texel from the map baked in Blender (kid at origin, facing +Y)."""
    image = Image.open(TEX / "kid_position.png").convert("RGB")
    pos = np.asarray(image, dtype=np.float32) / 255
    return (pos[..., 0] - 0.5) * 1.2, (pos[..., 1] - 0.5) * 0.6, pos[..., 2] * 1.72


def apply_body_regions(rgb, weights):
    """Use body position to settle pixels whose color alone picks the wrong class."""
    x, y, z = load_position()
    ax = np.abs(x)
    rgb = rgb.copy()
    weights = weights.copy()
    before = weights.argmax(-1)

    def move(mask, source, target):
        weights[mask, target] += weights[mask, source]
        weights[mask, source] = 0

    eyes = (y > 0) & (ax > 0.02) & (ax < 0.135) & (z > 1.385) & (z < 1.475) & (before != SKIN)
    move(eyes, HAIR, NEUTRAL)
    move(eyes, SHOES, NEUTRAL)

    head = z > 1.23
    move(head, SHIRT, SKIN)
    move(head, PANTS, HAIR)
    move(head, SHOES, SKIN)

    arms = (z > 0.6) & (z <= 1.23) & (ax >= 0.25)
    move(arms, PANTS, SKIN)
    move(arms, HAIR, SKIN)
    move(arms, SHOES, SKIN)

    move(z < 0.1, SKIN, NEUTRAL)

    # Solid cloth: anything else inside these volumes is a bake fleck, so it gets painted over.
    legs = (z >= 0.1) & (z < 0.72) & (ax < 0.25)
    torso = (z >= 0.72) & (z < 1.18) & (ax < 0.17)
    for region, cloth, others in (
        (legs, PANTS, (SHIRT, SKIN, HAIR)),
        (torso, SHIRT, (PANTS, SKIN, HAIR)),
    ):
        for other in others:
            move(region, other, cloth)
        changed = region & (before != weights.argmax(-1)) & (weights.argmax(-1) == cloth)
        image = Image.fromarray((changed * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
        rgb[(np.asarray(image) > 0) & region] = ref_rgb(cloth)
    return rgb, weights


def recolor(rgb, weights, palette):
    luma = rgb @ LUMA
    out = rgb * (1 - sum(weights[..., i] for i in RECOLORED))[..., None]
    for index in RECOLORED:
        ref = ref_rgb(index)
        ratio = (luma / (ref @ LUMA))[..., None]
        if index == HAIR:
            # Brows and highlights sit far above the hair reference, so a raw ratio blows them out.
            ratio = np.minimum(ratio, HAIR_RATIO_CAP)
        # Shading follows the source luma. Half the local tint survives on skin for lips and blush.
        result = to_rgb(palette[NAMES[index]]) * ratio
        if index == SKIN:
            result = result + 0.5 * (rgb - ref * ratio)
        # Scale instead of clipping, which would turn bright skin and hair yellow.
        result = result / np.maximum(result.max(-1, keepdims=True), 1)
        out += weights[..., index, None] * result
    return np.clip(out, 0, 1)


def main():
    source = Image.open(TEX / "kid_base_albedo.png").convert("RGB")
    rgb = np.asarray(source, dtype=np.float32) / 255
    empty = rgb.sum(-1) == 0
    rgb, weights = apply_body_regions(rgb, class_weights(rgb))
    for name, palette in KIDS.items():
        out = recolor(rgb, weights, palette)
        out[empty] = 0
        Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(TEX / f"kid_{name}_albedo.png")
        print("wrote", name)


if __name__ == "__main__":
    main()
