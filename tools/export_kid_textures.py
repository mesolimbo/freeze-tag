"""Convert the baked kid albedos to the WebP files the game swaps onto the shared kid model."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "textures_low"
GAME = ROOT / "assets" / "game"

GAME.mkdir(exist_ok=True)
for name in ("leo", "maya", "sam", "zoe", "toby"):
    for source, suffix in ((f"kid_{name}_albedo.png", ""), (f"kid_{name}_frozen.png", "_frozen")):
        target = GAME / f"kid_{name}{suffix}.webp"
        Image.open(SOURCE / source).convert("RGB").save(target, quality=82, method=6)
        print(target.name, target.stat().st_size // 1024, "KB")
