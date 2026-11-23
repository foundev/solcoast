"""
Generates 7 bespoke Blender 5.2 Street Furniture & Urban Props GLBs for Sol Coast (Sweep Batch 3):
  1. prop_park_bench.glb           — Cast-iron scrolled legs & curved slatted teak bench (2.1m x 0.62m)
  2. prop_fire_hydrant.glb         — Bolted municipal cast-iron red fire hydrant with brass nozzles & bonnet
  3. prop_bougainvillea_planter.glb— Stepped coral-stone planter box (1.6m x 4.6m) with lush foliage & magenta blooms
  4. prop_sidewalk_cafe.glb        — Wrought-iron marble bistro table, 2 sculpted café chairs & scalloped parasol
  5. prop_street_lamp.glb          — Fluted Art Deco cast-iron streetlamp, scrolled bracket & lantern head (+Z arm)
  6. prop_traffic_signal.glb       — Bolted municipal gantry post, tapered mast arm (+X) & hooded 3-lens signal head
  7. prop_bollard.glb              — Fluted Art Deco cast-iron coastal bollard with brass safety band & dome cap

Run:
  blender --background --python scripts/generate-blender-street.py
"""
import math
import os
import random
import bpy
import bmesh
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "public", "assets", "props"))
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, base_color, roughness=0.45, metallic=0.0, emission=None, emission_strength=0.0, coat=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name=name)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if coat > 0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    if emission is not None and emission_strength > 0:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 0.99:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
    return mat


def add_box(name, size, loc, mat, rot=(0, 0, 0), bevel_width=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel_width > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel_width
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(mat)
    return obj


def add_cyl(name, r1, depth, loc, mat, verts=16, rot=(0, 0, 0), smooth=True, r2=None):
    if r2 is not None:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r1, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    if smooth:
        bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def add_sphere(name, radius, loc, mat, segs=12, rings=8, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=segs, ring_count=rings)
    obj = bpy.context.active_object
    obj.name = name
    if scale != (1, 1, 1):
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def add_torus(name, major_r, minor_r, loc, mat, rot=(0, 0, 0), major_segs=18, minor_segs=8):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_r,
        minor_radius=minor_r,
        major_segments=major_segs,
        minor_segments=minor_segs,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def export_glb(filename, center_xy=True):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    min_x = min_y = min_z = 1e9
    max_x = max_y = -1e9
    for o in objs:
        for corner in o.bound_box:
            wc = o.matrix_world @ Vector(corner)
            min_x = min(min_x, wc.x)
            max_x = max(max_x, wc.x)
            min_y = min(min_y, wc.y)
            max_y = max(max_y, wc.y)
            min_z = min(min_z, wc.z)
    cx = (min_x + max_x) * 0.5 if center_xy else 0.0
    cy = (min_y + max_y) * 0.5 if center_xy else 0.0
    for o in objs:
        o.location.x -= cx
        o.location.y -= cy
        o.location.z -= min_z

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    out_path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_materials="EXPORT",
    )
    sz = os.path.getsize(out_path) / 1024.0
    print(f"[blender-street] {filename}: {sz:.1f} KB")


