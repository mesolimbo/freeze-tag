"""Run inside Blender through the bridge: straighten, fit, remesh and bake generated props."""

import json
import math
import os

import bmesh
import bpy
import mathutils
import numpy as np

ROOT = r"C:/Users/mesol/workspace/Toys/games/freeze-tag"
RAW = ROOT + "/assets/models_raw"
TEX = ROOT + "/assets/textures"
ALIGN_FILE = ROOT + "/assets/props_align.json"
BLENDS = ROOT + "/assets/blends"
MAIN_FILE = ROOT + "/models.blend"
QR_INPUT_FACES = 120000
LINK_PITCH = 0.115
LINK_SEGMENTS = 8
LINK_HALF_WIDTH = 0.042
LINK_HALF_LENGTH = 0.072
LINK_TUBE = 0.014
FENCE_POST_SIDES = 12
FENCE_RAIL_SIDES = 6
ADAPT_QUADS = True
UV_MARGIN = 0.004

# size is the fitted (x, y, z) in metres. Items in Blender axes: game (x, y, z) is (x, -z, y).
PROPS = {
    "tree": {"voxel": 0.02, "quads": 12000, "tex": 2048, "height": 7.0, "skip_align": True, "hard": False},
    "bench": {"voxel": 0.006, "quads": 4000, "tex": 2048, "size": (2.2, 0.8, 1.0), "hard": True},
    "fence": {"voxel": 0.008, "quads": 1500, "tex": 1024, "size": (4.3, 0.34, 2.0), "hard": True},
    "tower_red": {"voxel": 0.012, "quads": 6000, "tex": 2048, "size": (3.6, 3.6, 4.4), "hard": True, "largest": True, "cage": 0.05, "thicken": 0.04, "hard_edges": True},
    "tower_blue": {"voxel": 0.012, "quads": 6000, "tex": 2048, "size": (3.4, 3.4, 4.8), "hard": True, "ladder_on_x": True},
    "bridge": {"voxel": 0.008, "quads": 1500, "tex": 1024, "size": (2.0, 1.4, 1.1), "hard": True, "largest": True, "crop": {"z_min": 0.29, "y_max": 0.91}},
    "slide": {"voxel": 0.008, "quads": 2500, "tex": 2048, "size": (1.4, 3.0, 1.45), "hard": True, "tilt_span": 30},
    "stairs": {"voxel": 0.008, "quads": 2500, "tex": 1024, "size": (1.6, 2.0, 1.4), "hard": True},
    "swing": {"voxel": 0.006, "quads": 5000, "tex": 2048, "size": (7.0, 2.2, 3.28), "hard": True},
    "seesaw": {"voxel": 0.008, "quads": 2000, "tex": 1024, "size": (4.4, 1.2, 1.25), "hard": True},
    "sandbox": {"voxel": 0.012, "quads": 1500, "tex": 2048, "size": (4.2, 4.2, 0.45), "hard": True},
}


def load_align():
    if os.path.exists(ALIGN_FILE):
        with open(ALIGN_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_align(data):
    with open(ALIGN_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
        f.write("\n")


def import_raw(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{RAW}/{name}.glb")
    ob = next(o for o in bpy.data.objects if o not in before)
    ob.name = f"{name}_High"
    return ob


def face_samples(ob, count=8000):
    mesh = ob.data
    n = len(mesh.polygons)
    normals = np.empty(n * 3, dtype=np.float32)
    areas = np.empty(n, dtype=np.float32)
    mesh.polygons.foreach_get("normal", normals)
    mesh.polygons.foreach_get("area", areas)
    normals = normals.reshape(-1, 3)
    rng = np.random.default_rng(1)
    picks = rng.choice(n, min(count, n), replace=False)
    return normals[picks], areas[picks]


def euler_matrix(a, b, y):
    ca, sa, cb, sb, cy, sy = np.cos(a), np.sin(a), np.cos(b), np.sin(b), np.cos(y), np.sin(y)
    rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
    ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]])
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    return rz @ ry @ rx


