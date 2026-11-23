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
    """Adds tailored white shirt collar, contour-projected V-front shirt placket, notched lapels, tie/bowtie & pocket square."""
    top_mesh = find_mesh("Wolf3D_Outfit_Top")
    body_mesh = find_mesh("Wolf3D_Body")
    chest_bvh = world_bvh([m for m in (top_mesh, body_mesh) if m is not None])
    sp2 = arm.matrix_world @ arm.data.bones["Spine2"].head_local
    cx, cy = sp2.x, sp2.y
    z_top = 1.445 if is_female else 1.525
    z_bot = 1.245 if is_female else 1.315
    half_w = 0.046 if is_female else 0.054

    # Folded crisp white shirt collar around neck
    add_bone_part(
        arm, "Neck", "ShirtCollar", "cone",
        (0.066 if is_female else 0.075, 0.055 if is_female else 0.063, 0.044),
        (0, -0.006, 0.024), shirt_mat,
    )

    # Contour-projected V-shaped white dress shirt front placket
    def shirt_ray(u, v):
        w = half_w * (1.0 - 0.82 * (v ** 1.15)) + 0.005
        x = cx + (u - 0.5) * 2.0 * w
        z = z_top - (z_top - z_bot) * v
        return (x, cy - 0.45, z), (0, 1, 0)

    shirt_obj = projected_sheet("ShirtFront", 10, 14, shirt_ray, chest_bvh, shirt_mat, offset=0.0045, thickness=0.0025)
    bind_like(shirt_obj, arm, weight_src=top_mesh)

    # Contour-projected left & right tailored suit lapels framing the V-shirt placket
    for side in (-1, 1):
        def lapel_ray(u, v, side=side):
            inner_x = side * (half_w * (1.0 - 0.85 * (v ** 1.15)) + 0.003)
            lapel_w = (0.034 if is_female else 0.040) * (1.0 - 0.45 * v)
            # Small classic V-notch near the top of the lapel
            notch = -0.007 if 0.14 < v < 0.24 and u > 0.65 else 0.0
            x = cx + inner_x + side * (u * lapel_w + notch)
            z = (z_top + 0.006) - (z_top - z_bot + 0.018) * v
            return (x, cy - 0.45, z), (0, 1, 0)

        lapel_obj = projected_sheet(f"SuitLapel_{side}", 5, 16, lapel_ray, chest_bvh, lapel_mat, offset=0.0075, thickness=0.0035)
        bind_like(lapel_obj, arm, weight_src=top_mesh)

    # Jacket front buttons sitting right below the V-point
    for idx, bz in enumerate((z_bot - 0.012, z_bot - 0.068)):
        hit, normal, _, _ = chest_bvh.ray_cast(Vector((cx, cy - 0.45, bz)), Vector((0, 1, 0)))
        if hit is not None:
            bhead = arm.matrix_world @ arm.data.bones["Spine2"].head_local
            rel = hit - bhead + Vector((0, -0.006, 0))
            add_bone_part(arm, "Spine2", f"SuitBtn_{idx}", "sphere", (0.0075,), (rel.x, rel.y, rel.z), btn_mat)

    # Folded white silk pocket square on left chest
    if pocket_square:
        px0 = 0.072 if is_female else 0.084
        pz0 = z_top - 0.085

        def sq_ray(u, v):
            x = cx + px0 + (u - 0.5) * 0.038
            peak = 0.007 * abs(math.sin(u * math.pi * 2)) * (1 - v)
            z = pz0 + peak - 0.015 * v
            return (x, cy - 0.45, z), (0, 1, 0)

        sq_obj = projected_sheet("PocketSquare", 8, 3, sq_ray, chest_bvh, shirt_mat, offset=0.0065, thickness=0.0025)
        bind_like(sq_obj, arm, weight_src=top_mesh)

    # Contour-projected silk necktie or sculpted tuxedo bowtie
    if tie_kind == "bowtie":
        z_bow = z_top - 0.016

        def bow_ray(u, v):
            s = (u - 0.5) * 2.0
            wing = 0.38 + 0.62 * min(1.0, abs(s) / 0.22)
            h = 0.013 * wing
            x = cx + s * 0.038
            z = z_bow + (0.5 - v) * 2.0 * h
            return (x, cy - 0.45, z), (0, 1, 0)

        bow_obj = projected_sheet(
            "BowTie", 14, 4, bow_ray, chest_bvh, tie_mat,
            offset=0.0085, extra_fn=lambda u, v: 0.003 * math.exp(-((u - 0.5) * 8) ** 2), thickness=0.004,
        )
        bind_like(bow_obj, arm, weight_src=top_mesh)
    else:
        def tie_ray(u, v):
            # Knot at top (v=0..0.14), tapering in, then widening to classic diamond point at v=0.88..1.0
            if v < 0.14:
                w = 0.013 - 0.004 * (v / 0.14)
            elif v < 0.86:
                t = (v - 0.14) / 0.72
                w = 0.009 + 0.010 * t
            else:
                t = (1.0 - v) / 0.14
                w = 0.019 * max(0.05, t)
            x = cx + (u - 0.5) * 2.0 * w
            z = (z_top - 0.008) - (z_top - z_bot - 0.018) * v
            return (x, cy - 0.45, z), (0, 1, 0)

        tie_obj = projected_sheet(
            "NeckTie", 6, 18, tie_ray, chest_bvh, tie_mat,
            offset=0.0075, extra_fn=lambda u, v: 0.003 if v < 0.14 else 0.0, thickness=0.0035,
        )
        bind_like(tie_obj, arm, weight_src=top_mesh)


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

    # Tailored black mixologist jacket & waistcoat + crisp white French cuffs, white dress shirt front, bowtie & bistro apron!
    top_mesh = find_mesh("Wolf3D_Outfit_Top")
    bot_mesh = find_mesh("Wolf3D_Outfit_Bottom")
    set_mesh_mat(top_mesh, black_vest)
    set_mesh_mat(bot_mesh, black_pants)
    set_mesh_mat(find_mesh("Wolf3D_Outfit_Footwear"), shoe)
    create_rigged_sleeves_from_body(arm, black_vest, white, inflate=0.012)
    add_suit_front(arm, black_vest, white, black_silk, silver, is_female=False, tie_kind="bowtie", pocket_square=True)

    # Classic black bistro bar apron draped over the front of his trousers (bridging the trouser leg gap smoothly!)
    bar_bvh = world_bvh([m for m in (top_mesh, bot_mesh) if m is not None])
    hips = arm.matrix_world @ arm.data.bones["Hips"].head_local
    bx, by = hips.x, hips.y

    # Measure front outer trouser Y-profile per height row so the apron drapes smoothly across both legs without dipping into the inner-thigh gap
    apron_nu, apron_nv = 22, 20
    apron_verts = []
    apron_grid = []
    for j in range(apron_nv + 1):
        v = j / apron_nv
        z = 1.05 - 0.40 * v
        # Sample front trouser surface across left & right thighs to get smooth front radius
        front_y = -0.135 + 0.010 * v
        for sx_sample in (-0.095, -0.075, 0.075, 0.095):
            h_pt, _, _, _ = bar_bvh.ray_cast(Vector((bx + sx_sample, by - 0.5, z)), Vector((0, 1, 0)))
            if h_pt is not None:
                front_y = min(front_y, h_pt.y)
        row = []
        span = math.radians(88 + 10 * v)
        rx = 0.148 + 0.014 * v
        ry = abs(front_y - by) + 0.008
        for i in range(apron_nu + 1):
            u = i / apron_nu
            ang = (u - 0.5) * span
            px = bx + math.sin(ang) * rx
            py = by - math.cos(ang) * ry - 0.003 * (math.sin(u * math.pi * 6) ** 2) * v
            row.append(len(apron_verts))
            apron_verts.append((px, py, z))
        apron_grid.append(row)
    apron_faces = [
        (apron_grid[j][i], apron_grid[j][i + 1], apron_grid[j + 1][i + 1], apron_grid[j + 1][i])
        for j in range(apron_nv)
        for i in range(apron_nu)
    ]
    ap_me = bpy.data.meshes.new("BarApron")
    ap_me.from_pydata(apron_verts, [], apron_faces)
    ap_me.update()
    bar_apron = bpy.data.objects.new("BarApron", ap_me)
    bpy.context.collection.objects.link(bar_apron)
    bar_apron.data.materials.append(black_vest)
    bpy.context.view_layer.objects.active = bar_apron
    bpy.ops.object.select_all(action="DESELECT")
    bar_apron.select_set(True)
    bpy.ops.object.shade_smooth()
    smod = bar_apron.modifiers.new("Solidify", "SOLIDIFY")
    smod.thickness = 0.0035
    bpy.ops.object.modifier_apply(modifier=smod.name)
    bind_like(bar_apron, arm, weight_src=bot_mesh or top_mesh)

    def bar_sash_ray(u, v):
        a = u * 2 * math.pi
        z = 1.06 - 0.032 * v
        d = Vector((math.sin(a), -math.cos(a), 0))
        return (bx + d.x * 0.55, by + d.y * 0.55, z), (-d.x, -d.y, 0)

    bar_sash = projected_sheet("BarApronSash", 48, 2, bar_sash_ray, bar_bvh, black_silk, offset=0.009, closed_u=True, thickness=0.003)
    bind_like(bar_sash, arm, weight_src=bot_mesh or top_mesh)
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
# Every garment here is a real skinned cloth surface: either derived from the rigged body/dress
# mesh (sleeves, tights, knee-length dress) or projected onto the dress surface and given the
# dress's exact per-vertex bone weights (apron, bib, straps, sash, collar, pocket, badge).
# Nothing is a rigid primitive block, so the apron folds with the hips & thighs when she walks.