# ─── 1. PARK & BOARDWALK BENCH (2.10m x 0.62m) ──────────────────────────────
# Backrest on -Y in Blender (+Z in glTF), sitter faces +Y in Blender (-Z in glTF)
def build_park_bench():
    clear_scene()
    iron = make_mat("BenchIron", (0.11, 0.14, 0.18), roughness=0.38, metallic=0.84)
    teak = make_mat("BenchTeak", (0.52, 0.31, 0.16), roughness=0.58)
    brass = make_mat("BenchBrass", (0.86, 0.68, 0.28), roughness=0.26, metallic=0.90)

    # 3 cast-iron leg frames (left, center support, right)
    for idx, lx in enumerate((-0.90, 0.0, 0.90)):
        is_end = idx != 1
        # Front & rear curved legs + splayed foot pads
        add_box(f"LegF_{idx}", (0.055, 0.055, 0.44), (lx, 0.22, 0.22), iron, rot=(-0.08, 0, 0), bevel_width=0.008)
        add_box(f"LegR_{idx}", (0.055, 0.055, 0.46), (lx, -0.23, 0.23), iron, rot=(0.10, 0, 0), bevel_width=0.008)
        add_box(f"FootF_{idx}", (0.09, 0.11, 0.03), (lx, 0.24, 0.015), iron, bevel_width=0.005)
        add_box(f"FootR_{idx}", (0.09, 0.11, 0.03), (lx, -0.25, 0.015), iron, bevel_width=0.005)
        # Seat cradle bar & lower stretcher
        add_box(f"SeatBar_{idx}", (0.05, 0.50, 0.045), (lx, 0.0, 0.43), iron, bevel_width=0.006)
        add_box(f"LowBar_{idx}", (0.04, 0.44, 0.035), (lx, 0.0, 0.20), iron)
        # Reclined backrest upright
        add_box(f"BackBar_{idx}", (0.048, 0.048, 0.46), (lx, -0.24, 0.65), iron, rot=(-0.18, 0, 0), bevel_width=0.006)
        if is_end:
            # Scrolled Art Deco cast-iron armrest & decorative circle medallion
            add_box(f"ArmTop_{idx}", (0.06, 0.44, 0.035), (lx, -0.01, 0.63), iron, bevel_width=0.008)
            add_box(f"ArmFront_{idx}", (0.045, 0.045, 0.21), (lx, 0.20, 0.53), iron, bevel_width=0.006)
            add_torus(f"Scroll_{idx}", 0.075, 0.016, (lx, 0.0, 0.53), iron, rot=(0, math.pi * 0.5, 0))

    # Longitudinal under-seat steel tie bar
    add_box("UnderTie", (1.82, 0.04, 0.04), (0, -0.04, 0.36), iron)

    # 5 contoured slatted teak seat planks
    seat_profile = [
        (0.22, 0.452, -0.10),
        (0.12, 0.466, -0.03),
        (0.02, 0.466, 0.02),
        (-0.08, 0.460, 0.06),
        (-0.18, 0.454, 0.09),
    ]
    for i, (sy, sz, tilt) in enumerate(seat_profile):
        add_box(f"SeatSlat_{i}", (2.10, 0.082, 0.028), (0, sy, sz), teak, rot=(tilt, 0, 0), bevel_width=0.006)
        for bx in (-0.90, 0.90):
            add_cyl(f"SBolt_{i}_{bx}", 0.010, 0.034, (bx, sy, sz + 0.004), brass, verts=8)

    # 4 slatted teak backrest planks following the recline curve
    for i in range(4):
        t = i / 3.0
        by = -0.215 - t * 0.072
        bz = 0.56 + t * 0.30
        add_box(f"BackSlat_{i}", (2.10, 0.028, 0.078), (0, by, bz), teak, rot=(-0.18, 0, 0), bevel_width=0.006)
        for bx in (-0.90, 0.90):
            add_cyl(f"BBolt_{i}_{bx}", 0.010, 0.036, (bx, by + 0.004, bz), brass, verts=8, rot=(math.pi * 0.5 - 0.18, 0, 0))

    export_glb("prop_park_bench.glb")