def manhattan_rotation(normals, areas, tilt_span=50):
    """Find the rotation that lines surface normals up with the X, Y and Z axes."""

    def score(a, b, y):
        rotated = normals @ euler_matrix(a, b, y).T
        return float((areas * (np.abs(rotated).max(1) ** 8)).sum())

    best = (0.0, 0.0, 0.0)
    span, step = math.radians(tilt_span), math.radians(10)
    yaw_span = math.radians(50)
    for _ in range(3):
        offsets = np.arange(-span, span + 1e-6, step)
        yaws = np.arange(-yaw_span, yaw_span + 1e-6, step)
        candidates = [
            (best[0] + a, best[1] + b, best[2] + y) for a in offsets for b in offsets for y in yaws
        ]
        best = max(candidates, key=lambda c: score(*c))
        span, yaw_span, step = step, step, step / 4
    return euler_matrix(*best)


def straighten(name):
    """Compute and store the base rotation for one prop, then return the imported object."""
    ob = import_raw(name)
    data = load_align()
    if name in data:
        return ob
    if PROPS[name].get("skip_align"):
        rotation = np.eye(3)
    else:
        rotation = manhattan_rotation(*face_samples(ob), PROPS[name].get("tilt_span", 50))
    data.setdefault(name, {})["base"] = rotation.tolist()
    data[name].setdefault("extra", [0.0, 0.0, 0.0])
    save_align(data)
    return ob


def full_rotation(name):
    """Return the stored rotation: the automatic base, then manual XYZ degrees on top."""
    entry = load_align()[name]
    base = mathutils.Matrix(entry["base"]).to_4x4()
    ex, ey, ez = (math.radians(v) for v in entry["extra"])
    extra = (
        mathutils.Matrix.Rotation(ez, 4, "Z")
        @ mathutils.Matrix.Rotation(ey, 4, "Y")
        @ mathutils.Matrix.Rotation(ex, 4, "X")
    )
    return extra @ base


def drop_fragments(ob, largest_only):
    """Delete disconnected scraps that reconstruction leaves floating near the prop.

    glTF imports split vertices along UV seams, so connectivity is computed on welded positions.
    """
    mesh = ob.data
    count = len(mesh.vertices)
    coords = np.empty(count * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coords)
    _, welded = np.unique(np.round(coords.reshape(-1, 3), 5), axis=0, return_inverse=True)
    welded = welded.ravel()
    edges = np.empty(len(mesh.edges) * 2, dtype=np.int32)
    mesh.edges.foreach_get("vertices", edges)
    parent = list(range(int(welded.max()) + 1))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in welded[edges].reshape(-1, 2).tolist():
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(len(parent))])[welded]
    ids, sizes = np.unique(roots, return_counts=True)
    limit = sizes.max() if largest_only else count * 0.002
    doomed = np.isin(roots, ids[sizes < limit])
    if not doomed.any():
        return 0
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.flatnonzero(doomed).tolist()], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return int((sizes < limit).sum())


def crop_box(ob, crop):
    """Cut away scraps fused to the prop. Limits are fractions of the bounding box."""
    mesh = ob.data
    coords = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)
    lo, hi = coords.min(0), coords.max(0)
    relative = (coords - lo) / (hi - lo)
    doomed = np.zeros(len(coords), dtype=bool)
    for key, limit in crop.items():
        axis = "xyz".index(key[0])
        doomed |= relative[:, axis] < limit if key.endswith("min") else relative[:, axis] > limit
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.flatnonzero(doomed).tolist()], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def fit(ob, name):
    """Bake the rotation and scale into the mesh. Origin ends at the base centre, z=0 at the bottom."""
    mesh = ob.data
    spec = PROPS[name]
    drop_fragments(ob, spec.get("largest", False))
    mesh.transform(full_rotation(name))
    if "crop" in spec:
        crop_box(ob, spec["crop"])
    count = len(mesh.vertices)
    coords = np.empty(count * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)
    lo, hi = coords.min(0), coords.max(0)
    if "height" in spec:
        scale = np.full(3, spec["height"] / (hi[2] - lo[2]))
        # Centre on the trunk, because the canopy is lopsided.
        low = coords[coords[:, 2] < lo[2] + (hi[2] - lo[2]) * 0.12]
        centre = np.array([*np.median(low[:, :2], axis=0), lo[2]])
    else:
        scale = np.array(spec["size"]) / (hi - lo)
        centre = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
        if spec.get("ladder_on_x"):
            # The ladder hangs off the +X side: square the tower up from its Y extent and centre on the body.
            scale[0] = scale[1]
            centre[0] = lo[0] + (hi[1] - lo[1]) / 2
    coords = (coords - centre) * scale
    mesh.vertices.foreach_set("co", coords.ravel())
    mesh.update()
    bpy.context.view_layer.update()


