"""Run inside Blender: rig the low-poly kid and key idle, walk and run clips.

The kid faces +Y, which glTF export turns into the game's -Z. Its own left side is at -X.
Bones are named with underscores because three.js strips dots from node names.
"""

import math
import os

import bpy
import mathutils
import numpy as np

ROOT = r"C:/Users/mesol/workspace/Toys/games/freeze-tag"
SOURCE = ROOT + "/assets/blends_low/kid.blend"
RIGGED = ROOT + "/assets/blends_low/kid_rigged.blend"
GAME = ROOT + "/assets/game"
FPS = 30
# Distance from the body's centre line where upper-arm influence fades in.
TORSO_BLEND_START = 0.15
TORSO_BLEND_END = 0.24
# Matches the limb timing in HumanoidCharacter: 15 rad/s running and 8 rad/s walking.
CLIP_FRAMES = {"idle": 120, "walk": 24, "run": 13, "frozen": 1}

# Bone: (parent, head, tail). Side bones are given for the kid's right (+X) and mirrored.
CENTRE_BONES = {
    "root": (None, (0, 0, 0), (0, 0, 0.15)),
    "hips": ("root", (0, -0.01, 0.68), (0, -0.015, 0.85)),
    "spine": ("hips", (0, -0.015, 0.85), (0, -0.015, 1.05)),
    "chest": ("spine", (0, -0.015, 1.05), (0, -0.005, 1.21)),
    "neck": ("chest", (0, -0.005, 1.21), (0, 0, 1.28)),
    "head": ("neck", (0, 0, 1.28), (0, 0, 1.7)),
}
SIDE_BONES = {
    "thigh": ("hips", (0.09, -0.01, 0.68), (0.12, -0.01, 0.40)),
    "shin": ("thigh", (0.12, -0.01, 0.40), (0.15, -0.02, 0.13)),
    "foot": ("shin", (0.15, -0.02, 0.13), (0.175, 0.1, 0.04)),
    "toe": ("foot", (0.175, 0.1, 0.04), (0.185, 0.185, 0.03)),
    "upper_arm": ("chest", (0.19, -0.02, 1.12), (0.33, -0.03, 0.96)),
    "lower_arm": ("upper_arm", (0.33, -0.03, 0.96), (0.43, -0.03, 0.84)),
    "hand": ("lower_arm", (0.43, -0.03, 0.84), (0.54, -0.03, 0.68)),
}


def rx(degrees):
    return mathutils.Quaternion((1, 0, 0), math.radians(degrees))


def ry(degrees):
    return mathutils.Quaternion((0, 1, 0), math.radians(degrees))


def rz(degrees):
    return mathutils.Quaternion((0, 0, 1), math.radians(degrees))


def op_context(active, selected):
    """Operators run from the bridge's timer have no window, so give them the active object explicitly."""
    window = bpy.context.window_manager.windows[0]
    layer = window.view_layer
    layer.update()
    for other in layer.objects:
        other.select_set(other in selected)
    layer.objects.active = active
    return bpy.context.temp_override(
        window=window,
        view_layer=layer,
        object=active,
        active_object=active,
        selected_objects=list(selected),
        selected_editable_objects=list(selected),
    )


def open_source():
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.open_mainfile(filepath=SOURCE)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0


def build_armature():
    data = bpy.data.armatures.new("KidRig")
    rig = bpy.data.objects.new("KidRig", data)
    bpy.context.scene.collection.objects.link(rig)
    with op_context(rig, [rig]):
        bpy.ops.object.mode_set(mode="EDIT")
    edit = data.edit_bones

    def add(name, parent, head, tail, connect=False):
        bone = edit.new(name)
        bone.head, bone.tail = head, tail
        if parent:
            bone.parent = edit[parent]
            bone.use_connect = connect

    for name, (parent, head, tail) in CENTRE_BONES.items():
        add(name, parent, head, tail)
    for suffix, sign in (("R", 1), ("L", -1)):
        for name, (parent, head, tail) in SIDE_BONES.items():
            mirror = lambda p: (p[0] * sign, p[1], p[2])
            parent_name = parent if parent in CENTRE_BONES else f"{parent}_{suffix}"
            add(f"{name}_{suffix}", parent_name, mirror(head), mirror(tail))
    edit["root"].use_deform = False
    with op_context(rig, [rig]):
        bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin(rig, mesh_ob):
    """Bind with automatic weights, then keep the four influences a glTF vertex can carry."""
    with op_context(rig, [rig, mesh_ob]):
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    free_torso_from_arms(mesh_ob)
    with op_context(mesh_ob, [mesh_ob]):
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    unweighted = sum(1 for v in mesh_ob.data.vertices if not v.groups)
    print("vertex groups", len(mesh_ob.vertex_groups), "unweighted verts", unweighted)