# ─── 2. BOLTED MUNICIPAL CAST-IRON FIRE HYDRANT ─────────────────────────────
def build_fire_hydrant():
    clear_scene()
    red = make_mat("HydrantRed", (0.82, 0.10, 0.13), roughness=0.34, metallic=0.28, coat=0.5)
    brass = make_mat("HydrantBrass", (0.88, 0.72, 0.32), roughness=0.25, metallic=0.90)
    iron = make_mat("HydrantIron", (0.16, 0.18, 0.21), roughness=0.45, metallic=0.82)

    # Ground flange plate + 6 hex anchor bolts
    add_cyl("BasePlate", 0.21, 0.05, (0, 0, 0.025), iron, verts=16)
    add_cyl("BaseCollar", 0.185, 0.08, (0, 0, 0.08), red, verts=16, r2=0.155)
    for i in range(6):
        a = (i / 6) * math.pi * 2
        add_cyl(f"BaseBolt_{i}", 0.016, 0.035, (math.cos(a) * 0.175, math.sin(a) * 0.175, 0.055), brass, verts=6, smooth=False)

    # Fluted cast-iron barrel (12 subtle vertical flutes around cylinder)
    add_cyl("Barrel", 0.135, 0.52, (0, 0, 0.36), red, verts=16, r2=0.125)
    for i in range(8):
        a = (i / 8) * math.pi * 2
        add_cyl(f"Flute_{i}", 0.016, 0.44, (math.cos(a) * 0.128, math.sin(a) * 0.128, 0.35), red, verts=8)

    # Upper bolted collar flange
    add_cyl("NeckFlange", 0.165, 0.045, (0, 0, 0.62), red, verts=16)
    for i in range(6):
        a = (i / 6) * math.pi * 2
        add_cyl(f"NeckBolt_{i}", 0.013, 0.055, (math.cos(a) * 0.145, math.sin(a) * 0.145, 0.62), brass, verts=6, smooth=False)

    # Two side 2.5" hose nozzles (+X and -X) with brass caps + pentagon nuts
    for sx in (-1, 1):
        add_cyl(f"SideNozzle_{sx}", 0.052, 0.11, (sx * 0.145, 0, 0.49), red, verts=14, rot=(0, math.pi * 0.5, 0))
        add_cyl(f"SideCap_{sx}", 0.058, 0.038, (sx * 0.205, 0, 0.49), brass, verts=14, rot=(0, math.pi * 0.5, 0))
        add_cyl(f"SideNut_{sx}", 0.022, 0.028, (sx * 0.232, 0, 0.49), brass, verts=5, rot=(0, math.pi * 0.5, 0), smooth=False)

    # Front large 4.5" steamer port (-Y in Blender -> +Z in glTF)
    add_cyl("SteamerNozzle", 0.072, 0.12, (0, -0.145, 0.46), red, verts=14, rot=(math.pi * 0.5, 0, 0))
    add_cyl("SteamerCap", 0.078, 0.042, (0, -0.208, 0.46), brass, verts=14, rot=(math.pi * 0.5, 0, 0))
    add_cyl("SteamerNut", 0.026, 0.032, (0, -0.238, 0.46), brass, verts=5, rot=(math.pi * 0.5, 0, 0), smooth=False)

    # Domed ribbed bonnet + top pentagon operating nut
    add_sphere("BonnetDome", 0.145, (0, 0, 0.64), red, segs=16, rings=10, scale=(1.0, 1.0, 0.85))
    add_cyl("TopCollar", 0.055, 0.04, (0, 0, 0.77), red, verts=12)
    add_cyl("TopNut", 0.036, 0.055, (0, 0, 0.81), brass, verts=5, smooth=False)

    export_glb("prop_fire_hydrant.glb")