def world_bvh(objs):
    """World-space BVH of the evaluated (rest-pose) meshes for projecting garments onto surfaces."""
    from mathutils.bvhtree import BVHTree

    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for o in objs:
        tmp = bmesh.new()
        tmp.from_object(o, dg)
        tmp.transform(o.matrix_world)
        me = bpy.data.meshes.new("_bvh_tmp")
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def bind_like(obj, arm, weight_src=None, rigid_bone=None):
    """Skins a garment: copies interpolated bone weights from weight_src (or binds rigidly to one bone)."""
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if weight_src is not None:
        mod = obj.modifiers.new("WeightXfer", "DATA_TRANSFER")
        mod.object = weight_src
        mod.use_vert_data = True
        mod.data_types_verts = {"VGROUP_WEIGHTS"}
        mod.vert_mapping = "POLYINTERP_NEAREST"
        mod.layers_vgroup_select_src = "ALL"
        mod.layers_vgroup_select_dst = "NAME"
        bpy.ops.object.datalayout_transfer(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    elif rigid_bone is not None:
        vg = obj.vertex_groups.new(name=rigid_bone)
        vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


def projected_sheet(name, nu, nv, ray_fn, bvh, mat, offset=0.006, extra_fn=None, thickness=0.0035, closed_u=False, z_clamp=None):
    """
    Builds a smooth cloth panel by casting a grid of rays onto a surface (dress / head) and sitting each
    vertex `offset` meters proud of the surface along its normal. ray_fn(u, v) -> (origin, direction).
    """
    verts = []
    grid = []
    for j in range(nv + 1):
        row = []
        v = j / nv
        for i in range(nu + (0 if closed_u else 1)):
            u = i / nu
            origin, direction = ray_fn(u, v)
            origin = Vector(origin)
            direction = Vector(direction).normalized()
            hit, normal, _idx, _dist = bvh.ray_cast(origin, direction)
            if hit is None:
                near_pt = origin + direction * 0.55
                hit, normal, _idx, _dist = bvh.find_nearest(near_pt)
            if hit is None:
                hit = origin + direction * 0.55
                normal = -direction
            elif normal.dot(direction) > 0:
                normal = -normal
            if z_clamp is not None:
                hit = Vector((hit.x, hit.y, max(z_clamp[0], min(z_clamp[1], hit.z))))
            off = offset + (extra_fn(u, v) if extra_fn else 0.0)
            row.append(len(verts))
            verts.append(hit + normal * off)
        grid.append(row)
    faces = []
    cols = nu if closed_u else nu
    for j in range(nv):
        for i in range(cols):
            i2 = (i + 1) % len(grid[j]) if closed_u else i + 1
            faces.append((grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in verts], [], faces)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    if thickness > 0:
        mod = obj.modifiers.new("Solidify", "SOLIDIFY")
        mod.thickness = thickness
        mod.offset = 0.0
        mod.use_even_offset = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def body_region_garment(arm, name, keep_fn, mat, inflate, mat2=None, mat2_fn=None):
    """Duplicates rigged Wolf3D_Body faces selected by keep_fn(vertex_world, bone_weights) and inflates them."""
    body = find_mesh("Wolf3D_Body")
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = name
    bpy.context.collection.objects.link(obj)
    gnames = {vg.index: vg.name for vg in obj.vertex_groups}
    mw = obj.matrix_world
    keep = set()
    for v in obj.data.vertices:
        w = {}
        for g in v.groups:
            n = gnames.get(g.group, "")
            w[n] = w.get(n, 0.0) + g.weight
        if keep_fn(mw @ v.co, w):
            keep.add(v.index)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v.index in keep for v in f.verts)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (inflate(mw @ v.co) if callable(inflate) else inflate)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if mat2 is not None:
        obj.data.materials.append(mat2)
        for f in bm.faces:
            c = mw @ f.calc_center_median()
            f.material_index = 1 if mat2_fn(c) else 0
    bm.to_mesh(obj.data)
    bm.free()
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    return obj


