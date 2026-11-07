"""Run inside Blender with rig_kid.py loaded: build the ice that forms around the kid's frozen pose."""

import os

import bmesh
import bpy

SHELL_OFFSET = 0.055
SHELL_VOXEL = 0.05
SHELL_FACES = 1100
SHELL_GLB = GAME + "/ice_shell.glb"


def build_ice_shell():
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.open_mainfile(filepath=RIGGED)
    scene = bpy.context.scene
    rig = bpy.data.objects["KidRig"]
    kid = bpy.data.objects["P_kid"]
    action = bpy.data.actions["frozen"]
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    scene.frame_set(0)
    bpy.context.view_layer.update()

    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(kid.evaluated_get(depsgraph))
    mesh.name = "ice_shell"
    mesh.materials.clear()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    # Inflate along the normals, so the shell clears the body before it is fused into one surface.
    for vert in bm.verts:
        vert.co += vert.normal * SHELL_OFFSET
    bm.to_mesh(mesh)
    bm.free()
    shell = bpy.data.objects.new("ice_shell", mesh)
    scene.collection.objects.link(shell)

    with op_context(shell, [shell]):
        mesh.remesh_voxel_size = SHELL_VOXEL
        mesh.remesh_voxel_adaptivity = 0
        bpy.ops.object.voxel_remesh()
        decimate = shell.modifiers.new("Facets", "DECIMATE")
        decimate.ratio = min(1.0, SHELL_FACES / len(mesh.polygons))
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        bpy.ops.object.shade_flat()

    with op_context(shell, [shell]):
        bpy.ops.export_scene.gltf(
            filepath=SHELL_GLB,
            export_format="GLB",
            use_selection=True,
            export_animations=False,
            export_lights=False,
            export_cameras=False,
            export_materials="NONE",
        )
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    zs = [v.co.z for v in mesh.vertices]
    print(
        "shell faces", len(mesh.polygons),
        "x", round(min(xs), 2), round(max(xs), 2),
        "y", round(min(ys), 2), round(max(ys), 2),
        "z", round(min(zs), 2), round(max(zs), 2),
        "KB", os.path.getsize(SHELL_GLB) // 1024,
    )
