"""Build browser-ready props in assets/blends_low, then merge and lay them out in models_low.blend.

Rerun after a crash: anything whose .blend already exists is skipped.
Pass names to build only those. Pass --no-merge to skip the merge and layout.
"""

import pathlib
import subprocess
import sys
import time

sys.path.insert(0, r"C:/Users/mesol/workspace/blender-bridge")
from bridge_client import send

HERE = pathlib.Path(__file__).resolve().parent
BLENDS = HERE.parent / "assets" / "blends_low"
NAMES = "kid tree bench fence tower_red tower_blue bridge slide stairs swing seesaw sandbox".split()
PROPS = NAMES[1:]
ATTEMPT_SECONDS = 150
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
    time.sleep(3)


def wait_for(object_name):
    started = time.time()
    check = f'print("yes" if bpy.data.objects.get("{object_name}") else "no")'
    while time.time() - started < ATTEMPT_SECONDS:
        if "yes" in call(check):
            return True
        time.sleep(2)
    print(object_name, "hit the limit", flush=True)
    stop_engine()
    return False


def build_kid():
    call("open_blank()")
    call("start_kid()")
    if not wait_for("Retopo_Kid_Voxel"):
        raise TimeoutError("Quad Remesher did not finish the kid")
    print(last_line(call("finish_kid()")), flush=True)
    print(last_line(call('save_prop("kid")')), flush=True)


def build_prop(name):
    started = time.time()
    for scale in VOXEL_SCALES:
        call("open_blank()")
        output = call(f'start_remesh("{name}", {scale})')
        voxel_line = next((l for l in output.splitlines() if l.startswith("voxel faces")), "")
        print(name, "scale", scale, voxel_line, flush=True)
        if wait_for(f"Retopo_{name}_Voxel"):
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
    call("use_low_profile()")
    for name in names:
        if (BLENDS / f"{name}.blend").exists():
            print("skip", name, flush=True)
            continue
        if name == "kid":
            build_kid()
        else:
            build_prop(name)
    if merge:
        call("ensure_main()")
        ready = [n for n in PROPS if (BLENDS / f"{n}.blend").exists()]
        print(call(f"merge_props({ready!r})").strip(), flush=True)
        print(call("merge_kid()").strip(), flush=True)
        print(last_line(call((HERE / "layout_playground.py").read_text(encoding="utf-8"))), flush=True)
        call("bpy.ops.outliner.orphans_purge(do_recursive=True)")
        print(last_line(call("print(checkpoint())")), flush=True)
    print("all done", flush=True)


main()