def assets_collection():
    scene = bpy.context.scene
    col = bpy.data.collections.get("Assets") or bpy.data.collections.new("Assets")
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    return col


def select_only(ob):
    # Objects linked moments ago are not selectable until the view layer catches up.
    bpy.context.view_layer.update()
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    # Quad Remesher hides its input, which can leave a reloaded object unselectable.
    ob.hide_viewport = False
    ob.hide_select = False
    ob.hide_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.context.view_layer.update()


def start_remesh(name, voxel_scale=1.0):
    """Fit the prop, make a watertight voxel copy and start Quad Remesher, which runs modally."""
    spec = PROPS[name]
    hi = import_raw(name)
    fit(hi, name)
    if spec.get("handmade") and not ADAPT_QUADS:
        build_fence_low(hi)
        print("voxel faces 0 input faces 0 handmade")
        return
    vox = hi.copy()
    vox.data = hi.data.copy()
    vox.name = vox.data.name = f"{name}_Voxel"
    hi.users_collection[0].objects.link(vox)
    vox.data.materials.clear()
    for attr in list(vox.data.color_attributes):
        vox.data.color_attributes.remove(attr)
    select_only(vox)
    if "thicken" in spec:
        # Shells thinner than a voxel come out of the voxel remesh full of holes.
        solidify = vox.modifiers.new("Solidify", "SOLIDIFY")
        solidify.thickness = spec["thicken"]
        solidify.offset = 0
        bpy.ops.object.modifier_apply(modifier=solidify.name)
    vox.data.remesh_voxel_size = spec["voxel"] * voxel_scale
    vox.data.remesh_voxel_adaptivity = 0
    bpy.ops.object.voxel_remesh()
    voxel_faces = len(vox.data.polygons)
    if voxel_faces > QR_INPUT_FACES:
        # Quad Remesher stalls on dense or decimated input, so coarsen the even voxel grid instead.
        vox.data.remesh_voxel_size *= math.sqrt(voxel_faces / QR_INPUT_FACES)
        bpy.ops.object.voxel_remesh()
    print("voxel faces", voxel_faces, "input faces", len(vox.data.polygons), "size", vox.data.remesh_voxel_size)
    qr = bpy.context.scene.qremesher
    qr.target_count = spec["quads"]
    qr.adaptive_size = 50
    qr.adapt_quad_count = ADAPT_QUADS
    qr.use_materials = False
    qr.use_normals = False
    # Hard-edge detection stalls the engine on large flat panels, and the baked normal map keeps the edges.
    qr.autodetect_hard_edges = spec.get("hard_edges", False)
    qr.symmetry_x = qr.symmetry_y = qr.symmetry_z = False
    qr.hide_input = True
    window = bpy.context.window_manager.windows[0]
    area = next(a for a in window.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(window=window, area=area, region=region):
        bpy.ops.qremesher.remesh()


def base_color_image(material):
    principled = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    node = principled.inputs["Base Color"].links[0].from_node
    while node.type != "TEX_IMAGE":
        node = node.inputs[0].links[0].from_node
    return node.image


def new_image(name, size, non_color=False):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return image


def finish_remesh(name):
    """Unwrap the retopo, bake from the high mesh, then remove the high and voxel meshes."""
    spec = PROPS[name]
    scene = bpy.context.scene
    hi = bpy.data.objects[f"{name}_High"]
    low = bpy.data.objects[f"Retopo_{name}_Voxel"]
    low.name = low.data.name = f"P_{name}"
    if spec.get("bake_from_detailed"):
        hi = swap_in_detailed_source(name, hi)
    chain_lines = rebuild_chains(low, hi) if spec.get("chains") else None
    select_only(low)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=UV_MARGIN)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    if spec.get("sharp"):
        mark_sharp(low, spec["sharp"])

    source = bpy.data.materials.new(f"{name}_BakeSource")
    source.use_nodes = True
    nodes = source.node_tree.nodes
    nodes.clear()
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = base_color_image(hi.data.materials[0])
    emit = nodes.new("ShaderNodeEmission")
    out = nodes.new("ShaderNodeOutputMaterial")
    source.node_tree.links.new(tex.outputs[0], emit.inputs[0])
    source.node_tree.links.new(emit.outputs[0], out.inputs[0])
    hi.data.materials[0] = source
    hi.hide_render = False
    hi.hide_set(False)

    albedo = new_image(f"prop_{name}_albedo", spec["tex"])
    normal = new_image(f"prop_{name}_normal", spec["tex"], True)
    mat = bpy.data.materials.new(f"P_{name}")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.95
    tex_a = tree.nodes.new("ShaderNodeTexImage")
    tex_a.image = albedo
    tex_a.name = "albedo"
    tex_n = tree.nodes.new("ShaderNodeTexImage")
    tex_n.image = normal
    tex_n.name = "normal"
    map_n = tree.nodes.new("ShaderNodeNormalMap")
    tree.links.new(tex_a.outputs[0], bsdf.inputs["Base Color"])
    tree.links.new(tex_n.outputs[0], map_n.inputs["Color"])
    tree.links.new(map_n.outputs[0], bsdf.inputs["Normal"])
    tree.links.new(bsdf.outputs[0], output.inputs[0])
    low.data.materials.clear()
    low.data.materials.append(mat)

    saved_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 8
    bake = scene.render.bake
    bake.use_selected_to_active = True
    # Thin shells need a larger cage, or rays start under the surface and hit the far side.
    bake.cage_extrusion = spec.get("cage", 0.03)
    bake.max_ray_distance = spec.get("ray", spec.get("cage", 0.03) + 0.12)
    bake.margin = 16
    select_only(low)
    hi.select_set(True)
    tree.nodes.active = tex_a
    bpy.ops.object.bake(type="EMIT")
    tree.nodes.active = tex_n
    bake.normal_space = "TANGENT"
    bpy.ops.object.bake(type="NORMAL")
    for image, suffix in ((albedo, "albedo"), (normal, "normal")):
        image.filepath_raw = f"{TEX}/prop_{name}_{suffix}.png"
        image.file_format = "PNG"
        image.save()
    scene.render.engine = saved_engine

    if chain_lines:
        add_chain_links(low, *chain_lines)
    col = assets_collection()
    for owner in list(low.users_collection):
        owner.objects.unlink(low)
    col.objects.link(low)
    bpy.data.objects.remove(hi)
    voxel = bpy.data.objects.get(f"{name}_Voxel")
    if voxel:
        bpy.data.objects.remove(voxel)
    bpy.data.materials.remove(source)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    print(name, "faces", len(low.data.polygons), [round(v, 2) for v in low.dimensions])


