"""Build each prop in its own .blend through the Blender bridge, then merge them into models.blend.

Rerun after a crash: props whose .blend already exists are skipped.
Pass prop names to build only those. Pass --no-merge to stay out of the main file afterwards.
"""

import pathlib
import subprocess
import sys
import time

sys.path.insert(0, r"C:/Users/mesol/workspace/blender-bridge")
from bridge_client import send

HERE = pathlib.Path(__file__).resolve().parent
BLENDS = HERE.parent / "assets" / "blends"
NAMES = "tree bench fence tower_red tower_blue bridge slide stairs swing seesaw sandbox".split()
ATTEMPT_SECONDS = 240
# Each retry coarsens the voxel mesh fed to Quad Remesher.
VOXEL_SCALES = (1.0, 2.0, 3.5, 6.0)


def call(code):
    result = send(code, timeout=600)
    if not result["ok"]:
        raise RuntimeError(result["error"])
    return result["output"]


def last_line(output):
    lines = output.strip().splitlines()
    return lines[-1] if lines else ""


def stop_engine():
    subprocess.run(["taskkill", "/IM", "xremesh.exe", "/F"], capture_output=True)
    # Give the add-on's modal timer time to notice and end before the file changes.
    time.sleep(3)


def remesh_within_limit(name, scale):
    started = time.time()
    check = f'print("yes" if bpy.data.objects.get("Retopo_{name}_Voxel") else "no")'
    call("open_blank()")
    output = call(f'start_remesh("{name}", {scale})')
    voxel_line = next((l for l in output.splitlines() if l.startswith("voxel faces")), "")
    print(name, "scale", scale, voxel_line, flush=True)
    while time.time() - started < ATTEMPT_SECONDS:
        if "yes" in call(check):
            return True
        time.sleep(3)
    print(name, "hit the limit at scale", scale, flush=True)
    stop_engine()
    return False


def build(name):
    started = time.time()
    for scale in VOXEL_SCALES:
        if remesh_within_limit(name, scale):
            break
    else:
        raise TimeoutError(f"Quad Remesher did not finish {name}")
    print(last_line(call(f'finish_remesh("{name}")')), f"{time.time() - started:.0f}s", flush=True)
    print(last_line(call(f'save_prop("{name}")')), flush=True)


def main():
    args = sys.argv[1:]
    merge = "--no-merge" not in args
    names = [a for a in args if not a.startswith("--")] or NAMES
    stop_engine()
    call((HERE / "prop_pipeline.py").read_text(encoding="utf-8"))
    call((HERE / "blender_checkpoint.py").read_text(encoding="utf-8"))
    for name in names:
        if (BLENDS / f"{name}.blend").exists():
            print("skip", name, flush=True)
            continue
        build(name)
    if merge:
        call("open_main()")
        ready = [n for n in NAMES if (BLENDS / f"{n}.blend").exists()]
        print(call(f"merge_props({ready!r})").strip(), flush=True)
        print(last_line(call("print(checkpoint())")), flush=True)
    print("all done", flush=True)


main()