# ─── 3. CORAL-STONE BOUGAINVILLEA PLANTER (1.60m x 4.60m) ───────────────────
def build_bougainvillea_planter():
    clear_scene()
    stone = make_mat("PlanterStone", (0.91, 0.87, 0.80), roughness=0.78)
    trim = make_mat("PlanterTrim", (0.83, 0.78, 0.70), roughness=0.72)
    soil = make_mat("PlanterSoil", (0.20, 0.14, 0.09), roughness=0.95)
    leaf_dark = make_mat("LeafDark", (0.10, 0.36, 0.16), roughness=0.78)
    leaf_mid = make_mat("LeafMid", (0.16, 0.48, 0.21), roughness=0.74)
    magenta = make_mat("BougMagenta", (0.94, 0.12, 0.52), roughness=0.62)
    fuchsia = make_mat("BougFuchsia", (0.98, 0.28, 0.64), roughness=0.60)

    # Stepped architectural Miami limestone planter box (1.60m x 4.60m)
    add_box("BasePlinth", (1.60, 4.60, 0.12), (0, 0, 0.06), trim, bevel_width=0.015)
    add_box("BodyBox", (1.48, 4.48, 0.40), (0, 0, 0.32), stone, bevel_width=0.015)
    # Recessed decorative stone side pilasters
    for py in (-2.05, -0.70, 0.70, 2.05):
        add_box(f"Pilaster_{py}", (1.54, 0.18, 0.40), (0, py, 0.32), trim, bevel_width=0.01)
    # Overhanging beveled stone coping ledge (hollowed via 4 rim rails + recessed mulch bed)
    add_box("CopingL", (0.18, 4.60, 0.10), (-0.71, 0, 0.55), trim, bevel_width=0.015)
    add_box("CopingR", (0.18, 4.60, 0.10), (0.71, 0, 0.55), trim, bevel_width=0.015)
    add_box("CopingN", (1.28, 0.18, 0.10), (0, 2.21, 0.55), trim, bevel_width=0.015)
    add_box("CopingS", (1.28, 0.18, 0.10), (0, -2.21, 0.55), trim, bevel_width=0.015)
    add_box("SoilBed", (1.26, 4.24, 0.08), (0, 0, 0.49), soil)

    # Sculpted organic tropical hedge & cascading bougainvillea blooms (deterministic RNG!)
    def add_leaf_cluster(cname, radius, loc, mat, seed_val, scale=(1, 1, 1)):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=loc)
        obj = bpy.context.active_object
        obj.name = cname
        lrng = random.Random(seed_val)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        for v in bm.verts:
            jit = lrng.uniform(0.76, 1.24)
            v.co.x *= scale[0] * jit
            v.co.y *= scale[1] * jit
            v.co.z *= scale[2] * jit
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.materials.append(mat)
        return obj

    rng = random.Random(30501)
    # Layered jagged leafy foliage clusters along the 4.2m bed
    for i in range(22):
        fy = -1.94 + (i / 21.0) * 3.88 + rng.uniform(-0.08, 0.08)
        fx = rng.uniform(-0.36, 0.36)
        fz = 0.72 + rng.uniform(-0.05, 0.16)
        r = rng.uniform(0.28, 0.42)
        mat = leaf_dark if i % 2 == 0 else leaf_mid
        add_leaf_cluster(f"Foliage_{i}", r, (fx, fy, fz), mat, 1000 + i, scale=(1.05, 1.15, 0.78))

    # Smaller upper crown foliage tufts for natural irregular botanical silhouette
    for i in range(14):
        fy = -1.78 + (i / 13.0) * 3.56
        fx = rng.uniform(-0.26, 0.26)
        fz = 0.94 + rng.uniform(0.0, 0.16)
        add_leaf_cluster(f"Crown_{i}", rng.uniform(0.20, 0.28), (fx, fy, fz), leaf_mid, 2000 + i, scale=(1.0, 1.1, 0.85))

    # Cascading vibrant magenta & fuchsia bougainvillea flower clusters!
    for i in range(32):
        fy = -1.96 + (i / 31.0) * 3.92 + rng.uniform(-0.10, 0.10)
        side = -1 if i % 2 == 0 else 1
        fx = side * rng.uniform(0.16, 0.56)
        fz = 0.84 + rng.uniform(-0.12, 0.30)
        bmat = magenta if i % 3 != 0 else fuchsia
        add_leaf_cluster(f"Bloom_{i}", rng.uniform(0.10, 0.16), (fx, fy, fz), bmat, 3000 + i, scale=(1.1, 1.0, 0.82))

    export_glb("prop_bougainvillea_planter.glb")