def open_blank():
    """Start an empty session so each prop is built away from the main scene."""
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.read_homefile(use_empty=True)


def save_prop(name):
    """Save the working file, which by now holds only the low-poly prop."""
    os.makedirs(BLENDS, exist_ok=True)
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.save_as_mainfile(filepath=f"{BLENDS}/{name}.blend")
    print("saved", name, os.path.getsize(f"{BLENDS}/{name}.blend") // 1048576, "MB")


def open_main():
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.open_mainfile(filepath=MAIN_FILE)


def merge_props(names):
    """Append each finished low-poly prop into the open main file."""
    col = assets_collection()
    for name in names:
        object_name = f"P_{name}"
        if bpy.data.objects.get(object_name):
            continue
        with bpy.data.libraries.load(f"{BLENDS}/{name}.blend", link=False) as (source, target):
            target.objects = [object_name]
        col.objects.link(target.objects[0])
        print("merged", name)


KID_VARIANTS = ("leo", "maya", "sam", "zoe", "toby")
LOW_PROFILE = {
    "tree": {"quads": 1800, "tex": 1024, "cage": 0.2, "ray": 0.7, "sharp": None, "voxel": 0.09, "bake_from_detailed": True},
    "bench": {"quads": 400, "tex": 1024, "cage": 0.03, "ray": 0.15, "sharp": 60},
    "fence": {"quads": 120, "tex": 1024, "cage": 0.06, "ray": 0.25, "sharp": 60, "handmade": True},
    "tower_red": {"quads": 2200, "tex": 1024, "cage": 0.06, "ray": 0.2, "sharp": 60, "bake_from_detailed": True},
    "tower_blue": {"quads": 1500, "tex": 1024, "cage": 0.05, "ray": 0.25, "sharp": 60},
    "bridge": {"quads": 150, "tex": 512, "cage": 0.04, "ray": 0.2, "sharp": 60},
    "slide": {"quads": 300, "tex": 1024, "cage": 0.04, "ray": 0.2, "sharp": 60},
    "stairs": {"quads": 300, "tex": 512, "cage": 0.06, "ray": 0.3, "sharp": 60},
    "swing": {"quads": 1200, "tex": 1024, "cage": 0.03, "ray": 0.15, "sharp": 60, "chains": True},
    "seesaw": {"quads": 900, "tex": 1024, "cage": 0.04, "ray": 0.2, "sharp": 60},
    "sandbox": {"quads": 400, "tex": 1024, "cage": 0.06, "ray": 0.25, "sharp": 60, "bake_from_detailed": True},
}


def use_low_profile():
    """Point the pipeline at the browser-ready budgets and output folders."""
    global BLENDS, TEX, MAIN_FILE, QR_INPUT_FACES, ADAPT_QUADS, UV_MARGIN
    BLENDS = ROOT + "/assets/blends_low"
    TEX = ROOT + "/assets/textures_low"
    MAIN_FILE = ROOT + "/models_low.blend"
    QR_INPUT_FACES = 60000
    ADAPT_QUADS = False
    UV_MARGIN = 0.012
    os.makedirs(TEX, exist_ok=True)
    os.makedirs(BLENDS, exist_ok=True)
    for name, low in LOW_PROFILE.items():
        PROPS[name].update(low)


def swap_in_detailed_source(name, high):
    """Bake from the closed detailed prop when the raw mesh has messy surfaces inside it."""
    with bpy.data.libraries.load(f"{ROOT}/assets/blends/{name}.blend", link=False) as (source, target):
        target.objects = [f"P_{name}"]
    detailed = target.objects[0]
    bpy.context.scene.collection.objects.link(detailed)
    for node in detailed.data.materials[0].node_tree.nodes:
        # new_image reuses these names for the low-poly bake targets.
        if node.type == "TEX_IMAGE":
            node.image.name += "_source"
    bpy.data.objects.remove(high)
    detailed.name = f"{name}_High"
    bpy.context.view_layer.update()
    return detailed


def rebuild_chains(low, high):
    """Swap remeshed chains, which collapse to ribbons at this budget, for prisms that the bake can texture."""
    count = len(high.data.vertices)
    coords = np.empty(count * 3, dtype=np.float64)
    high.data.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)

    bottom, top = 0.85, 2.92
    middle = coords[(coords[:, 2] > 1.6) & (coords[:, 2] < 1.9) & (np.abs(coords[:, 0]) < 2.7)]
    ordered = np.sort(middle[:, 0])
    splits = np.flatnonzero(np.diff(ordered) > 0.15)
    bands = np.split(ordered, splits + 1)
    print("chains found", len(bands), [round(float(b.mean()), 2) for b in bands])

    lines = []
    bm = bmesh.new()
    bm.from_mesh(low.data)
    for band in bands:
        lo_x, hi_x = band.min(), band.max()
        centre_x = (lo_x + hi_x) / 2

        def centre_at(z_lo, z_hi):
            part = coords[
                (coords[:, 2] > z_lo) & (coords[:, 2] < z_hi) & (np.abs(coords[:, 0] - centre_x) < 0.2)
            ]
            return mathutils.Vector(((part[:, 0].min() + part[:, 0].max()) / 2, (part[:, 1].min() + part[:, 1].max()) / 2))

        doomed = [
            face
            for face in bm.faces
            if abs(face.calc_center_median().x - centre_x) < 0.2 and bottom < face.calc_center_median().z < top
        ]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")

        lower, upper = centre_at(0.95, 1.15), centre_at(2.55, 2.75)
        rate = (upper - lower) / 1.6
        at_bottom = lower + rate * (bottom - 0.05 - 1.05)
        at_top = lower + rate * (top + 0.05 - 1.05)
        lines.append((at_bottom, at_top))
    bm.normal_update()
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
    return lines, bottom - 0.05, top + 0.05