def free_torso_from_arms(mesh_ob):
    """Automatic weights let the upper arm reach deep into the chest, which drags the shirt on each swing."""
    chest = mesh_ob.vertex_groups["chest"]
    moved = 0
    for suffix in ("R", "L"):
        arm = mesh_ob.vertex_groups[f"upper_arm_{suffix}"]
        sign = 1 if suffix == "R" else -1
        for vertex in mesh_ob.data.vertices:
            x = vertex.co.x * sign
            if x <= 0 or x >= TORSO_BLEND_END or vertex.co.z > 1.3:
                continue
            try:
                weight = arm.weight(vertex.index)
            except RuntimeError:
                continue
            t = max(0.0, (x - TORSO_BLEND_START) / (TORSO_BLEND_END - TORSO_BLEND_START))
            keep = weight * t * t * (3 - 2 * t)
            arm.add([vertex.index], keep, "REPLACE")
            chest.add([vertex.index], weight - keep, "ADD")
            moved += 1
    print("arm weights moved to chest on", moved, "verts")


def to_local(pose_bone, rotation):
    """Convert a rotation in armature axes into this bone's rest frame."""
    rest = pose_bone.bone.matrix_local.to_3x3()
    return (rest.inverted() @ rotation.to_matrix() @ rest).to_quaternion()


def arm_pose(side_sign, swing, elbow, lower=30, inward=0):
    """Lower the arm out of the A-pose, then swing it. Positive rotation about Y lowers the +X arm."""
    # The hinge is perpendicular to the A-posed arm, so the elbow bends toward the kid's front.
    # Rotating about the world X axis instead would sweep the forearm across the body.
    direction = mathutils.Vector((0.64 * side_sign, 0, -0.77)).normalized()
    hinge = direction.cross(mathutils.Vector((0, 1, 0))).normalized()
    # Turning the upper arm about its own length brings a bent forearm in toward the belly.
    roll_in = mathutils.Quaternion(direction, math.radians(-inward * side_sign))
    return {
        "upper": rx(swing) @ ry(lower * side_sign) @ roll_in,
        "lower": mathutils.Quaternion(hinge, math.radians(elbow)),
    }


def leg_pose(thigh, knee):
    # Positive rotation about X swings a hanging limb forward, and lifts the toe of a level foot.
    return {"thigh": rx(thigh), "shin": rx(-knee), "foot": rx(-(thigh - knee) * 0.7)}


def locomotion(t, gait):
    """Build one gait frame. Parts deliberately lag each other, because lockstep reads as robotic."""
    pose = {}
    cycle = math.tau * t
    for suffix, sign, offset in (("R", 1, 0.0), ("L", -1, math.pi)):
        phase = cycle + offset
        lift = max(0.0, math.cos(phase + 0.3)) ** gait["knee_power"]
        push = max(0.0, -math.sin(phase)) ** 3
        thigh = gait["thigh_base"] + gait["thigh_amp"] * math.sin(phase)
        leg = leg_pose(thigh, gait["knee_base"] + gait["knee_amp"] * lift)
        pose[f"thigh_{suffix}"] = leg["thigh"]
        pose[f"shin_{suffix}"] = leg["shin"]
        pose[f"foot_{suffix}"] = rx(-gait["push"] * push) @ leg["foot"]
        pose[f"toe_{suffix}"] = rx(gait["toe"] * push)
        # Arms oppose the legs and trail them, and each joint further out trails a little more.
        arm_phase = phase - 0.25
        forward = -math.sin(arm_phase)
        swing = gait["arm_amp"] * forward + gait["arm_back"]
        # Elbows close as the arm drives forward and open on the backswing, slightly behind it.
        elbow = gait["elbow"] + gait["elbow_amp"] * -math.sin(arm_phase - 0.4)
        arm = arm_pose(sign, swing, elbow, lower=gait["arm_lower"], inward=gait["arm_in"])
        pose[f"upper_arm_{suffix}"] = arm["upper"]
        pose[f"lower_arm_{suffix}"] = arm["lower"]
        pose[f"hand_{suffix}"] = rx(gait["hand"] * math.sin(arm_phase - 0.8))
    twist = gait["twist"]
    # The kid's right foot carries the weight while cos(cycle) is negative, so the hips move over it.
    over_right = -math.cos(cycle)
    roll = gait["roll"] * over_right
    lean = gait["lean"] + gait["lean_pulse"] * math.cos(2 * cycle)
    pose["hips"] = rz(twist * math.sin(cycle)) @ ry(roll) @ rx(-lean)
    pose["spine"] = ry(-roll * 0.6) @ rx(-lean * 0.3)
    pose["chest"] = rz(-twist * 1.7 * math.sin(cycle - 0.3)) @ ry(-roll * 0.3)
    pose["neck"] = rz(twist * 0.6 * math.sin(cycle - 0.5))
    pose["head"] = rz(twist * 0.5 * math.sin(cycle - 0.7)) @ rx(lean * 0.9 + gait["nod"] * math.cos(2 * cycle - 0.6))
    airborne = gait["flight"] * abs(math.sin(cycle)) ** 4
    pose["_offset"] = mathutils.Vector((gait["shift"] * over_right, 0, airborne))
    return pose