def tailor_maid_dress(dress, arm):
    """Turns the base party mini-dress into a modest knee-length housekeeping dress (no belt bulge)."""
    mw = dress.matrix_world
    mwi = mw.inverted()
    hips = arm.matrix_world @ arm.data.bones["Hips"].head_local
    cx, cy = hips.x, hips.y
    me = dress.data
    pts = [mw @ v.co for v in me.vertices]

    # 1. Flatten the fashion belt & buckle back into the smooth dress silhouette.
    def ang_bin(p):
        return int(((math.atan2(p.y - cy, p.x - cx) + math.pi) / (2 * math.pi)) * 24) % 24

    def ring_radius(z0, z1):
        acc = [[] for _ in range(24)]
        for p in pts:
            if z0 <= p.z <= z1:
                acc[ang_bin(p)].append(math.hypot(p.x - cx, p.y - cy))
        return [sum(a) / len(a) if a else None for a in acc]

    lo = ring_radius(1.06, 1.10)
    hi = ring_radius(1.20, 1.24)
    for v, p in zip(me.vertices, pts):
        if 1.095 <= p.z <= 1.205:
            b = ang_bin(p)
            if lo[b] is None or hi[b] is None:
                continue
            t = (p.z - 1.08) / (1.22 - 1.08)
            target = lo[b] + (hi[b] - lo[b]) * t + 0.002
            r = math.hypot(p.x - cx, p.y - cy)
            if r > target:
                s = target / r
                np_ = Vector((cx + (p.x - cx) * s, cy + (p.y - cy) * s, p.z))
                v.co = mwi @ np_

    # 2. Lengthen the skirt from mid-thigh to just above the knee with a gentle A-line flare.
    z_top, z_old, z_new = 0.98, 0.73, 0.60
    stretch = (z_top - z_new) / (z_top - z_old)
    for v in me.vertices:
        p = mw @ v.co
        if p.z < z_top:
            t = (z_top - p.z) / (z_top - z_old)
            nz = z_top - (z_top - p.z) * stretch
            flare = 1.0 + 0.10 * min(1.0, t) ** 1.4
            v.co = mwi @ Vector((cx + (p.x - cx) * flare, cy + (p.y - cy) * flare, nz))
    me.update()