def add_chain_links(low, lines, bottom, top):
    """Add interlocking links, each turned 90 degrees from the last, with their own plain metal material."""
    material = bpy.data.materials.new(f"{low.name}_chain")
    material.use_nodes = True
    bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.32, 0.34, 0.37, 1)
    bsdf.inputs["Roughness"].default_value = 0.55
    low.data.materials.append(material)
    slot = len(low.data.materials) - 1

    bm = bmesh.new()
    bm.from_mesh(low.data)
    count = 0
    for at_bottom, at_top in lines:
        links = max(2, round((top - bottom) / LINK_PITCH))
        for index in range(links):
            t = (index + 0.5) / links
            centre = at_bottom.lerp(at_top, t)
            z = bottom + (top - bottom) * t
            across = mathutils.Vector((1, 0)) if index % 2 else mathutils.Vector((0, 1))
            rings = []
            for i in range(LINK_SEGMENTS):
                angle = math.tau * i / LINK_SEGMENTS
                outward = mathutils.Vector((across.x * math.cos(angle), across.y * math.cos(angle), math.sin(angle)))
                base = mathutils.Vector(
                    (
                        centre.x + across.x * LINK_HALF_WIDTH * math.cos(angle),
                        centre.y + across.y * LINK_HALF_WIDTH * math.cos(angle),
                        z + LINK_HALF_LENGTH * math.sin(angle),
                    )
                )
                side = mathutils.Vector((-across.y, across.x, 0))
                rings.append(
                    [
                        bm.verts.new(
                            base
                            + outward * LINK_TUBE * math.cos(math.tau * j / 3)
                            + side * LINK_TUBE * math.sin(math.tau * j / 3)
                        )
                        for j in range(3)
                    ]
                )
            for i in range(LINK_SEGMENTS):
                next_ring = rings[(i + 1) % LINK_SEGMENTS]
                for j in range(3):
                    k = (j + 1) % 3
                    face = bm.faces.new((rings[i][j], rings[i][k], next_ring[k], next_ring[j]))
                    face.material_index = slot
                    face.smooth = True
            count += 1
    bm.normal_update()
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
    print("chain links", count)


