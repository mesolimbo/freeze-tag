"""Turn the shell around the frozen pose into chunky, rough-cut ice cubes.

Reads assets/game/ice_shell.glb from build_ice_shell.py, which is already posed and inflated,
and writes ice_blocks.glb to assets/game and the game's public assets.
"""

import json
import shutil
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "game" / "ice_shell.glb"
TARGET = ROOT / "assets" / "game" / "ice_blocks.glb"
PUBLIC = ROOT / "game" / "public" / "assets" / "ice_blocks.glb"

CELL = 0.21
# Corner movement that makes the cubes look cut from ice instead of voxels.
ROUGHNESS = 0.045
GROUND = -0.02
FACES = (
    ((1, 0, 0), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))),
    ((-1, 0, 0), ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0))),
    ((0, 1, 0), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0))),
    ((0, -1, 0), ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1))),
    ((0, 0, 1), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))),
    ((0, 0, -1), ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0))),
)


def read_positions(path):
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20 : 20 + json_length])
    binary = data[20 + json_length + 8 :]
    accessor = doc["accessors"][doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    view = doc["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return np.frombuffer(binary, dtype=np.float32, count=accessor["count"] * 3, offset=start).reshape(-1, 3)


def solid_cells(points):
    """Mark cells the shell touches, then fill everything the outside cannot reach."""
    origin = np.array([points[:, 0].min(), 0.0, points[:, 2].min()]) - CELL * 0.25
    origin[1] = GROUND
    cells = np.floor((points - origin) / CELL).astype(int)
    cells[:, 1] = np.maximum(cells[:, 1], 0)
    shape = cells.max(0) + 3
    grid = np.zeros(shape, dtype=bool)
    # One cell of padding on x and z, and above, leaves a path around the figure for the flood.
    grid[cells[:, 0] + 1, cells[:, 1], cells[:, 2] + 1] = True
    origin = origin - np.array([CELL, 0, CELL])

    outside = np.zeros(shape, dtype=bool)
    stack = [(0, shape[1] - 1, 0)]
    outside[stack[0]] = True
    while stack:
        x, y, z = stack.pop()
        for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
            n = (x + dx, y + dy, z + dz)
            if all(0 <= n[i] < shape[i] for i in range(3)) and not grid[n] and not outside[n]:
                outside[n] = True
                stack.append(n)
    return ~outside, origin


def build_triangles(solid, origin):
    rng = np.random.default_rng(11)
    corners = {}

    def corner(index):
        if index not in corners:
            offset = rng.uniform(-ROUGHNESS, ROUGHNESS, 3)
            position = origin + np.array(index) * CELL + offset
            if index[1] == 0:
                # The bottom stays flat so the ice sits on the ground.
                position[1] = GROUND
            corners[index] = position
        return corners[index]

    positions, normals = [], []
    shape = solid.shape
    for x, y, z in zip(*np.nonzero(solid)):
        for direction, quad in FACES:
            n = (x + direction[0], y + direction[1], z + direction[2])
            inside = all(0 <= n[i] < shape[i] for i in range(3)) and solid[n]
            # The underside faces the ground, so it never shows.
            if inside or (direction[1] == -1 and y == 0):
                continue
            a, b, c, d = (corner((int(x + q[0]), int(y + q[1]), int(z + q[2]))) for q in quad)
            for triangle in ((a, b, c), (a, c, d)):
                normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
                normal = normal / np.linalg.norm(normal)
                for point in triangle:
                    positions.append(point)
                    normals.append(normal)
    return np.array(positions, dtype=np.float32), np.array(normals, dtype=np.float32)


def write_glb(path, positions, normals):
    binary = positions.tobytes() + normals.tobytes()
    doc = {
        "asset": {"version": "2.0", "generator": "build_ice_blocks.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "ice_blocks"}],
        "meshes": [{"name": "ice_blocks", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}}]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": positions.nbytes, "target": 34962},
            {"buffer": 0, "byteOffset": positions.nbytes, "byteLength": normals.nbytes, "target": 34962},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions),
                "type": "VEC3",
                "min": positions.min(0).tolist(),
                "max": positions.max(0).tolist(),
            },
            {"bufferView": 1, "componentType": 5126, "count": len(normals), "type": "VEC3"},
        ],
    }
    text = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(text) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(text), b"JSON") + text)
        f.write(struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def main():
    solid, origin = solid_cells(read_positions(SOURCE))
    positions, normals = build_triangles(solid, origin)
    write_glb(TARGET, positions, normals)
    shutil.copy(TARGET, PUBLIC)
    print(
        "ice blocks: cells", int(solid.sum()), "triangles", len(positions) // 3,
        "KB", TARGET.stat().st_size // 1024,
        "min", positions.min(0).round(2).tolist(), "max", positions.max(0).round(2).tolist(),
    )


if __name__ == "__main__":
    main()
