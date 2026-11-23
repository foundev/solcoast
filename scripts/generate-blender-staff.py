"""
Builds 6 dedicated, rigged, mocap-compatible 5-star hotel staff GLBs for Hotel Solaire
using clean Ready Player Me base rigs (avatar_4 male, avatar_7 female, avatar_3 maid) —
ZERO puffer jackets, ZERO hoodies, ZERO beachwear!

Exports to public/assets/models/:
  1. staff_concierge_f.glb  — Midnight-navy tailored pantsuit, white collared shirt, silk tie, gold badge
  2. staff_security_m.glb   — Jet-black executive tailored suit, white shirt, black tie, shades, gold shield
  3. staff_bartender_m.glb  — Crisp white dress shirt, tailored black waistcoat vest, bowtie & bar apron
  4. staff_waiter_m.glb     — Classic 5-star white tuxedo dinner jacket, satin-black lapels, bowtie & black slacks
  5. staff_bellhop_m.glb    — Art Deco crimson bellhop tunic, brass buttons, epaulettes, gold collar & pillbox cap
  6. staff_maid_f.glb       — Crisp dark-navy housekeeping dress, white Peter Pan collar, white apron & headband

Run:
  blender --background --python scripts/generate-blender-staff.py
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "public", "assets", "models"))


def make_mat(name, base_color, roughness=0.68, metallic=0.0, coat=0.0):
    mat = bpy.data.materials.new(name=name)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if coat > 0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    return mat


def load_base(avatar_name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(MODELS_DIR, f"{avatar_name}.glb")
    bpy.ops.import_scene.gltf(filepath=path)
    arm = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
    # Remove casual glasses mesh cleanly if present
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and "glasses" in o.name.lower():
            bpy.data.objects.remove(o, do_unlink=True)
    return arm


def set_mesh_mat(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def find_mesh(substr):
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and substr.lower() in o.name.lower():
            return o
    return None


def create_rigged_sleeves_from_body(arm, sleeve_mat, cuff_mat, inflate=0.011):
    """
    Duplicates the exact rigged LeftArm/LeftForeArm/RightArm/RightForeArm faces from Wolf3D_Body
    and inflates them along normals into seamless, perfectly weight-painted tailored suit sleeves
    with crisp white French shirt cuffs at the wrists!
    """
    body = find_mesh("Wolf3D_Body")
    if not body:
        return

    # Copy body mesh object so it inherits Armature modifier, parent, and all exact bone vertex groups!
    sleeve_obj = body.copy()
    sleeve_obj.data = body.data.copy()
    sleeve_obj.name = "Tailored_Sleeves"
    bpy.context.collection.objects.link(sleeve_obj)

    arm_groups = {"LeftArm", "LeftForeArm", "RightArm", "RightForeArm"}
    hand_groups = {"LeftHand", "RightHand"}
    group_names = {vg.index: vg.name for vg in sleeve_obj.vertex_groups}

    lh_pos = arm.matrix_world @ arm.data.bones["LeftHand"].head_local
    rh_pos = arm.matrix_world @ arm.data.bones["RightHand"].head_local

    bm = bmesh.new()
    bm.from_mesh(sleeve_obj.data)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    # Determine which vertices belong to the arms (up to wrist, stopping before palm/fingers)
    keep_verts = set()
    for v in sleeve_obj.data.vertices:
        arm_w = 0.0
        hand_w = 0.0
        for g in v.groups:
            gn = group_names.get(g.group, "")
            if gn in arm_groups:
                arm_w += g.weight
            elif gn in hand_groups:
                hand_w += g.weight
        if arm_w >= 0.45 and hand_w < 0.35:
            keep_verts.add(v.index)

    # Delete all non-sleeve faces
    del_faces = [f for f in bm.faces if not all(v.index in keep_verts for v in f.verts)]
    bmesh.ops.delete(bm, geom=del_faces, context="FACES")

    # Recalculate smooth normals and push sleeve outward over skin cleanly
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * inflate

    # Assign sleeve material (slot 0) and exact symmetric wrist cuff material (slot 1)
    sleeve_obj.data.materials.clear()
    sleeve_obj.data.materials.append(sleeve_mat)
    sleeve_obj.data.materials.append(cuff_mat)

    mw = sleeve_obj.matrix_world
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        is_cuff = any(((mw @ v.co) - lh_pos).length < 0.048 or ((mw @ v.co) - rh_pos).length < 0.048 for v in f.verts)
        f.material_index = 1 if is_cuff else 0

    bm.to_mesh(sleeve_obj.data)
    bm.free()
    bpy.context.view_layer.objects.active = sleeve_obj
    bpy.ops.object.shade_smooth()


def add_bone_part(arm, bone_name, name, primitive, size, offset, mat, rot=(0, 0, 0), bevel=0.0):
    """Creates a clean 3D garment detail (collar, lapel, tie, cap, apron, badge) rigidly weighted to a bone."""
    bone = arm.data.bones.get(bone_name)
    if not bone:
        return None
    bhead = arm.matrix_world @ bone.head_local
    loc = (bhead.x + offset[0], bhead.y + offset[1], bhead.z + offset[2])

    if primitive == "box":
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
        obj = bpy.context.active_object
        obj.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if bevel > 0:
            mod = obj.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
    elif primitive == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=size[0], depth=size[1], location=loc, rotation=rot)
        obj = bpy.context.active_object
        if len(size) >= 3 and size[2] != 1.0:
            obj.scale.y = size[2]
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bpy.ops.object.shade_smooth()
    elif primitive == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=18, radius1=size[0], radius2=size[1], depth=size[2], location=loc, rotation=rot)
        obj = bpy.context.active_object
        bpy.ops.object.shade_smooth()
    elif primitive == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=size[0], segments=12, ring_count=8, location=loc)
        obj = bpy.context.active_object
        bpy.ops.object.shade_smooth()
    elif primitive == "torus":
        bpy.ops.mesh.primitive_torus_add(
            major_radius=size[0], minor_radius=size[1], major_segments=22, minor_segments=10, location=loc, rotation=rot
        )
        obj = bpy.context.active_object
        bpy.ops.object.shade_smooth()
    else:
        return None

    obj.name = name
    obj.data.materials.append(mat)
    # Bind via Armature modifier + 1.0 weight to target bone so it exports cleanly in skinned glTF!
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return obj


def add_suit_front(arm, lapel_mat, shirt_mat, tie_mat, btn_mat, is_female=False, tie_kind="necktie", pocket_square=True):
    """Adds tailored white shirt collar, V-front shirt placket, notched lapels, tie/bowtie & pocket square."""
    # Note: In Blender Ready Player Me rigs, character faces -Y!
    y_chest = -0.108 if is_female else -0.124
    z_off = -0.015 if is_female else 0.0

    # Folded crisp white shirt collar around neck
    add_bone_part(arm, "Neck", "ShirtCollar", "cone", (0.068 if is_female else 0.076, 0.056 if is_female else 0.064, 0.048), (0, -0.008, 0.025), shirt_mat)

    # Crisp white dress shirt V-placket on chest
    add_bone_part(arm, "Spine2", "ShirtFront", "box", (0.095 if is_female else 0.11, 0.032, 0.19), (0, y_chest, 0.055 + z_off), shirt_mat, bevel=0.006)

    # Sculpted left & right notched suit lapels converging in a classic tailored V toward the center button!
    lx = 0.048 if is_female else 0.056
    for side in (-1, 1):
        add_bone_part(
            arm,
            "Spine2",
            f"SuitLapel_{side}",
            "box",
            (0.038, 0.030, 0.195),
            (side * lx, y_chest - 0.008, 0.055 + z_off),
            lapel_mat,
            rot=(0, side * 0.16, 0),
            bevel=0.006,
        )

    # Jacket front buttons
    for bz in (-0.065, -0.125):
        add_bone_part(arm, "Spine2", f"SuitBtn_{bz}", "sphere", (0.0085,), (0, y_chest - 0.014, bz + z_off), btn_mat)

    # Folded white silk pocket square on left chest (+X in Blender is character's left side!)
    if pocket_square:
        add_bone_part(arm, "Spine2", "PocketSquare", "box", (0.042, 0.014, 0.018), (0.088 if not is_female else 0.078, y_chest - 0.004, 0.065 + z_off), shirt_mat, rot=(0, -0.1, 0))

    # Silk necktie or tuxedo bowtie
    if tie_kind == "bowtie":
        add_bone_part(arm, "Spine2", "BowKnot", "box", (0.018, 0.016, 0.018), (0, y_chest - 0.018, 0.132 + z_off), tie_mat)
        for side in (-1, 1):
            add_bone_part(
                arm,
                "Spine2",
                f"BowWing_{side}",
                "box",
                (0.040, 0.012, 0.022),
                (side * 0.024, y_chest - 0.016, 0.132 + z_off),
                tie_mat,
                rot=(0, side * 0.18, 0),
            )
    else:
        add_bone_part(arm, "Spine2", "TieKnot", "box", (0.026, 0.020, 0.026), (0, y_chest - 0.018, 0.132 + z_off), tie_mat, bevel=0.004)
        add_bone_part(arm, "Spine2", "TieBlade", "box", (0.032, 0.014, 0.175), (0, y_chest - 0.017, 0.038 + z_off), tie_mat, bevel=0.003)


def export_staff(filename):
    out_path = os.path.join(MODELS_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_image_format="JPEG",
        export_image_quality=82,
        export_materials="EXPORT",
        export_skins=True,
    )
    sz = os.path.getsize(out_path) / 1024.0
    print(f"[blender-staff] {filename}: {sz:.1f} KB")


# ─── 1. FEMALE CONCIERGE IN MIDNIGHT-NAVY TAILORED PANTSUIT ──────────────────
def build_staff_concierge_f():
    arm = load_base("avatar_7")
    navy = make_mat("ConciergeNavy", (0.08, 0.13, 0.24), roughness=0.66)
    navy_pants = make_mat("ConciergePants", (0.07, 0.11, 0.20), roughness=0.72)
    white = make_mat("ShirtWhite", (0.96, 0.96, 0.95), roughness=0.75)
    burgundy = make_mat("SilkBurgundy", (0.50, 0.08, 0.16), roughness=0.32)
    gold = make_mat("BadgeGold", (0.94, 0.76, 0.28), roughness=0.18, metallic=0.95)
    shoe = make_mat("DressShoe", (0.06, 0.06, 0.07), roughness=0.22, coat=0.6)

    set_mesh_mat(find_mesh("Wolf3D_Outfit_Top"), navy)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Bottom"), navy_pants)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Footwear"), shoe)
    create_rigged_sleeves_from_body(arm, navy, white, inflate=0.011)
    add_suit_front(arm, navy, white, burgundy, gold, is_female=True, tie_kind="necktie", pocket_square=True)
    # Gold concierge name badge on right chest (-X in Blender)
    add_bone_part(arm, "Spine2", "NameBadge", "box", (0.056, 0.010, 0.022), (-0.076, -0.112, 0.065), gold, bevel=0.002)
    export_staff("staff_concierge_f.glb")


# ─── 2. MALE EXECUTIVE SECURITY IN JET-BLACK TAILORED SUIT ──────────────────
def build_staff_security_m():
    arm = load_base("avatar_4")
    black_suit = make_mat("SecBlackSuit", (0.06, 0.07, 0.09), roughness=0.65)
    black_pants = make_mat("SecBlackPants", (0.05, 0.06, 0.08), roughness=0.72)
    white = make_mat("SecShirtWhite", (0.96, 0.96, 0.95), roughness=0.75)
    black_tie = make_mat("SecBlackTie", (0.04, 0.04, 0.05), roughness=0.35)
    gold = make_mat("SecGoldBadge", (0.94, 0.76, 0.28), roughness=0.18, metallic=0.95)
    shades = make_mat("SecShades", (0.02, 0.03, 0.05), roughness=0.05, metallic=0.35, coat=1.0)
    shoe = make_mat("SecDressShoe", (0.05, 0.05, 0.06), roughness=0.20, coat=0.7)

    set_mesh_mat(find_mesh("Wolf3D_Outfit_Top"), black_suit)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Bottom"), black_pants)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Footwear"), shoe)
    create_rigged_sleeves_from_body(arm, black_suit, white, inflate=0.012)
    add_suit_front(arm, black_suit, white, black_tie, black_tie, is_female=False, tie_kind="necktie", pocket_square=False)
    # Gold hotel security shield + dark executive shades
    add_bone_part(arm, "Spine2", "SecurityBadge", "cyl", (0.024, 0.010), (-0.086, -0.130, 0.065), gold, rot=(math.pi * 0.5, 0, 0))
    add_bone_part(arm, "Head", "SecurityShades", "box", (0.128, 0.018, 0.036), (0, -0.105, 0.088), shades, bevel=0.004)
    export_staff("staff_security_m.glb")


# ─── 3. MALE MASTER MIXOLOGIST / BARTENDER (WHITE SHIRT, BLACK VEST & BOWTIE)
def build_staff_bartender_m():
    arm = load_base("avatar_4")
    black_vest = make_mat("BarBlackVest", (0.07, 0.08, 0.11), roughness=0.62)
    black_pants = make_mat("BarBlackPants", (0.05, 0.06, 0.08), roughness=0.72)
    white = make_mat("BarShirtWhite", (0.97, 0.97, 0.96), roughness=0.72)
    black_silk = make_mat("BarBowtie", (0.04, 0.04, 0.06), roughness=0.32)
    silver = make_mat("BarSilverBtn", (0.86, 0.88, 0.92), roughness=0.18, metallic=0.95)
    shoe = make_mat("BarDressShoe", (0.05, 0.05, 0.06), roughness=0.22, coat=0.7)

    # Torso is tailored black waistcoat vest; sleeves are crisp starched white dress shirt sleeves!
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Top"), black_vest)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Bottom"), black_pants)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Footwear"), shoe)
    create_rigged_sleeves_from_body(arm, white, white, inflate=0.010)
    add_suit_front(arm, black_vest, white, black_silk, silver, is_female=False, tie_kind="bowtie", pocket_square=True)
    # Classic black bistro bar apron tied at waist
    add_bone_part(arm, "Hips", "BarApron", "box", (0.31, 0.026, 0.42), (0, -0.115, -0.14), black_vest, bevel=0.005)
    export_staff("staff_bartender_m.glb")


# ─── 4. MALE 5-STAR WAITER / PENTHOUSE BUTLER (WHITE TUXEDO DINNER JACKET) ───
def build_staff_waiter_m():
    arm = load_base("avatar_4")
    white_jkt = make_mat("WaiterWhiteJkt", (0.95, 0.95, 0.93), roughness=0.62)
    white_shirt = make_mat("WaiterShirt", (0.98, 0.98, 0.98), roughness=0.72)
    satin_black = make_mat("WaiterSatinBlack", (0.05, 0.05, 0.07), roughness=0.28)
    black_pants = make_mat("WaiterBlackPants", (0.05, 0.06, 0.08), roughness=0.72)
    gold = make_mat("WaiterGoldPin", (0.94, 0.76, 0.28), roughness=0.18, metallic=0.95)
    shoe = make_mat("WaiterDressShoe", (0.05, 0.05, 0.06), roughness=0.20, coat=0.7)

    set_mesh_mat(find_mesh("Wolf3D_Outfit_Top"), white_jkt)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Bottom"), black_pants)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Footwear"), shoe)
    create_rigged_sleeves_from_body(arm, white_jkt, white_shirt, inflate=0.012)
    add_suit_front(arm, satin_black, white_shirt, satin_black, satin_black, is_female=False, tie_kind="bowtie", pocket_square=True)
    add_bone_part(arm, "Spine2", "ButlerPin", "box", (0.052, 0.010, 0.020), (-0.086, -0.130, 0.065), gold, bevel=0.002)
    export_staff("staff_waiter_m.glb")


# ─── 5. ART DECO BELLHOP (CRIMSON TUNIC, BRASS BUTTONS & PILLBOX CAP) ───────
def build_staff_bellhop_m():
    arm = load_base("avatar_4")
    crimson = make_mat("BellhopCrimson", (0.56, 0.08, 0.14), roughness=0.62)
    black_pants = make_mat("BellhopPants", (0.07, 0.08, 0.11), roughness=0.72)
    gold = make_mat("BellhopBrass", (0.94, 0.76, 0.28), roughness=0.16, metallic=0.96)
    shoe = make_mat("BellhopShoe", (0.05, 0.05, 0.06), roughness=0.20, coat=0.7)

    set_mesh_mat(find_mesh("Wolf3D_Outfit_Top"), crimson)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Bottom"), black_pants)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Footwear"), shoe)
    create_rigged_sleeves_from_body(arm, crimson, gold, inflate=0.012)

    # Standing Art Deco crimson & gold Mandarin collar
    add_bone_part(arm, "Neck", "BellCollar", "cyl", (0.074, 0.052), (0, -0.005, 0.028), crimson)
    add_bone_part(arm, "Neck", "BellCollarTrim", "cyl", (0.077, 0.012), (0, -0.005, 0.052), gold)

    # Double-breasted brass buttons + vertical gold placket trim + shoulder epaulettes!
    for sx in (-0.050, 0.050):
        for bz in (-0.08, -0.01, 0.06):
            add_bone_part(arm, "Spine2", f"BrassBtn_{sx}_{bz}", "sphere", (0.012,), (sx, -0.146, bz), gold)
        add_bone_part(arm, "Spine2", f"Epaulette_{sx}", "box", (0.092, 0.052, 0.018), (sx * 3.1, 0.01, 0.168), gold, bevel=0.003)

    # Snug, jauntily tilted Art Deco crimson & gold pillbox bellhop cap seated right on the crown of Head!
    add_bone_part(arm, "Head", "PillboxCrown", "cyl", (0.088, 0.078), (0.018, 0.008, 0.148), crimson, rot=(0, 0.18, 0))
    add_bone_part(arm, "Head", "PillboxBand", "cyl", (0.092, 0.016), (0.012, 0.008, 0.116), gold, rot=(0, 0.18, 0))
    add_bone_part(arm, "Head", "PillboxTop", "cyl", (0.090, 0.012), (0.023, 0.008, 0.182), gold, rot=(0, 0.18, 0))

    export_staff("staff_bellhop_m.glb")


# ─── 6. HOUSEKEEPING MAID (DARK-NAVY UNIFORM DRESS, WHITE COLLAR & APRON) ───
def build_staff_maid_f():
    arm = load_base("avatar_3")
    dress_navy = make_mat("MaidNavyDress", (0.11, 0.17, 0.28), roughness=0.70)
    white = make_mat("MaidApronWhite", (0.97, 0.97, 0.95), roughness=0.82)
    shoe = make_mat("MaidFlatShoe", (0.06, 0.06, 0.08), roughness=0.28)

    set_mesh_mat(find_mesh("Wolf3D_Outfit_Top"), dress_navy)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Footwear"), shoe)

    # Crisp white Peter Pan collar around neck
    add_bone_part(arm, "Neck", "MaidCollar", "cone", (0.115, 0.068, 0.036), (0, -0.005, 0.012), white)
    # Crisp white housekeeping bib, waist sash & pleated front apron skirt (cleanly proud of dress!)
    add_bone_part(arm, "Spine2", "ApronBib", "box", (0.165, 0.026, 0.175), (0, -0.126, 0.025), white, bevel=0.006)
    add_bone_part(arm, "Spine", "ApronSash", "cyl", (0.140, 0.038, 0.85), (0, -0.006, 0.02), white)
    add_bone_part(arm, "Hips", "ApronSkirt", "box", (0.27, 0.036, 0.35), (0, -0.144, -0.125), white, bevel=0.010)
    # Crisp white housekeeping headband resting properly on TOP of her hair (not forehead!)
    add_bone_part(arm, "Head", "MaidHeadband", "torus", (0.098, 0.016), (0, 0.018, 0.168), white, rot=(-0.55, 0, 0))

    export_staff("staff_maid_f.glb")


if __name__ == "__main__":
    build_staff_concierge_f()
    build_staff_security_m()
    build_staff_bartender_m()
    build_staff_waiter_m()
    build_staff_bellhop_m()
    build_staff_maid_f()
    print("All 6 bespoke rigged 5-star hotel staff GLBs exported cleanly!")