# ─── 4. OCEAN DRIVE SIDEWALK CAFÉ SET (TABLE, 2 CHAIRS & SCALLOPED PARASOL) ─
def build_sidewalk_cafe():
    clear_scene()
    iron = make_mat("CafeIron", (0.12, 0.15, 0.19), roughness=0.35, metallic=0.84)
    marble = make_mat("CafeMarble", (0.95, 0.94, 0.91), roughness=0.18, coat=0.6)
    brass = make_mat("CafeBrass", (0.88, 0.70, 0.30), roughness=0.22, metallic=0.92)
    rattan = make_mat("CafeRattan", (0.72, 0.54, 0.32), roughness=0.72)
    wood = make_mat("CafeWood", (0.50, 0.32, 0.16), roughness=0.50)
    tint = make_mat("TintCanopy", (0.98, 0.38, 0.58), roughness=0.72)
    white = make_mat("CafeWhite", (0.98, 0.97, 0.95), roughness=0.72)

    # Cast-iron 3-footed scrolled bistro table pedestal + marble tabletop + brass rim
    add_cyl("TablePedestal", 0.048, 0.72, (0, 0, 0.39), iron, verts=12, r2=0.036)
    add_cyl("TableHub", 0.09, 0.07, (0, 0, 0.06), iron, verts=12)
    for i in range(3):
        a = (i / 3) * math.pi * 2
        add_box(f"TableFoot_{i}", (0.34, 0.045, 0.045), (math.cos(a) * 0.16, math.sin(a) * 0.16, 0.045), iron, rot=(0, 0.15, a), bevel_width=0.006)
    add_cyl("TableTop", 0.54, 0.042, (0, 0, 0.765), marble, verts=24)
    add_torus("TableRim", 0.545, 0.018, (0, 0, 0.765), brass, major_segs=24, minor_segs=8)

    # Two sculpted Parisian/Miami bistro chairs tucked neatly at -X and +X
    for side in (-1, 1):
        cx = side * 0.66
        # Circular woven rattan seat cushion + iron seat ring
        add_cyl(f"ChairSeat_{side}", 0.21, 0.036, (cx, 0, 0.46), rattan, verts=16)
        add_torus(f"ChairRing_{side}", 0.215, 0.014, (cx, 0, 0.45), iron, major_segs=16, minor_segs=6)
        # 4 splayed tapered legs
        for lx in (-0.14, 0.14):
            for ly in (-0.14, 0.14):
                add_cyl(f"CLeg_{side}_{lx}_{ly}", 0.013, 0.46, (cx + lx * 1.1, ly * 1.1, 0.23), iron, verts=8, rot=(-ly * 0.35, lx * 0.35, 0))
        # Curved wrought-iron backrest hoop + vertical spindles on outer side
        bx = cx + side * 0.20
        add_cyl(f"CBackL_{side}", 0.014, 0.42, (bx, -0.15, 0.66), iron, verts=8, rot=(0, side * 0.12, 0))
        add_cyl(f"CBackR_{side}", 0.014, 0.42, (bx, 0.15, 0.66), iron, verts=8, rot=(0, side * 0.12, 0))
        add_box(f"CBackTop_{side}", (0.025, 0.34, 0.06), (bx + side * 0.025, 0, 0.85), rattan, rot=(0, side * 0.12, 0), bevel_width=0.008)
        add_box(f"CBackMid_{side}", (0.022, 0.32, 0.035), (bx + side * 0.012, 0, 0.68), iron)

    # Central parasol pole + brass collar + 10-panel scalloped striped canopy!
    add_cyl("ParasolPole", 0.028, 2.60, (0, 0, 1.32), wood, verts=12)
    add_cyl("ParasolCollar", 0.038, 0.10, (0, 0, 1.65), brass, verts=12)
    add_cyl("ParasolFinial", 0.038, 0.14, (0, 0, 2.68), brass, verts=10, r2=0.010)

    n_panels = 10
    radius = 1.56
    apex_z = 2.62
    mid_z = 2.46
    rim_z = 2.14
    for i in range(n_panels):
        a0 = (i / n_panels) * math.pi * 2
        a1 = ((i + 1) / n_panels) * math.pi * 2
        mesh = bpy.data.meshes.new(f"CPanel_{i}")
        obj = bpy.data.objects.new(f"CPanel_{i}", mesh)
        bpy.context.collection.objects.link(obj)
        bm = bmesh.new()
        v_top = bm.verts.new((0, 0, apex_z))
        v_m0 = bm.verts.new((math.cos(a0) * radius * 0.55, math.sin(a0) * radius * 0.55, mid_z))
        v_m1 = bm.verts.new((math.cos(a1) * radius * 0.55, math.sin(a1) * radius * 0.55, mid_z))
        v_r0 = bm.verts.new((math.cos(a0) * radius, math.sin(a0) * radius, rim_z))
        v_r1 = bm.verts.new((math.cos(a1) * radius, math.sin(a1) * radius, rim_z))
        v_f0 = bm.verts.new((math.cos(a0) * radius * 1.01, math.sin(a0) * radius * 1.01, rim_z - 0.10))
        v_f1 = bm.verts.new((math.cos(a1) * radius * 1.01, math.sin(a1) * radius * 1.01, rim_z - 0.10))
        bm.faces.new((v_top, v_m0, v_m1))
        bm.faces.new((v_m0, v_r0, v_r1, v_m1))
        bm.faces.new((v_r0, v_f0, v_f1, v_r1))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        obj.data.materials.append(tint if i % 2 == 0 else white)

    export_glb("prop_sidewalk_cafe.glb")


