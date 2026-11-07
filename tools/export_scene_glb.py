"""Run inside Blender with models_low.blend open: export the playground, without the kids, for the game."""

import os

import bpy

TARGET = r"C:/Users/mesol/workspace/Toys/games/freeze-tag/game/public/assets/park.glb"


def make_matte():
    """The ice block keeps its gloss. Inputs driven by a roughness map are left to the map."""
    for material in bpy.data.materials:
        if not material.use_nodes or material.name == "P_ice_block":
            continue
        for node in material.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED" and not node.inputs["Roughness"].links:
                node.inputs["Roughness"].default_value = 0.95


def export_park():
    assert bpy.data.filepath.endswith("models_low.blend")
    make_matte()
    window = bpy.context.window_manager.windows[0]
    layers = window.view_layer.layer_collection.children
    # The kids ship in their own file with their rig.
    layers["Kids"].exclude = True
    os.makedirs(os.path.dirname(TARGET), exist_ok=True)
    try:
        with bpy.context.temp_override(window=window, view_layer=window.view_layer):
            bpy.ops.export_scene.gltf(
                filepath=TARGET,
                export_format="GLB",
                use_visible=True,
                export_animations=False,
                export_image_format="WEBP",
                export_image_quality=80,
                export_lights=False,
                export_cameras=False,
            )
    finally:
        layers["Kids"].exclude = False
    print("park.glb KB", os.path.getsize(TARGET) // 1024)


export_park()
