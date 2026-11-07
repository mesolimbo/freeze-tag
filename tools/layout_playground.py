"""Run inside Blender: place the assets at the coordinates in raw/Game.tsx. Safe to rerun.

Game (x, y, z) maps to Blender (x, -z, y), and a rotation about game Y is the same angle about Blender Z.
"""

import math
import random

import bpy

ROOT = r"C:/Users/mesol/workspace/Toys/games/freeze-tag"
MAT = ROOT + "/assets/materials"
COLLECTION = "Playground"
HALF_PARK = 22
GROUND_SIZE = 48
TILE_METRES = 6
PLAY_RADIUS = 10.56
RIM_INNER_RADIUS = 9.6
GROUND_SINK = 0.02

# Prop, (x, y, z), z rotation in radians, scale.
EQUIPMENT = [
    ("tower_red", (-2, 2, 0), 0, 1),
    ("tower_blue", (2.5, 1.5, 0), 0, 1),
    ("bridge", (0.25, 1.8, 1.35), 0, 1),
    # The game's slide and stairs slope away from the deck. These use the same footprint, rising to it.
    ("slide", (-2, -1.1, 0), 0, 1),
    ("stairs", (-2, 4.6, 0), 0, 1),
    ("swing", (0, -5, 0), 0, 1),
    ("seesaw", (-8, 0, 0), 0, 1),
    ("sandbox", (8, 4, 0), 0, 1),
]
BENCH_SPOTS = [(-12, 8), (12, 8), (-12, -8), (12, -8)]
TREE_SPOTS = [(-15, -15), (16, -16), (-17, 14), (15, 16), (-14, -3), (16, 4), (0, -18), (0, 18)]


def playground_collection():
    scene = bpy.context.scene
    col = bpy.data.collections.get(COLLECTION)
    if col:
        for ob in list(col.objects):
            bpy.data.objects.remove(ob)
    else:
        col = bpy.data.collections.new(COLLECTION)
        scene.collection.children.link(col)
    return col


def place(col, prop, location, rotation, scale=1.0, label=None):
    source = bpy.data.objects[f"P_{prop}"]
    ob = bpy.data.objects.new(label or prop, source.data)
    col.objects.link(ob)
    ob.location = location
    if location[2] == 0:
        # Remeshing moves the lowest point, so sit each prop just into the ground instead of trusting z=0.
        lowest = min(v.co.z for v in source.data.vertices)
        ob.location.z = -lowest * scale - GROUND_SINK
    ob.rotation_euler = (0, 0, rotation)
    ob.scale = (scale, scale, scale)
    return ob


def load_map(path, non_color=False):
    image = bpy.data.images.load(path, check_existing=True)
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    return image


