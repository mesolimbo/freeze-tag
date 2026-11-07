"""Run inside Blender: save models.blend and rotate copies through backups/ on a timer."""

import os
import shutil
import time

import bpy

BACKUP_DIR = r"C:/Users/mesol/workspace/Toys/games/freeze-tag/backups"
SLOTS = 4
INTERVAL_SECONDS = 300


def checkpoint():
    """Save the open file, then copy it into the oldest backup slot."""
    # Single-prop working files can be rebuilt from their GLBs, so only the main file is backed up.
    if os.path.basename(bpy.data.filepath) not in ("models.blend", "models_low.blend"):
        return None
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.save_mainfile()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stem = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
    paths = [os.path.join(BACKUP_DIR, f"{stem}.{i}.blend") for i in range(SLOTS)]
    missing = [p for p in paths if not os.path.exists(p)]
    target = missing[0] if missing else min(paths, key=os.path.getmtime)
    # Copy to a temp name first so a crash mid-copy never destroys the previous backup in the slot.
    temp = target + ".tmp"
    shutil.copy2(bpy.data.filepath, temp)
    os.replace(temp, target)
    os.utime(target, (time.time(), time.time()))
    print("checkpoint", target, os.path.getsize(target) // 1048576, "MB")
    return target


def _tick():
    try:
        checkpoint()
    except Exception as exc:
        print("checkpoint failed:", exc)
    return INTERVAL_SECONDS


if bpy.app.timers.is_registered(globals().get("freeze_tag_tick")):
    bpy.app.timers.unregister(freeze_tag_tick)
freeze_tag_tick = _tick
bpy.app.timers.register(freeze_tag_tick, first_interval=INTERVAL_SECONDS, persistent=True)
checkpoint()