def build_fence_low(high):
    """Model the section from measurements of the detailed fence: thin, regular shapes that remeshing mangles."""
    coords = np.empty(len(high.data.vertices) * 3, dtype=np.float64)
    high.data.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)

    middle = coords[np.abs(coords[:, 0]) < 0.4]
    ordered = np.argsort(middle[:, 2])
    rails = np.split(middle[ordered], np.flatnonzero(np.diff(middle[ordered, 2]) > 0.15) + 1)
    rails = [r for r in rails if len(r) > 20]

    # Measure posts between and beyond the rails, where no bracket or rail widens them.
    clear = np.ones(len(coords), dtype=bool)
    for rail in rails:
        clear &= (coords[:, 2] < rail[:, 2].min() - 0.1) | (coords[:, 2] > rail[:, 2].max() + 0.1)
    posts = []
    for sign in (-1, 1):
        part = coords[clear & (coords[:, 0] * sign > 1.2)]
        posts.append(
            {
                "x": (part[:, 0].min() + part[:, 0].max()) / 2,
                "y": (part[:, 1].min() + part[:, 1].max()) / 2,
                "rx": (part[:, 0].max() - part[:, 0].min()) / 2,
                "ry": (part[:, 1].max() - part[:, 1].min()) / 2,
                "top": part[:, 2].max(),
            }
        )
    print("fence posts", [{k: round(float(v), 3) for k, v in p.items()} for p in posts], "rails", len(rails))

    verts, faces = [], []

    def ring(centre_x, centre_y, z, rx, ry, sides):
        start = len(verts)
        for i in range(sides):
            angle = math.tau * i / sides
            verts.append((centre_x + rx * math.cos(angle), centre_y + ry * math.sin(angle), z))
        return start

    for post in posts:
        lower = ring(post["x"], post["y"], 0.0, post["rx"], post["ry"], FENCE_POST_SIDES)
        upper = ring(post["x"], post["y"], post["top"] - 0.05, post["rx"], post["ry"], FENCE_POST_SIDES)
        cap = ring(post["x"], post["y"], post["top"], post["rx"] * 0.72, post["ry"] * 0.72, FENCE_POST_SIDES)
        for i in range(FENCE_POST_SIDES):
            j = (i + 1) % FENCE_POST_SIDES
            faces.append((lower + i, lower + j, upper + j, upper + i))
            faces.append((upper + i, upper + j, cap + j, cap + i))
        faces.append(tuple(cap + i for i in range(FENCE_POST_SIDES)))

    left, right = sorted(posts, key=lambda p: p["x"])
    start_x = left["x"] + left["rx"] * 0.7
    end_x = right["x"] - right["rx"] * 0.7
    for rail in rails:
        y, z = (rail[:, 1].min() + rail[:, 1].max()) / 2, (rail[:, 2].min() + rail[:, 2].max()) / 2
        half_y, half_z = (rail[:, 1].max() - rail[:, 1].min()) / 2, (rail[:, 2].max() - rail[:, 2].min()) / 2
        start = len(verts)
        for x in (start_x, end_x):
            for i in range(FENCE_RAIL_SIDES):
                angle = math.tau * i / FENCE_RAIL_SIDES
                verts.append((x, y + half_y * math.cos(angle), z + half_z * math.sin(angle)))
        for i in range(FENCE_RAIL_SIDES):
            j = (i + 1) % FENCE_RAIL_SIDES
            faces.append((start + i, start + j, start + FENCE_RAIL_SIDES + j, start + FENCE_RAIL_SIDES + i))

    mesh = bpy.data.meshes.new("Retopo_fence_Voxel")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    low = bpy.data.objects.new("Retopo_fence_Voxel", mesh)
    bpy.context.scene.collection.objects.link(low)
    bpy.context.view_layer.update()