def ground_material():
    mat = bpy.data.materials.get("Ground") or bpy.data.materials.new("Ground")
    mat.use_nodes = True
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs[0], output.inputs[0])

    coords = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / TILE_METRES, 1 / TILE_METRES, 1)
    links.new(coords.outputs["Object"], mapping.inputs[0])

    def tex(path, non_color=False):
        node = nodes.new("ShaderNodeTexImage")
        node.image = load_map(path, non_color)
        links.new(mapping.outputs[0], node.inputs[0])
        return node.outputs[0]

    # Radial blend with a noisy edge, so the play area does not end in a hard circle.
    radius = nodes.new("ShaderNodeVectorMath")
    radius.operation = "LENGTH"
    links.new(coords.outputs["Object"], radius.inputs[0])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.9
    links.new(coords.outputs["Object"], noise.inputs[0])
    wobble = nodes.new("ShaderNodeMath")
    wobble.operation = "MULTIPLY_ADD"
    wobble.inputs[1].default_value = 1.2
    wobble.inputs[2].default_value = -0.6
    links.new(noise.outputs[0], wobble.inputs[0])
    edge_radius = nodes.new("ShaderNodeMath")
    edge_radius.operation = "ADD"
    links.new(radius.outputs["Value"], edge_radius.inputs[0])
    links.new(wobble.outputs[0], edge_radius.inputs[1])

    blend = nodes.new("ShaderNodeMapRange")
    blend.inputs["From Min"].default_value = PLAY_RADIUS - 0.25
    blend.inputs["From Max"].default_value = PLAY_RADIUS + 0.25
    links.new(edge_radius.outputs[0], blend.inputs["Value"])

    rim = nodes.new("ShaderNodeMapRange")
    rim.inputs["From Min"].default_value = RIM_INNER_RADIUS - 0.3
    rim.inputs["From Max"].default_value = RIM_INNER_RADIUS + 0.3
    rim.inputs["To Min"].default_value = 1.0
    rim.inputs["To Max"].default_value = 0.72
    links.new(edge_radius.outputs[0], rim.inputs["Value"])

    surface = nodes.new("ShaderNodeMixRGB")
    surface.blend_type = "MULTIPLY"
    surface.inputs[0].default_value = 1
    links.new(tex(f"{MAT}/playsurface/basecolor.png"), surface.inputs[1])
    links.new(rim.outputs[0], surface.inputs[2])

    color = nodes.new("ShaderNodeMixRGB")
    links.new(blend.outputs[0], color.inputs[0])
    links.new(surface.outputs[0], color.inputs[1])
    links.new(tex(f"{MAT}/grass/basecolor.png"), color.inputs[2])
    links.new(color.outputs[0], bsdf.inputs["Base Color"])

    rough = nodes.new("ShaderNodeMixRGB")
    links.new(blend.outputs[0], rough.inputs[0])
    links.new(tex(f"{MAT}/playsurface/roughness.png", True), rough.inputs[1])
    links.new(tex(f"{MAT}/grass/roughness.png", True), rough.inputs[2])
    links.new(rough.outputs[0], bsdf.inputs["Roughness"])

    mixed_normal = nodes.new("ShaderNodeMixRGB")
    links.new(blend.outputs[0], mixed_normal.inputs[0])
    links.new(tex(f"{MAT}/playsurface/normal.png", True), mixed_normal.inputs[1])
    links.new(tex(f"{MAT}/grass/normal.png", True), mixed_normal.inputs[2])
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(mixed_normal.outputs[0], normal_map.inputs["Color"])
    links.new(normal_map.outputs[0], bsdf.inputs["Normal"])
    return mat


def add_ground(col):
    half = GROUND_SIZE / 2
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-half, -half, 0), (half, -half, 0), (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)])
    mesh.materials.append(ground_material())
    col.objects.link(bpy.data.objects.new("Ground", mesh))


def tiled_material(name, folder, opacity_from_vertices=False):
    """A material glTF can export: tiled maps on a UV layer, with optional vertex color and alpha."""
    existing = bpy.data.materials.get(name)
    if existing:
        bpy.data.materials.remove(existing)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    base = nodes.new("ShaderNodeTexImage")
    base.image = load_map(f"{MAT}/{folder}/basecolor.png")
    rough = nodes.new("ShaderNodeTexImage")
    rough.image = load_map(f"{MAT}/{folder}/roughness.png", True)
    normal = nodes.new("ShaderNodeTexImage")
    normal.image = load_map(f"{MAT}/{folder}/normal.png", True)
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(rough.outputs[0], bsdf.inputs["Roughness"])
    links.new(normal.outputs[0], normal_map.inputs["Color"])
    links.new(normal_map.outputs[0], bsdf.inputs["Normal"])
    if opacity_from_vertices:
        attribute = nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = "Col"
        multiply = nodes.new("ShaderNodeMixRGB")
        multiply.blend_type = "MULTIPLY"
        multiply.inputs[0].default_value = 1
        links.new(base.outputs[0], multiply.inputs[1])
        links.new(attribute.outputs["Color"], multiply.inputs[2])
        links.new(multiply.outputs[0], bsdf.inputs["Base Color"])
        links.new(attribute.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.surface_render_method = "BLENDED"
    else:
        links.new(base.outputs[0], bsdf.inputs["Base Color"])
    return mat


def planar_uvs(mesh):
    layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        layer.data[loop.index].uv = (co.x / TILE_METRES, co.y / TILE_METRES)


def add_low_ground(col):
    """Grass quad plus a play-area disc whose soft edge is vertex alpha, so no custom shader is needed."""
    half = GROUND_SIZE / 2
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-half, -half, 0), (half, -half, 0), (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)])
    planar_uvs(mesh)
    mesh.materials.append(tiled_material("Ground_Grass", "grass"))
    col.objects.link(bpy.data.objects.new("Ground", mesh))

    segments = 64
    # Radius offset from the play edge, brightness, alpha.
    rings = [(-1.25, 1.0, 1.0), (-0.65, 0.72, 1.0), (-0.15, 0.72, 1.0), (0.25, 0.72, 0.0)]
    verts = [(0, 0, 0.02)]
    colors = [(1, 1, 1, 1)]
    for offset, shade, alpha in rings:
        for i in range(segments):
            angle = math.tau * i / segments
            wobble = 0.22 * math.sin(angle * 5 + 1.3) + 0.14 * math.sin(angle * 11 + 0.4) + 0.08 * math.sin(angle * 23)
            radius = PLAY_RADIUS + offset + wobble
            verts.append((radius * math.cos(angle), radius * math.sin(angle), 0.02))
            colors.append((shade, shade, shade, alpha))
    faces = [(0, 1 + i, 1 + (i + 1) % segments) for i in range(segments)]
    for ring in range(len(rings) - 1):
        start, next_start = 1 + ring * segments, 1 + (ring + 1) * segments
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((start + i, next_start + i, next_start + j, start + j))
    disc = bpy.data.meshes.new("PlayArea")
    disc.from_pydata(verts, [], faces)
    planar_uvs(disc)
    attribute = disc.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    for i, color in enumerate(colors):
        attribute.data[i].color_srgb = color
    disc.materials.append(tiled_material("Ground_PlayArea", "playsurface", True))
    col.objects.link(bpy.data.objects.new("PlayArea", disc))