RUN_GAIT = {
    "thigh_base": 12, "thigh_amp": 40, "knee_base": 22, "knee_amp": 78, "knee_power": 1.5,
    "push": 18, "toe": 28, "arm_amp": 33, "arm_back": -8, "arm_lower": 31, "arm_in": 10, "elbow": 88, "elbow_amp": 18, "hand": 4,
    "twist": 9, "roll": 4, "lean": 15, "lean_pulse": 2, "nod": 3, "shift": 0.018, "flight": 0.05,
}
WALK_GAIT = {
    "thigh_base": 4, "thigh_amp": 24, "knee_base": 7, "knee_amp": 50, "knee_power": 2.0,
    "push": 14, "toe": 22, "arm_amp": 22, "arm_back": -2, "arm_lower": 33, "arm_in": 8, "elbow": 24, "elbow_amp": 12, "hand": 5,
    "twist": 6, "roll": 3.5, "lean": 3, "lean_pulse": 1, "nod": 1.5, "shift": 0.022, "flight": 0.0,
}


def run_pose(t):
    return locomotion(t, RUN_GAIT)


def walk_pose(t):
    return locomotion(t, WALK_GAIT)


def idle_pose(t):
    """A relaxed stand: weight drifts between the feet while the breath, head and arms keep their own time."""
    cycle = math.tau * t
    weight = math.sin(cycle)
    breath = math.sin(2 * cycle)
    pose = {
        "hips": ry(2.5 * weight),
        "spine": ry(-1.5 * weight) @ rx(0.8 * breath),
        "chest": rz(3 * math.sin(cycle + 0.8)) @ rx(1.6 * breath),
        "neck": rz(3 * math.sin(cycle + 1.6)),
        "head": rz(7 * math.sin(cycle + 2.0)) @ rx(2.5 * math.sin(2 * cycle + 1.1) - 1.2 * breath),
        "_offset": mathutils.Vector((0.022 * weight, 0, 0)),
    }
    for suffix, sign, offset in (("R", 1, 0.0), ("L", -1, 2.2)):
        # The leg without the weight relaxes at the knee.
        relaxed = 0.5 - 0.5 * weight * sign
        leg = leg_pose(2 + 5 * relaxed, 3 + 13 * relaxed)
        pose[f"thigh_{suffix}"] = leg["thigh"]
        pose[f"shin_{suffix}"] = leg["shin"]
        pose[f"foot_{suffix}"] = leg["foot"]
        swing = 4 * math.sin(cycle + offset) + 2 * math.sin(2 * cycle + offset)
        elbow = 15 + 6 * math.sin(2 * cycle + offset + 0.5)
        arm = arm_pose(sign, swing, elbow, lower=33 + 2 * breath, inward=5)
        pose[f"upper_arm_{suffix}"] = arm["upper"]
        pose[f"lower_arm_{suffix}"] = arm["lower"]
        pose[f"hand_{suffix}"] = rx(6 * math.sin(2 * cycle + offset + 1.0))
    return pose


def frozen_pose(t):
    """Caught mid-stride: weight on one foot, arms thrown out, looking back at the tagger."""
    pose = locomotion(0.2, RUN_GAIT)
    pose["_offset"] = mathutils.Vector((0, 0, 0))
    right = arm_pose(1, 62, 58, lower=8)
    left = arm_pose(-1, -36, 42, lower=14)
    pose["upper_arm_R"], pose["lower_arm_R"] = right["upper"], right["lower"]
    pose["upper_arm_L"], pose["lower_arm_L"] = left["upper"], left["lower"]
    pose["hand_R"] = rx(-22)
    pose["hand_L"] = rx(18)
    pose["chest"] = rz(14) @ rx(4)
    pose["neck"] = rz(16)
    pose["head"] = rz(24) @ rx(6) @ ry(-7)
    return pose


def lowest_point(mesh_ob):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh_ob.evaluated_get(depsgraph).to_mesh()
    coords = np.empty(len(evaluated.vertices) * 3)
    evaluated.vertices.foreach_get("co", coords)
    mesh_ob.evaluated_get(depsgraph).to_mesh_clear()
    return float(coords[2::3].min())