def mark_sharp(ob, degrees):
    """Split shading at hard corners so few polygons still read as crisp shapes."""
    limit = math.radians(degrees)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for edge in bm.edges:
        if edge.is_manifold and edge.calc_face_angle(0.0) > limit:
            edge.smooth = False
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def ensure_main():
    """Create the low-poly main file on first use."""
    if not os.path.exists(MAIN_FILE):
        open_blank()
        window = bpy.context.window_manager.windows[0]
        with bpy.context.temp_override(window=window):
            bpy.ops.wm.save_as_mainfile(filepath=MAIN_FILE)
    open_main()


def start_kid():
    """Load the kid sources, turn them to the game's facing and start Quad Remesher."""
    source_file = ROOT + "/assets/blends/kid_source.blend"
    with bpy.data.libraries.load(source_file, link=False) as (source, target):
        target.objects = ["Kid_High", "Kid_Voxel"]
    with bpy.data.libraries.load(ROOT + "/models.blend", link=False) as (source, target_mid):
        target_mid.objects = [f"Kid_{n}" for n in KID_VARIANTS]
    collection = bpy.context.scene.collection
    turn = mathutils.Matrix.Rotation(math.pi, 4, "Z")
    for ob in target.objects:
        collection.objects.link(ob)
        ob.data.transform(turn)
        ob.data.update()
    for ob in target_mid.objects:
        collection.objects.link(ob)
        ob.location = (0, 0, 0)
    vox = bpy.data.objects["Kid_Voxel"]
    vox.hide_set(False)
    select_only(vox)
    qr = bpy.context.scene.qremesher
    qr.target_count = 1500
    qr.adaptive_size = 50
    qr.adapt_quad_count = False
    qr.use_materials = False
    qr.use_normals = False
    qr.autodetect_hard_edges = False
    qr.symmetry_x = qr.symmetry_y = qr.symmetry_z = False
    qr.hide_input = True
    window = bpy.context.window_manager.windows[0]
    area = next(a for a in window.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(window=window, area=area, region=region):
        bpy.ops.qremesher.remesh()


def finish_kid():
    """Bake one normal map from the high mesh and one albedo per kid from the detailed variants."""
    scene = bpy.context.scene
    low = bpy.data.objects["Retopo_Kid_Voxel"]
    low.name = low.data.name = "P_kid"
    select_only(low)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=UV_MARGIN)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()

    normal = new_image("kid_low_normal", 1024, True)
    bake_mat = bpy.data.materials.new("KidBakeTarget")
    bake_mat.use_nodes = True
    tree = bake_mat.node_tree
    target_node = tree.nodes.new("ShaderNodeTexImage")
    tree.nodes.active = target_node
    low.data.materials.clear()
    low.data.materials.append(bake_mat)

    saved_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 8
    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = 0.04
    bake.max_ray_distance = 0.15
    bake.margin = 8
    bake.normal_space = "TANGENT"

    high = bpy.data.objects["Kid_High"]
    high.hide_render = False
    high.hide_viewport = False
    high.hide_select = False
    high.hide_set(False)
    select_only(low)
    high.select_set(True)
    target_node.image = normal
    bpy.ops.object.bake(type="NORMAL")
    normal.filepath_raw = f"{TEX}/kid_normal.png"
    normal.file_format = "PNG"
    normal.save()

    materials = []
    for name in KID_VARIANTS:
        mid = bpy.data.objects[f"Kid_{name}"]
        mid.hide_render = False
        mid.hide_viewport = False
        mid.hide_select = False
        mid.hide_set(False)
        slot = mid.material_slots[0]
        source = slot.material.node_tree.nodes["albedo"].image
        emit_mat = bpy.data.materials.new(f"{name}_BakeSource")
        emit_mat.use_nodes = True
        nodes = emit_mat.node_tree.nodes
        nodes.clear()
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = source
        emit = nodes.new("ShaderNodeEmission")
        out = nodes.new("ShaderNodeOutputMaterial")
        emit_mat.node_tree.links.new(tex.outputs[0], emit.inputs[0])
        emit_mat.node_tree.links.new(emit.outputs[0], out.inputs[0])
        slot.link = "OBJECT"
        slot.material = emit_mat
        albedo = new_image(f"kid_low_{name}_albedo", 1024)
        target_node.image = albedo
        select_only(low)
        mid.select_set(True)
        bpy.ops.object.bake(type="EMIT")
        albedo.filepath_raw = f"{TEX}/kid_{name}_albedo.png"
        albedo.file_format = "PNG"
        albedo.save()

        mat = bpy.data.materials.new(f"KidLow_{name}")
        mat.use_fake_user = True
        mat.use_nodes = True
        node_tree = mat.node_tree
        node_tree.nodes.clear()
        output = node_tree.nodes.new("ShaderNodeOutputMaterial")
        bsdf = node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.95
        tex_a = node_tree.nodes.new("ShaderNodeTexImage")
        tex_a.image = albedo
        tex_n = node_tree.nodes.new("ShaderNodeTexImage")
        tex_n.image = normal
        map_n = node_tree.nodes.new("ShaderNodeNormalMap")
        node_tree.links.new(tex_a.outputs[0], bsdf.inputs["Base Color"])
        node_tree.links.new(tex_n.outputs[0], map_n.inputs["Color"])
        node_tree.links.new(map_n.outputs[0], bsdf.inputs["Normal"])
        node_tree.links.new(bsdf.outputs[0], output.inputs[0])
        materials.append(mat)
    scene.render.engine = saved_engine

    low.data.materials.clear()
    low.data.materials.append(materials[0])
    col = assets_collection()
    for owner in list(low.users_collection):
        owner.objects.unlink(low)
    col.objects.link(low)
    for ob in list(bpy.data.objects):
        if ob is not low:
            bpy.data.objects.remove(ob)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    print("kid faces", len(low.data.polygons), [round(v, 2) for v in low.dimensions])


def merge_kid():
    """Append the rigged kid, its clips and its five materials into the open main file."""
    if bpy.data.objects.get("P_kid"):
        return
    with bpy.data.libraries.load(f"{BLENDS}/kid_rigged.blend", link=False) as (source, target):
        target.objects = ["P_kid", "KidRig"]
        target.materials = [f"KidLow_{n}" for n in KID_VARIANTS]
        target.actions = ["idle", "walk", "run", "frozen"]
    for ob in target.objects:
        assets_collection().objects.link(ob)
    print("merged rigged kid")