# ─── 5. ART DECO CAST-IRON STREETLAMP (ARM EXTENDS -Y IN BLENDER -> +Z GLTF) ─
def build_street_lamp():
    clear_scene()
    iron = make_mat("LampIron", (0.14, 0.18, 0.24), roughness=0.32, metallic=0.84)
    brass = make_mat("LampBrass", (0.86, 0.69, 0.30), roughness=0.26, metallic=0.90)
    glow = make_mat("LampGlow", (1.0, 0.92, 0.74), roughness=0.14, emission=(1.0, 0.85, 0.52), emission_strength=2.0)

    # Stepped octagonal cast-iron pedestal base (z = 0..1.18m)
    add_cyl("BaseFoot", 0.26, 0.18, (0, 0, 0.09), iron, verts=8, smooth=False)
    add_cyl("BasePedestal", 0.22, 0.82, (0, 0, 0.58), iron, verts=8, smooth=False, r2=0.16)
    add_cyl("BaseCollar", 0.185, 0.12, (0, 0, 1.05), brass, verts=12)

    # Tapered fluted cast-iron column rising to 6.85m
    add_cyl("MainPost", 0.14, 5.75, (0, 0, 3.98), iron, verts=12, r2=0.085)
    add_cyl("MidRing", 0.13, 0.08, (0, 0, 4.20), brass, verts=12)
    add_cyl("TopCollar", 0.125, 0.14, (0, 0, 6.80), brass, verts=12)
    add_cyl("TopFinial", 0.08, 0.34, (0, 0, 7.04), iron, verts=10, r2=0.012)

    # Curved cantilevered bracket arm extending along -Y (which is +Z in glTF!) to y = -1.36m
    arm_pts = [
        (0.0, -0.18, 6.62, 0.055, 0.36, 0.25),
        (0.0, -0.56, 6.76, 0.048, 0.44, 0.12),
        (0.0, -0.98, 6.82, 0.042, 0.44, -0.05),
        (0.0, -1.28, 6.76, 0.038, 0.28, -0.35),
    ]
    for i, (ax, ay, az, r, length, pitch) in enumerate(arm_pts):
        add_cyl(f"ArmSeg_{i}", r, length, (ax, ay, az), iron, verts=10, rot=(math.pi * 0.5 - pitch, 0, 0))

    # Decorative Art Deco diagonal scroll brace under arm
    add_cyl("ScrollStrut", 0.025, 0.92, (0, -0.44, 6.26), brass, verts=8, rot=(0.78, 0, 0))
    add_torus("ScrollRing", 0.13, 0.018, (0, -0.28, 6.46), brass, rot=(0, math.pi * 0.5, 0))

    # Hanging Art Deco octagonal lantern hood + glowing diffuser centered at (0, -1.36, 6.50)
    add_cyl("LanternCap", 0.26, 0.14, (0, -1.36, 6.69), iron, verts=8, smooth=False, r2=0.07)
    add_cyl("LanternTrim", 0.28, 0.04, (0, -1.36, 6.61), brass, verts=8, smooth=False)
    add_cyl("LanternGlass", 0.21, 0.30, (0, -1.36, 6.45), glow, verts=8, smooth=False, r2=0.14)
    add_cyl("LanternFinial", 0.12, 0.09, (0, -1.36, 6.26), iron, verts=8, smooth=False, r2=0.018)

    export_glb("prop_street_lamp.glb", center_xy=False)


