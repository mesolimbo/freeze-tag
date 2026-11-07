"""Zip game/dist for itch.io, which needs index.html at the zip root and at most 1000 files."""

import shutil
import zipfile
from pathlib import Path

GAME = Path(__file__).resolve().parent.parent / "game"
DIST = GAME / "dist"
RELEASE = GAME / "release"
TARGET = RELEASE / "park-freeze-tag-itch.zip"

files = sorted(p for p in DIST.rglob("*") if p.is_file())
assert (DIST / "index.html") in files, "run the Vite build first"
assert len(files) <= 1000, "itch.io allows at most 1000 files"
assert not (DIST / "test-freeze.html").exists(), "rebuild to remove the test page"

RELEASE.mkdir(exist_ok=True)
with zipfile.ZipFile(TARGET, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(DIST).as_posix())

check = RELEASE / "check"
shutil.rmtree(check, ignore_errors=True)
with zipfile.ZipFile(TARGET) as archive:
    archive.extractall(check)
print(f"{TARGET.name}: {TARGET.stat().st_size / 1048576:.1f} MB, {len(files)} files, unpacked copy in release/check")