def build_staff_maid_f():
    arm = load_base("avatar_3")
    dress_navy = make_mat("MaidNavyDress", (0.055, 0.075, 0.14), roughness=0.78)
    white = make_mat("MaidApronWhite", (0.95, 0.95, 0.93), roughness=0.86)
    lace = make_mat("MaidLaceTrim", (0.98, 0.98, 0.97), roughness=0.9)
    tights = make_mat("MaidTights", (0.045, 0.045, 0.055), roughness=0.55)
    shoe = make_mat("MaidFlatShoe", (0.03, 0.03, 0.035), roughness=0.3, coat=0.6)
    gold = make_mat("MaidBadgeGold", (0.94, 0.76, 0.28), roughness=0.18, metallic=0.95)

    dress = find_mesh("Wolf3D_Outfit_Top")
    set_mesh_mat(dress, dress_navy)
    tailor_maid_dress(dress, arm)

    # Swap the party high heels for sensible black flat work shoes (same RPM skeleton → avatar_7 flats).
    old_shoe = find_mesh("Wolf3D_Outfit_Footwear")
    if old_shoe:
        bpy.data.objects.remove(old_shoe, do_unlink=True)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS_DIR, "avatar_7.glb"))
    imported = [o for o in bpy.context.scene.objects if o not in before]
    flats = next((o for o in imported if o.type == "MESH" and "footwear" in o.name.lower()), None)
    if flats:
        flats.parent = arm
        flats.matrix_parent_inverse = arm.matrix_world.inverted()
        for m in flats.modifiers:
            if m.type == "ARMATURE":
                m.object = arm
        set_mesh_mat(flats, shoe)
    for o in imported:
        if o is not flats:
            bpy.data.objects.remove(o, do_unlink=True)
    if flats:
        flats.name = "Wolf3D_Outfit_Footwear"

    # Opaque dark work tights directly on the lower-leg faces of Wolf3D_Body (zero UV-seam split or skin bleed!)
    body_obj = find_mesh("Wolf3D_Body")
    if body_obj:
        body_obj.data.materials.append(tights)
        tights_slot = len(body_obj.data.materials) - 1
        mw_b = body_obj.matrix_world
        for poly in body_obj.data.polygons:
            c = mw_b @ poly.center
            if c.z < 0.68:
                poly.material_index = tights_slot

    # Short tailored navy sleeves with crisp white turned-back cuffs (skinned from upper-arm vertices).
    l_arm = arm.matrix_world @ arm.data.bones["LeftArm"].head_local
    r_arm = arm.matrix_world @ arm.data.bones["RightArm"].head_local

    def arm_dist(p):
        return min((p - l_arm).length, (p - r_arm).length)

    body_region_garment(
        arm,
        "MaidSleeves",
        lambda p, w: (w.get("LeftArm", 0) + w.get("RightArm", 0) + w.get("LeftShoulder", 0) + w.get("RightShoulder", 0)) > 0.3 and arm_dist(p) < 0.165,
        dress_navy,
        lambda p: 0.012 + 0.006 * math.sin(min(1.0, arm_dist(p) / 0.165) * math.pi),
        mat2=white,
        mat2_fn=lambda c: arm_dist(c) > 0.135,
    )

    dress_bvh = world_bvh([dress])
    hips = arm.matrix_world @ arm.data.bones["Hips"].head_local
    ax, ay = hips.x, hips.y

    # ── Half-apron skirt: gathered white cotton wrapping smoothly around front waist & hips with soft pleats & scalloped hem ──
    z_waist, z_hem = 1.105, 0.70

    def apron_ray(u, v):
        span = math.radians(108 + 14 * v)
        ang = (u - 0.5) * span
        dx, dy = math.sin(ang), -math.cos(ang)
        hem = z_hem + 0.010 * (1 - abs(math.sin(u * math.pi * 7)))
        z = z_waist - (z_waist - hem) * v
        return (ax + dx * 0.55, ay + dy * 0.55, z), (-dx, -dy, 0)

    apron = projected_sheet(
        "MaidApronSkirt", 30, 26, apron_ray, dress_bvh, white,
        offset=0.008,
        extra_fn=lambda u, v: 0.0045 * (math.sin(u * math.pi * 10) ** 2) * (0.25 + v),
    )
    bind_like(apron, arm, weight_src=dress)

    # Lace ruffle along the apron hem
    def lace_ray(u, v):
        span = math.radians(122)
        ang = (u - 0.5) * span
        dx, dy = math.sin(ang), -math.cos(ang)
        hem = z_hem + 0.010 * (1 - abs(math.sin(u * math.pi * 7)))
        z = hem + 0.004 - 0.032 * v
        return (ax + dx * 0.55, ay + dy * 0.55, z), (-dx, -dy, 0)

    lace_obj = projected_sheet(
        "MaidApronLace", 72, 3, lace_ray, dress_bvh, lace,
        offset=0.011, extra_fn=lambda u, v: 0.004 * abs(math.sin(u * math.pi * 36)) * v, thickness=0.002,
    )
    bind_like(lace_obj, arm, weight_src=dress)

    # Patch pocket with navy piping on the apron (for her master key & notepad)
    def pocket_ray(u, v):
        x = ax - 0.075 + (u - 0.5) * 0.10
        z = 0.95 - 0.10 * v
        return (x, ay - 0.6, z), (0, 1, 0)

    pocket = projected_sheet("MaidApronPocket", 8, 8, pocket_ray, dress_bvh, white, offset=0.0135, thickness=0.003)
    bind_like(pocket, arm, weight_src=dress)

    def piping_ray(u, v):
        x = ax - 0.075 + (u - 0.5) * 0.10
        z = 0.95 - 0.008 * v
        return (x, ay - 0.6, z), (0, 1, 0)

    piping = projected_sheet("MaidPocketPiping", 8, 1, piping_ray, dress_bvh, dress_navy, offset=0.0165, thickness=0.002)
    bind_like(piping, arm, weight_src=dress)

    # ── Bib with softly rounded top corners ──
    def bib_ray(u, v):
        w = 0.15 + 0.05 * v
        x = ax + (u - 0.5) * w
        corner = 0.018 * (1 - math.sin(u * math.pi)) ** 3
        z_top = 1.395 - corner
        z = z_top - (z_top - 1.10) * v
        return (x, ay - 0.6, z), (0, 1, 0)

    bib = projected_sheet("MaidApronBib", 14, 20, bib_ray, dress_bvh, white, offset=0.0085)
    bind_like(bib, arm, weight_src=dress)

    # ── Shoulder straps running from the bib corners over the shoulders down to the back waist ──
    for side in (-1, 1):
        sx = ax + side * 0.068

        def strap_ray(u, v, sx=sx, side=side):
            th = math.radians(38 + (232 - 38) * v)
            x = sx + (u - 0.5) * 0.024 + side * 0.012 * math.sin(math.radians(38 + (232 - 38) * v))
            c = Vector((x, -0.015, 1.30))
            d = Vector((0, -math.cos(th), math.sin(th)))
            return tuple(c + d * 0.5), tuple(-d)

        strap = projected_sheet(f"MaidStrap_{side}", 2, 40, strap_ray, dress_bvh, white, offset=0.0095, thickness=0.003)
        bind_like(strap, arm, weight_src=dress)

    # ── Waist sash wrapping all the way around, with a soft bow & tails at the back ──
    def sash_ray(u, v):
        a = u * 2 * math.pi
        z = 1.145 - 0.042 * v
        d = Vector((math.sin(a), -math.cos(a), 0))
        return (ax + d.x * 0.6, ay + d.y * 0.6, z), (-d.x, -d.y, 0)

    sash = projected_sheet("MaidApronSash", 64, 3, sash_ray, dress_bvh, white, offset=0.0105, closed_u=True)
    bind_like(sash, arm, weight_src=dress)

    for side in (-1, 1):
        def bow_ray(u, v, side=side):
            # Soft bow loop resting on the center-back waist (straight -Y ray within narrow back width -> 100% hit!)
            x = ax + side * (0.012 + 0.040 * u)
            arch = math.sin(u * math.pi) * (0.018 + 0.010 * (0.5 - abs(v - 0.5)))
            z = 1.125 + (v - 0.5) * 0.032 + arch * 0.35
            return (x, ay + 0.55, z), (0, -1, 0)

        bow = projected_sheet(
            f"MaidBowLoop_{side}", 12, 4, bow_ray, dress_bvh, white,
            offset=0.014, extra_fn=lambda u, v: 0.010 * math.sin(u * math.pi), thickness=0.0045,
        )
        bind_like(bow, arm, weight_src=dress)

        def tail_ray(u, v, side=side):
            x = ax + side * (0.012 + 0.022 * v) + (u - 0.5) * 0.028
            z = 1.11 - 0.16 * v
            return (x, ay + 0.55, z), (0, -1, 0)

        tail = projected_sheet(f"MaidBowTail_{side}", 4, 12, tail_ray, dress_bvh, white, offset=0.013, thickness=0.003)
        bind_like(tail, arm, weight_src=dress)

    def knot_ray(u, v):
        x = ax + (u - 0.5) * 0.03
        z = 1.142 - 0.04 * v
        return (x, ay + 0.6, z), (0, -1, 0)

    knot = projected_sheet("MaidBowKnot", 4, 4, knot_ray, dress_bvh, white, offset=0.022, thickness=0.006)
    bind_like(knot, arm, weight_src=dress)

    # ── Rounded white Peter Pan collar lying flat over the collarbone & shoulders (never touching hair/jaw!) ──
    body = find_mesh("Wolf3D_Body")
    collar_bvh = world_bvh([m for m in (dress, body) if m is not None])
    neck = arm.matrix_world @ arm.data.bones["Neck"].head_local
    for side in (-1, 1):
        def collar_ray(u, v, side=side):
            phi = math.radians(12 + (168 - 12) * u)
            lobe = math.sin(u * math.pi)
            width = 0.040 * (0.35 + 0.65 * lobe)
            r = 0.056 + width * v
            x = neck.x + side * math.sin(phi) * r
            y = neck.y - 0.008 - math.cos(phi) * r * 0.92
            return (x, y, 1.495), (0, 0, -1)

        collar = projected_sheet(
            f"MaidCollar_{side}", 24, 5, collar_ray, collar_bvh, white,
            offset=0.0055, thickness=0.0035, z_clamp=(1.415, 1.472),
        )
        bind_like(collar, arm, weight_src=dress)

    # ── Gold housekeeping name badge pinned to the bib ──
    def badge_ray(u, v):
        x = ax + 0.045 + (u - 0.5) * 0.052
        z = 1.355 - 0.017 * v
        return (x, ay - 0.6, z), (0, 1, 0)

    badge = projected_sheet("MaidNameBadge", 4, 2, badge_ray, dress_bvh, gold, offset=0.0135, thickness=0.003)
    bind_like(badge, arm, weight_src=dress)

    # ── Ruffled white headband resting on top of her hair ──
    head = find_mesh("Wolf3D_Head")
    hair = find_mesh("Wolf3D_Hair")
    head_bvh = world_bvh([m for m in (hair, head) if m is not None])
    hb = arm.matrix_world @ arm.data.bones["Head"].head_local

    def band_ray(u, v):
        th = math.radians(18 + (162 - 18) * u)
        tilt = -0.32
        d = Vector((math.cos(th), 0.0, math.sin(th)))
        d = Vector((d.x, d.y * math.cos(tilt) - d.z * math.sin(tilt), d.y * math.sin(tilt) + d.z * math.cos(tilt)))
        c = Vector((hb.x, hb.y + 0.005 - 0.014 * (v - 0.5) * 2, hb.z + 0.075))
        return tuple(c + d * 0.4), tuple(-d)

    band = projected_sheet(
        "MaidHeadband", 32, 4, band_ray, head_bvh, lace, offset=0.007,
        extra_fn=lambda u, v: (0.014 * math.sin(u * math.pi) + 0.005 * abs(math.sin(u * math.pi * 20))) * (1 - v),
        thickness=0.0035,
    )
    bind_like(band, arm, rigid_bone="Head")

    export_staff("staff_maid_f.glb")


if __name__ == "__main__":
    build_staff_concierge_f()
    build_staff_security_m()
    build_staff_bartender_m()
    build_staff_waiter_m()
    build_staff_bellhop_m()
    build_staff_maid_f()
    print("All 6 bespoke rigged 5-star hotel staff GLBs exported cleanly!")