def add_low_kids():
    """Five objects sharing one mesh, each with its own material, at the KIDS_CONFIG spawn points."""
    scene = bpy.context.scene
    kids = bpy.data.collections.get("Kids")
    if kids:
        for ob in list(kids.objects):
            bpy.data.objects.remove(ob)
    else:
        kids = bpy.data.collections.new("Kids")
        scene.collection.children.link(kids)
    spawns = {"leo": (6, -8), "maya": (-7, -10), "sam": (8, 8), "zoe": (-8, 7), "toby": (0, -14)}
    mesh = bpy.data.objects["P_kid"].data
    rig_data = bpy.data.objects["KidRig"].data
    idle = bpy.data.actions["idle"]
    for name, (x, game_z) in spawns.items():
        rig = bpy.data.objects.new(f"Rig_{name}", rig_data)
        kids.objects.link(rig)
        rig.location = (x, -game_z, 0)
        rig.animation_data_create()
        rig.animation_data.action = idle
        rig.animation_data.action_slot = idle.slots[0]
        ob = bpy.data.objects.new(f"Kid_{name}", mesh)
        kids.objects.link(ob)
        ob.parent = rig
        ob.material_slots[0].link = "OBJECT"
        ob.material_slots[0].material = bpy.data.materials[f"KidLow_{name}"]
        ob.modifiers.new("Armature", "ARMATURE").object = rig


def add_fence(col):
    # Sections butt post to post, so 11 of them close the perimeter corner to corner.
    for i, offset in enumerate(range(-20, 21, 4)):
        flip = math.pi if i % 2 else 0
        place(col, "fence", (offset, HALF_PARK, 0), flip, label="fence")
        place(col, "fence", (offset, -HALF_PARK, 0), flip, label="fence")
        place(col, "fence", (HALF_PARK, offset, 0), math.pi / 2 + flip, label="fence")
        place(col, "fence", (-HALF_PARK, offset, 0), math.pi / 2 + flip, label="fence")


def add_trees(col):
    rng = random.Random(7)
    for x, game_z in TREE_SPOTS:
        place(col, "tree", (x, -game_z, 0), rng.uniform(0, math.tau), rng.uniform(0.92, 1.08))


def setup_world():
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputWorld")
    background = tree.nodes.new("ShaderNodeBackground")
    # Vertical gradient from the game's hemisphere sky to its backgroundColor.
    coords = tree.nodes.new("ShaderNodeTexCoord")
    split = tree.nodes.new("ShaderNodeSeparateXYZ")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.75, 0.87, 0.97, 1)
    ramp.color_ramp.elements[1].color = (0.17, 0.46, 0.92, 1)
    ramp.color_ramp.elements[1].position = 0.6
    tree.links.new(coords.outputs["Generated"], split.inputs[0])
    tree.links.new(split.outputs["Z"], ramp.inputs[0])
    tree.links.new(ramp.outputs[0], background.inputs[0])
    background.inputs[1].default_value = 1.0
    tree.links.new(background.outputs[0], output.inputs[0])