def key_clip(rig, mesh_ob, name, frames, pose_function):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    scene = bpy.context.scene
    root = rig.pose.bones["root"]
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
    lowest = []
    for frame in range(frames + 1):
        # The last frame repeats the first so the clip loops without a pop.
        t = (frame % frames) / frames
        pose = pose_function(t)
        offset = pose.pop("_offset", mathutils.Vector())
        scene.frame_set(frame)
        for bone in rig.pose.bones:
            bone.rotation_quaternion = to_local(bone, pose.get(bone.name, mathutils.Quaternion()))
            bone.keyframe_insert("rotation_quaternion", frame=frame)
        root.location = (0, 0, 0)
        bpy.context.view_layer.update()
        drop = lowest_point(mesh_ob)
        lowest.append(drop)
        # Plant the lowest foot on the ground, then add the gait's own shift and airborne height.
        world = mathutils.Vector((offset.x, offset.y, offset.z - drop))
        root.location = root.bone.matrix_local.to_3x3().inverted() @ world
        root.keyframe_insert("location", frame=frame)
    print(name, "frames", frames, "feet before grounding", round(min(lowest), 3), round(max(lowest), 3), "slot", rig.animation_data.action_slot)
    return action


def report_frozen_bounds(rig, mesh_ob):
    """IceBlock in Game.tsx spans x and z from -0.65 to 0.65 and y from -0.05 to 1.85."""
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh_ob.evaluated_get(depsgraph).to_mesh()
    coords = np.empty(len(evaluated.vertices) * 3)
    evaluated.vertices.foreach_get("co", coords)
    mesh_ob.evaluated_get(depsgraph).to_mesh_clear()
    coords = coords.reshape(-1, 3)
    print("frozen bounds min", coords.min(0).round(3), "max", coords.max(0).round(3))


def bake_position_map(rig, mesh_ob):
    """Bake rest-pose body position to the UVs, for the frost noise in freeze_kid_textures.py."""
    scene = bpy.context.scene
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    image = bpy.data.images.new("kid_position", 1024, 1024, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    bake_mat = bpy.data.materials.new("KidPositionBake")
    bake_mat.use_nodes = True
    nodes = bake_mat.node_tree.nodes
    links = bake_mat.node_tree.links
    nodes.clear()
    geometry = nodes.new("ShaderNodeNewGeometry")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / 1.2, 1 / 0.6, 1 / 1.72)
    mapping.inputs["Location"].default_value = (0.5, 0.5, 0)
    emit = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    nodes.active = target
    links.new(geometry.outputs["Position"], mapping.inputs[0])
    links.new(mapping.outputs[0], emit.inputs[0])
    links.new(emit.outputs[0], output.inputs[0])
    original = mesh_ob.data.materials[0]
    mesh_ob.data.materials[0] = bake_mat
    saved_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 8
    with op_context(mesh_ob, [mesh_ob]):
        bpy.ops.object.bake(type="EMIT")
    image.filepath_raw = ROOT + "/assets/textures_low/kid_position.png"
    image.file_format = "PNG"
    image.save()
    scene.render.engine = saved_engine
    mesh_ob.data.materials[0] = original
    bpy.data.materials.remove(bake_mat)
    bpy.data.images.remove(image)
    rig.data.pose_position = "POSE"
    print("position map baked")


def build():
    open_source()
    mesh_ob = bpy.data.objects["P_kid"]
    rig = build_armature()
    skin(rig, mesh_ob)
    key_clip(rig, mesh_ob, "idle", CLIP_FRAMES["idle"], idle_pose)
    key_clip(rig, mesh_ob, "walk", CLIP_FRAMES["walk"], walk_pose)
    key_clip(rig, mesh_ob, "run", CLIP_FRAMES["run"], run_pose)
    key_clip(rig, mesh_ob, "frozen", CLIP_FRAMES["frozen"], frozen_pose)
    report_frozen_bounds(rig, mesh_ob)
    bake_position_map(rig, mesh_ob)
    window = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=window):
        bpy.ops.wm.save_as_mainfile(filepath=RIGGED)
    print("saved", os.path.getsize(RIGGED) // 1024, "KB")


def export_glb():
    os.makedirs(GAME, exist_ok=True)
    rig = bpy.data.objects["KidRig"]
    mesh_ob = bpy.data.objects["P_kid"]
    for material in bpy.data.materials:
        if material.name.startswith("KidLow_"):
            next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Roughness"].default_value = 0.95
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.rotation_quaternion = mathutils.Quaternion()
        bone.location = (0, 0, 0)
    with op_context(rig, [rig, mesh_ob]):
        bpy.ops.export_scene.gltf(
            filepath=GAME + "/kid.glb",
            export_format="GLB",
            use_selection=True,
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_force_sampling=True,
            export_skins=True,
            export_image_format="WEBP",
            export_image_quality=80,
            export_lights=False,
            export_cameras=False,
        )
    print("glb KB", os.path.getsize(GAME + "/kid.glb") // 1024)