# ─── 6. MUNICIPAL TRAFFIC SIGNAL GANTRY (MAST ARM ALONG +X, LENSES ±Y->±Z) ──
def build_traffic_signal():
    clear_scene()
    steel = make_mat("SignalSteel", (0.18, 0.22, 0.28), roughness=0.34, metallic=0.84)
    housing = make_mat("SignalHousing", (0.09, 0.10, 0.12), roughness=0.45, metallic=0.40)
    sign_bg = make_mat("StreetSignGreen", (0.04, 0.36, 0.22), roughness=0.42)
    sign_trim = make_mat("StreetSignWhite", (0.94, 0.95, 0.96), roughness=0.38)
    red = make_mat("SigRed", (0.20, 0.03, 0.03), roughness=0.18, emission=(1.0, 0.12, 0.18), emission_strength=0.2)
    amber = make_mat("SigAmber", (0.20, 0.14, 0.02), roughness=0.18, emission=(1.0, 0.72, 0.02), emission_strength=0.1)
    green = make_mat("SigGreen", (0.02, 0.20, 0.09), roughness=0.18, emission=(0.13, 1.0, 0.47), emission_strength=2.2)

    # Bolted octagonal steel gantry base + tapered vertical pole (h = 6.5m)
    add_cyl("BaseFlange", 0.32, 0.10, (0, 0, 0.05), steel, verts=8, smooth=False)
    add_cyl("BaseCollar", 0.24, 0.55, (0, 0, 0.36), steel, verts=12, r2=0.20)
    add_cyl("MainPole", 0.19, 6.05, (0, 0, 3.55), steel, verts=12, r2=0.13)
    add_cyl("PoleCap", 0.15, 0.14, (0, 0, 6.62), steel, verts=12, r2=0.06)

    # Pedestrian crossing signal & control cabinet mounted on pole
    add_box("ControlBox", (0.24, 0.30, 0.44), (-0.22, 0, 1.65), steel, bevel_width=0.015)
    add_box("PedHead", (0.26, 0.22, 0.34), (0.26, 0, 3.05), housing, bevel_width=0.015)

    # Tapered horizontal cantilever mast arm extending +X (x = 0..7.5m, z = 6.12m)
    add_box("ArmBracket", (0.42, 0.32, 0.46), (0.24, 0, 6.08), steel, bevel_width=0.02)
    add_cyl("MastArm", 0.12, 7.45, (3.80, 0, 6.12), steel, verts=12, rot=(0, math.pi * 0.5, 0), r2=0.075)
    add_box("ArmGusset", (1.25, 0.09, 0.14), (0.68, 0, 5.72), steel, rot=(0, -0.45, 0))

    # Miami emerald green avenue sign blade on the mast arm
    add_box("SignTrim", (2.16, 0.05, 0.46), (2.75, 0, 6.12), sign_trim)
    add_box("SignFace", (2.06, 0.06, 0.38), (2.75, 0, 6.12), sign_bg)

    # Hanging dual-sided 3-lens signal head at x = 5.40m, z = 5.72m (lenses face +Y and -Y -> -Z and +Z in glTF)
    hx = 5.40
    add_cyl("HangerPipe", 0.04, 0.40, (hx, 0, 6.20), steel, verts=8)
    add_box("HeadBackplate", (0.62, 0.06, 1.38), (hx, 0, 5.72), housing, bevel_width=0.012)
    add_box("HeadBody", (0.46, 0.34, 1.24), (hx, 0, 5.72), housing, bevel_width=0.02)

    # 3 lenses + curved glare visors on both front (-Y) and rear (+Y) faces
    lens_specs = [(6.08, red, "R"), (5.72, amber, "A"), (5.36, green, "G")]
    for lz, lmat, tag in lens_specs:
        for sy in (-1, 1):
            add_sphere(f"Lens_{tag}_{sy}", 0.115, (hx, sy * 0.17, lz), lmat, segs=12, rings=8, scale=(1.0, 0.45, 1.0))
            # Hood visor projecting above lens
            add_box(f"VisorTop_{tag}_{sy}", (0.28, 0.22, 0.025), (hx, sy * 0.26, lz + 0.125), housing, rot=(sy * 0.18, 0, 0))
            for vx in (-0.135, 0.135):
                add_box(f"VisorSide_{tag}_{sy}_{vx}", (0.022, 0.16, 0.14), (hx + vx, sy * 0.24, lz + 0.05), housing)

    export_glb("prop_traffic_signal.glb", center_xy=False)


# ─── 7. FLUTED ART DECO CAST-IRON COASTAL BOLLARD (0.84m TALL) ──────────────
def build_bollard():
    clear_scene()
    iron = make_mat("BollardIron", (0.14, 0.17, 0.22), roughness=0.35, metallic=0.84)
    brass = make_mat("BollardBrass", (0.88, 0.70, 0.30), roughness=0.22, metallic=0.92)

    add_cyl("BasePlate", 0.135, 0.045, (0, 0, 0.0225), iron, verts=8, smooth=False)
    add_cyl("BaseMould", 0.115, 0.09, (0, 0, 0.085), iron, verts=12, r2=0.095)
    add_cyl("ShaftLow", 0.094, 0.46, (0, 0, 0.36), iron, verts=12, r2=0.086)
    add_cyl("BrassBand", 0.092, 0.055, (0, 0, 0.615), brass, verts=14)
    add_cyl("ShaftTop", 0.088, 0.11, (0, 0, 0.695), iron, verts=12, r2=0.084)
    add_torus("CapRing", 0.088, 0.014, (0, 0, 0.748), brass, major_segs=14, minor_segs=6)
    add_sphere("DomeCap", 0.085, (0, 0, 0.755), brass, segs=14, rings=8, scale=(1.0, 1.0, 0.95))

    export_glb("prop_bollard.glb")


if __name__ == "__main__":
    build_park_bench()
    build_fire_hydrant()
    build_bougainvillea_planter()
    build_sidewalk_cafe()
    build_street_lamp()
    build_traffic_signal()
    build_bollard()
    print("All 7 bespoke Blender Street Furniture GLBs exported cleanly!")