def setup_lights_and_cameras(col):
    # DynamicSun in Game.tsx shines from (15, 25, 15), which is (15, -15, 25) here.
    sun_data = bpy.data.lights.get("Sun") or bpy.data.lights.new("Sun", "SUN")
    sun_data.color = (1.0, 0.96, 0.81)
    sun_data.energy = 3.5
    sun_data.angle = 0.03
    sun = bpy.data.objects.new("Sun", sun_data)
    col.objects.link(sun)
    sun.location = (15, -15, 25)
    sun.rotation_euler = (0, 0, 0)
    direction = sun.location.normalized()
    sun.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()

    overview_data = bpy.data.cameras.get("Cam_Overview") or bpy.data.cameras.new("Cam_Overview")
    overview_data.lens = 28
    overview = bpy.data.objects.new("Cam_Overview", overview_data)
    col.objects.link(overview)
    overview.location = (21, -30, 17)
    target = bpy.data.objects.new("Cam_Target", None)
    aim = (target.location.copy() - overview.location)
    overview.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()
    bpy.data.objects.remove(target)

    # The game's start view: fov 75, eye height 1.6, slight downward tilt.
    player_data = bpy.data.cameras.get("Cam_Player") or bpy.data.cameras.new("Cam_Player")
    player_data.sensor_fit = "VERTICAL"
    player_data.angle_y = math.radians(75)
    player = bpy.data.objects.new("Cam_Player", player_data)
    col.objects.link(player)
    player.location = (0, -12, 1.6)
    player.rotation_euler = (math.pi / 2 - 0.06, 0, 0)
    bpy.context.scene.camera = overview


def add_benches(col):
    # The bench mesh faces -Y, so this angle turns its seat toward the middle of the playground.
    for x, y in BENCH_SPOTS:
        place(col, "bench", (x, y, 0), math.atan2(-x, y))


def add_ice_block():
    """Source asset for the frozen state in IceBlock, hidden until the game needs it."""
    if bpy.data.objects.get("P_ice_block"):
        return
    mesh = bpy.data.meshes.new("P_ice_block")
    w, d, h = 0.65, 0.65, 1.9
    verts = [(x, y, z) for z in (0, h) for x, y in ((-w, -d), (w, -d), (w, d), (-w, d))]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh.from_pydata(verts, [], faces)
    mat = bpy.data.materials.new("P_ice_block")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.65, 0.95, 0.99, 1)
    bsdf.inputs["Roughness"].default_value = 0.08
    bsdf.inputs["IOR"].default_value = 1.31
    bsdf.inputs["Transmission Weight"].default_value = 0.9
    mesh.materials.append(mat)
    ob = bpy.data.objects.new("P_ice_block", mesh)
    bevel = ob.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.06
    bevel.segments = 3
    bpy.data.collections["Assets"].objects.link(ob)


def main():
    col = playground_collection()
    low_poly = bpy.data.objects.get("P_kid") is not None
    if low_poly:
        add_low_ground(col)
        add_low_kids()
    else:
        add_ground(col)
    add_fence(col)
    add_trees(col)
    add_benches(col)
    for prop, location, rotation, scale in EQUIPMENT:
        place(col, prop, location, rotation, scale)
    add_ice_block()
    setup_world()
    setup_lights_and_cameras(col)
    assets = bpy.data.collections["Assets"]
    assets.hide_render = True
    bpy.context.view_layer.layer_collection.children["Assets"].exclude = True
    for name in ("Kid_Raw",):
        layer = bpy.context.view_layer.layer_collection.children.get(name)
        if layer:
            layer.exclude = True
    for name in ("Cube", "Light"):
        ob = bpy.data.objects.get(name)
        if ob:
            ob.hide_render = True
            ob.hide_set(True)
    for ob in bpy.data.collections["Kids"].objects:
        ob.hide_render = False
        ob.hide_set(False)
    bpy.context.scene.frame_set(0)
    # The game wants saturated cartoon colors, which AgX mutes.
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.look = "None"
    print("placed", len(col.objects), "objects")


main()
