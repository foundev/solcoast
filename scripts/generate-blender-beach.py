"""
Generates 5 bespoke Blender 5.2 Beach, Pier & Park Recreation GLBs for Sol Coast (Sweep Batch 2):
  1. prop_lifeguard_tower.glb    — Iconic Miami Beach Art Deco stilt lifeguard tower (stairs, shutters, buoy, rescue board)
  2. prop_beach_umbrella.glb     — Striped scalloped coastal beach parasol with hardwood pole & visible ribs
  3. prop_beach_lounger.glb      — Resort slatted sun lounger with contoured cushion, rolled pillow & wheels
  4. prop_basketball_hoop.glb    — Coral Park pro basketball stanchion, tempered glass backboard, rim & net
  5. prop_lighthouse_pavilion.glb— South Pier Art Deco octagonal lighthouse tower, gallery deck & copper cupola

Run:
  blender --background --python scripts/generate-blender-beach.py
"""
import math
import os
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
        bsdf.inputs["Coat Roughness"].default_value = 0.06
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


def add_torus(name, major_r, minor_r, loc, mat, rot=(0, 0, 0), major_segs=24, minor_segs=10):
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
    print(f"[blender-beach] {filename}: {sz:.1f} KB")


# ─── 1. ICONIC MIAMI SOUTH BEACH ART DECO LIFEGUARD TOWER ───────────────────
# Faces -Y in Blender -> +Z in glTF
def build_lifeguard_tower():
    clear_scene()
    timber = make_mat("TowerTimber", (0.52, 0.36, 0.22), roughness=0.78)
    white = make_mat("TowerWhite", (0.96, 0.95, 0.92), roughness=0.45)
    body_tint = make_mat("TintBody", (0.96, 0.45, 0.62), roughness=0.42)
    accent = make_mat("TowerAccent", (0.16, 0.78, 0.86), roughness=0.38)
    glass = make_mat("TowerGlass", (0.08, 0.18, 0.28), roughness=0.06, metallic=0.2, coat=1.0)
    red_buoy = make_mat("BuoyRed", (0.92, 0.16, 0.16), roughness=0.35, coat=0.5)
    orange_board = make_mat("RescueOrange", (0.98, 0.44, 0.08), roughness=0.22, coat=0.9)
    metal = make_mat("TowerMetal", (0.78, 0.82, 0.86), roughness=0.26, metallic=0.88)

    # 4 heavy timber pilings + diagonal X cross-bracing
    for lx in (-1.22, 1.22):
        for ly in (-1.22, 1.22):
            add_box(f"Stilt_{lx}_{ly}", (0.22, 0.22, 2.35), (lx, ly, 1.175), timber, bevel_width=0.015)
    # Cross braces on sides & back
    for sx in (-1.22, 1.22):
        add_box(f"BraceX1_{sx}", (0.08, 2.9, 0.12), (sx, 0, 1.15), timber, rot=(0.68, 0, 0))
        add_box(f"BraceX2_{sx}", (0.08, 2.9, 0.12), (sx, 0, 1.15), timber, rot=(-0.68, 0, 0))
    add_box("BraceBack1", (2.9, 0.08, 0.12), (0, 1.22, 1.15), timber, rot=(0, 0.68, 0))
    add_box("BraceBack2", (2.9, 0.08, 0.12), (0, 1.22, 1.15), timber, rot=(0, -0.68, 0))

    # Elevated planked observation deck + wrap-around white Art Deco safety railings
    add_box("DeckBase", (3.7, 3.7, 0.20), (0, 0, 2.32), timber, bevel_width=0.02)
    for rx in (-1.74, 0, 1.74):
        for ry in (-1.74, 1.74):
            if rx == 0 and ry > 0:
                continue  # Stair entry opening at back (+Y)
            add_box(f"RPost_{rx}_{ry}", (0.09, 0.09, 0.96), (rx, ry, 2.88), white)
    add_box("RailFrontTop", (3.58, 0.10, 0.08), (0, -1.74, 3.34), white)
    add_box("RailFrontMid", (3.58, 0.07, 0.06), (0, -1.74, 2.92), white)
    for sx in (-1.74, 1.74):
        add_box(f"RailSideTop_{sx}", (0.10, 3.58, 0.08), (sx, 0, 3.34), white)
        add_box(f"RailSideMid_{sx}", (0.07, 3.58, 0.06), (sx, 0, 2.92), white)

    # Rear timber access stairs (+Y side) with treads & side stringers
    for sx in (-0.52, 0.52):
        add_box(f"Stringer_{sx}", (0.09, 2.55, 0.22), (sx, 2.35, 1.16), timber, rot=(0.82, 0, 0))
        add_box(f"StairHandrail_{sx}", (0.06, 2.55, 0.06), (sx, 2.35, 2.02), white, rot=(0.82, 0, 0))
    for st in range(7):
        t = (st + 0.5) / 7.0
        add_box(f"Step_{st}", (1.02, 0.28, 0.06), (0, 3.25 - t * 1.65, t * 2.25), timber)

    # Painted Art Deco Lifeguard Cabin + white horizontal speed-stripes + dark observation windows
    add_box("CabinBody", (2.45, 2.45, 2.15), (0, 0, 3.48), body_tint, bevel_width=0.03)
    add_box("CabinTrimBot", (2.56, 2.56, 0.14), (0, 0, 2.55), white)
    add_box("CabinStripe", (2.54, 2.54, 0.12), (0, 0, 3.12), accent)
    add_box("CabinWinFront", (1.88, 0.12, 0.84), (0, -1.21, 3.82), glass)
    for sx in (-1.21, 1.21):
        add_box(f"CabinWinSide_{sx}", (0.12, 1.68, 0.84), (sx, 0, 3.82), glass)

    # Propped-open louvered storm shutters shielding the front & side windows!
    add_box("ShutterFront", (2.02, 0.86, 0.06), (0, -1.60, 4.38), white, rot=(0.48, 0, 0))
    for sx in (-1, 1):
        add_box(f"ShutterSide_{sx}", (0.82, 1.82, 0.06), (sx * 1.56, 0, 4.38), white, rot=(0, -sx * 0.48, 0))

    # Overhanging sloped coastal hip roof + white fascia + flagpole & surf warning flag
    add_box("RoofFascia", (3.25, 3.25, 0.18), (0, 0, 4.64), white, bevel_width=0.02)
    add_cyl("RoofHip", 2.28, 1.05, (0, 0, 5.22), accent, verts=4, rot=(0, 0, math.pi * 0.25), smooth=False, r2=0.18)
    add_cyl("FlagPole", 0.025, 1.45, (0, 0, 5.95), metal, verts=10)
    add_box("SurfFlag", (0.68, 0.03, 0.36), (0.34, 0, 6.42), red_buoy)

    # Red-and-white life ring buoy mounted to front rail + orange rescue paddleboard leaning on stilts!
    add_torus("LifeBuoy", 0.30, 0.075, (-0.85, -1.82, 2.95), red_buoy, rot=(math.pi * 0.5, 0, 0))
    for a in range(4):
        ang = a * math.pi * 0.5
        add_box(f"BuoyBand_{a}", (0.12, 0.16, 0.16), (-0.85 + math.cos(ang) * 0.30, -1.82, 2.95 + math.sin(ang) * 0.30), white)
    add_box("RescueBoard", (0.48, 0.09, 2.15), (1.38, -0.82, 1.08), orange_board, rot=(0.18, 0.12, 0.4), bevel_width=0.04)

    export_glb("prop_lifeguard_tower.glb", center_xy=False)


# ─── 2. SCALLOPED STRIPED BEACH PARASOL UMBRELLA ────────────────────────────
def build_beach_umbrella():
    clear_scene()
    wood = make_mat("UmbWood", (0.56, 0.36, 0.18), roughness=0.45)
    brass = make_mat("UmbBrass", (0.90, 0.72, 0.30), roughness=0.20, metallic=0.92)
    tint = make_mat("TintCanopy", (0.98, 0.36, 0.56), roughness=0.72)
    white = make_mat("UmbWhite", (0.98, 0.97, 0.95), roughness=0.72)

    # Turned wooden pole + brass sleeve collar + finial
    add_cyl("Pole", 0.032, 2.75, (0, 0, 1.375), wood, verts=12)
    add_cyl("Collar", 0.042, 0.12, (0, 0, 1.45), brass, verts=12)
    add_cyl("Hub", 0.068, 0.08, (0, 0, 2.28), wood, verts=12)
    add_cyl("Finial", 0.045, 0.16, (0, 0, 2.86), wood, verts=12, r2=0.012)

    # 12-panel arched scalloped canopy with alternating color & white stripes + interior ribs!
    n_panels = 12
    radius = 1.88
    apex_z = 2.78
    mid_z = 2.58
    rim_z = 2.18
    for i in range(n_panels):
        a0 = (i / n_panels) * math.pi * 2
        a1 = ((i + 1) / n_panels) * math.pi * 2
        mesh = bpy.data.meshes.new(f"Panel_{i}")
        obj = bpy.data.objects.new(f"Panel_{i}", mesh)
        bpy.context.collection.objects.link(obj)
        bm = bmesh.new()
        v_top = bm.verts.new((0, 0, apex_z))
        v_m0 = bm.verts.new((math.cos(a0) * radius * 0.55, math.sin(a0) * radius * 0.55, mid_z))
        v_m1 = bm.verts.new((math.cos(a1) * radius * 0.55, math.sin(a1) * radius * 0.55, mid_z))
        v_r0 = bm.verts.new((math.cos(a0) * radius, math.sin(a0) * radius, rim_z))
        v_r1 = bm.verts.new((math.cos(a1) * radius, math.sin(a1) * radius, rim_z))
        # Subtle valance flap hanging down 10cm around rim
        v_f0 = bm.verts.new((math.cos(a0) * radius * 1.01, math.sin(a0) * radius * 1.01, rim_z - 0.11))
        v_f1 = bm.verts.new((math.cos(a1) * radius * 1.01, math.sin(a1) * radius * 1.01, rim_z - 0.11))
        bm.faces.new((v_top, v_m0, v_m1))
        bm.faces.new((v_m0, v_r0, v_r1, v_m1))
        bm.faces.new((v_r0, v_f0, v_f1, v_r1))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        obj.data.materials.append(tint if i % 2 == 0 else white)
        # Underside wooden strut rib tucked cleanly beneath the striped canopy
        rx = math.cos(a0) * radius * 0.44
        ry = math.sin(a0) * radius * 0.44
        add_cyl(f"Rib_{i}", 0.011, radius * 0.84, (rx, ry, 2.34), wood, verts=6, rot=(0, 1.44, a0))

    export_glb("prop_beach_umbrella.glb")


# ─── 3. RESORT SLATTED SUN LOUNGER WITH CUSHION & PILLOW ────────────────────
def build_beach_lounger():
    clear_scene()
    frame = make_mat("LoungerFrame", (0.94, 0.94, 0.92), roughness=0.32, coat=0.4)
    teak = make_mat("LoungerTeak", (0.56, 0.35, 0.18), roughness=0.55)
    towel = make_mat("TintTowel", (0.14, 0.82, 0.92), roughness=0.86)
    pillow = make_mat("LoungerPillow", (0.98, 0.97, 0.95), roughness=0.84)
    wheel = make_mat("LoungerWheel", (0.14, 0.15, 0.17), roughness=0.65)

    # Sleek aluminum & teak side rails + 4 legs + rear beach rolling wheels
    for sx in (-0.36, 0.36):
        add_box(f"SideRail_{sx}", (0.05, 1.88, 0.065), (sx, 0, 0.28), frame, bevel_width=0.01)
        add_box(f"FrontLeg_{sx}", (0.05, 0.06, 0.28), (sx, 0.82, 0.14), frame, bevel_width=0.008)
        add_box(f"MidLeg_{sx}", (0.05, 0.06, 0.28), (sx, -0.08, 0.14), frame, bevel_width=0.008)
        add_box(f"RearLeg_{sx}", (0.05, 0.06, 0.24), (sx, -0.82, 0.16), frame, bevel_width=0.008)
        add_cyl(f"Wheel_{sx}", 0.09, 0.04, (sx * 1.08, -0.84, 0.09), wheel, verts=14, rot=(0, math.pi * 0.5, 0))
        # Curved teak armrests
        add_box(f"Arm_{sx}", (0.055, 0.62, 0.035), (sx * 1.06, -0.18, 0.49), teak, bevel_width=0.008)
        add_box(f"ArmPostF_{sx}", (0.04, 0.04, 0.21), (sx * 1.04, 0.08, 0.38), frame)
        add_box(f"ArmPostR_{sx}", (0.04, 0.04, 0.21), (sx * 1.04, -0.44, 0.38), frame)

    # Teak cross slats beneath cushion
    for i in range(9):
        sy = -0.78 + i * 0.195
        add_box(f"Slat_{i}", (0.68, 0.11, 0.028), (0, sy, 0.29), teak)

    # Thick plush contoured resort cushion + angled reclining backrest + bolster pillow!
    add_box("SeatCushion", (0.68, 1.24, 0.09), (0, 0.28, 0.35), towel, bevel_width=0.025)
    add_box("BackCushion", (0.68, 0.66, 0.09), (0, -0.58, 0.52), towel, rot=(-0.54, 0, 0), bevel_width=0.025)
    add_box("BackStrut", (0.52, 0.04, 0.38), (0, -0.68, 0.40), frame, rot=(0.45, 0, 0))
    add_cyl("HeadPillow", 0.068, 0.56, (0, -0.74, 0.68), pillow, verts=16, rot=(0, math.pi * 0.5, 0))

    export_glb("prop_beach_lounger.glb")


# ─── 4. PRO OUTDOOR BASKETBALL HOOP (CORAL PARK) ────────────────────────────
# Faces -Y in Blender -> +Z in glTF
def build_basketball_hoop():
    clear_scene()
    steel = make_mat("HoopSteel", (0.12, 0.15, 0.20), roughness=0.32, metallic=0.82)
    pad = make_mat("HoopPad", (0.08, 0.42, 0.52), roughness=0.68)
    concrete = make_mat("HoopBase", (0.76, 0.75, 0.72), roughness=0.85)
    glass = make_mat("BackboardGlass", (0.88, 0.95, 1.0), roughness=0.05, alpha=0.40, coat=1.0)
    white = make_mat("BackboardLines", (0.98, 0.98, 0.98), roughness=0.4)
    orange = make_mat("RimOrange", (0.96, 0.32, 0.06), roughness=0.25, metallic=0.65)
    net_mat = make_mat("NetWhite", (0.94, 0.94, 0.92), roughness=0.78)

    # Bolted concrete pedestal + heavy square powder-coated steel post + protective foam pad
    add_box("BasePlinth", (0.58, 0.58, 0.24), (0, 0, 0.12), concrete, bevel_width=0.02)
    add_box("SteelPost", (0.18, 0.18, 3.65), (0, 0, 1.825), steel, bevel_width=0.015)
    add_box("SafetyPad", (0.26, 0.26, 1.75), (0, 0, 1.12), pad, bevel_width=0.03)

    # Angled gooseneck extension arm & gusset brace extending forward (-Y) toward court
    add_box("ExtArm", (0.14, 1.02, 0.14), (0, -0.46, 3.45), steel, rot=(-0.22, 0, 0), bevel_width=0.01)
    add_box("Gusset", (0.10, 0.72, 0.10), (0, -0.34, 3.12), steel, rot=(-0.65, 0, 0))
    add_box("BackMount", (0.72, 0.08, 0.42), (0, -0.88, 3.45), steel)

    # Tempered glass backboard + aluminum perimeter frame + crisp painted shooter's square!
    by = -0.94
    bz = 3.55
    add_box("GlassBoard", (1.82, 0.035, 1.10), (0, by, bz), glass)
    add_box("FrameTop", (1.88, 0.06, 0.05), (0, by, bz + 0.56), white)
    add_box("FrameBot", (1.88, 0.06, 0.05), (0, by, bz - 0.56), white)
    for sx in (-0.92, 0.92):
        add_box(f"FrameSide_{sx}", (0.05, 0.06, 1.14), (sx, by, bz), white)
    # Shooter's box above rim
    add_box("SqTop", (0.60, 0.045, 0.03), (0, by - 0.005, 3.48), white)
    add_box("SqBot", (0.60, 0.045, 0.03), (0, by - 0.005, 3.06), white)
    for sx in (-0.285, 0.285):
        add_box(f"SqSide_{sx}", (0.03, 0.045, 0.45), (sx, by - 0.005, 3.27), white)

    # Breakaway orange steel rim + mounting plate + tapered braided net
    add_box("RimBracket", (0.14, 0.12, 0.12), (0, by - 0.07, 3.05), orange)
    add_torus("Rim", 0.24, 0.022, (0, by - 0.34, 3.05), orange)
    # 12 diagonal net cords forming an authentic tapered basketball net!
    for i in range(12):
        a = (i / 12) * math.pi * 2
        nx = math.cos(a) * 0.19
        ny = by - 0.34 + math.sin(a) * 0.19
        add_cyl(f"NetCord_{i}", 0.008, 0.44, (nx * 0.82, by - 0.34 + math.sin(a) * 0.16, 2.83), net_mat, verts=6, rot=(math.sin(a) * 0.18, -math.cos(a) * 0.18, 0))
    add_torus("NetMidRing", 0.16, 0.009, (0, by - 0.34, 2.74), net_mat)

    export_glb("prop_basketball_hoop.glb", center_xy=False)


# ─── 5. SOUTH PIER ART DECO COASTAL LIGHTHOUSE PAVILION ─────────────────────
def build_lighthouse_pavilion():
    clear_scene()
    stone = make_mat("LHStone", (0.94, 0.90, 0.84), roughness=0.68)
    white = make_mat("LHWhite", (0.97, 0.96, 0.94), roughness=0.42)
    coral = make_mat("LHCoral", (0.96, 0.36, 0.56), roughness=0.38)
    brass = make_mat("LHBrass", (0.90, 0.72, 0.30), roughness=0.20, metallic=0.94)
    copper = make_mat("LHCopper", (0.24, 0.62, 0.54), roughness=0.35, metallic=0.68)
    iron = make_mat("LHIron", (0.14, 0.17, 0.22), roughness=0.35, metallic=0.82)
    glass = make_mat("LHGlass", (0.85, 0.96, 1.0), roughness=0.05, alpha=0.45, coat=1.0)
    beacon = make_mat("LHBeaconGlow", (1.0, 0.88, 0.48), roughness=0.1, emission=(1.0, 0.84, 0.38), emission_strength=3.6)

    # Stepped octagonal limestone pavilion base (6.8m diameter)
    add_cyl("BaseStep1", 3.45, 0.42, (0, 0, 0.21), stone, verts=8, smooth=False)
    add_cyl("BaseStep2", 3.05, 0.36, (0, 0, 0.60), stone, verts=8, smooth=False)
    add_cyl("BaseDrum", 2.75, 2.60, (0, 0, 2.08), white, verts=8, smooth=False)
    add_cyl("BaseCornice", 2.95, 0.28, (0, 0, 3.46), coral, verts=8, smooth=False)

    # Brass-framed coastal entrance portal on -X face (facing pier approach!)
    add_box("DoorFrame", (0.35, 1.55, 2.35), (-2.65, 0, 1.95), brass, bevel_width=0.02)
    add_box("DoorLeaf", (0.38, 1.32, 2.18), (-2.68, 0, 1.88), iron)
    add_box("DoorPediment", (0.55, 1.85, 0.24), (-2.72, 0, 3.22), coral)

    # Tapered cylindrical lighthouse shaft with signature Miami coral-pink Art Deco bands!
    add_cyl("TowerShaft", 2.35, 7.60, (0, 0, 7.35), white, verts=24, r2=1.68)
    add_cyl("CoralBand1", 2.16, 0.55, (0, 0, 5.80), coral, verts=24, r2=2.10)
    add_cyl("CoralBand2", 1.94, 0.55, (0, 0, 8.60), coral, verts=24, r2=1.88)

    # Brass-rimmed porthole windows rising up the tower
    for pz, ang in [(5.2, 0), (7.2, math.pi * 0.5), (9.2, math.pi), (7.2, -math.pi * 0.5)]:
        r = 2.05 - (pz - 5.2) * 0.08
        add_cyl(f"PortholeRim_{pz}_{ang}", 0.32, 0.22, (math.cos(ang) * r, math.sin(ang) * r, pz), brass, verts=16, rot=(0, math.pi * 0.5, ang))
        add_cyl(f"PortholeGlass_{pz}_{ang}", 0.24, 0.25, (math.cos(ang) * r, math.sin(ang) * r, pz), glass, verts=14, rot=(0, math.pi * 0.5, ang))

    # Cantilevered observation gallery deck + wrought-iron circular railing!
    add_cyl("GalleryCorbel", 1.72, 0.55, (0, 0, 11.35), stone, verts=20, r2=2.55)
    add_cyl("GalleryDeck", 2.60, 0.22, (0, 0, 11.72), stone, verts=20)
    add_torus("GalleryRailTop", 2.48, 0.045, (0, 0, 12.78), iron)
    add_torus("GalleryRailMid", 2.48, 0.032, (0, 0, 12.30), iron)
    for i in range(16):
        a = (i / 16) * math.pi * 2
        add_cyl(f"RailPost_{i}", 0.03, 0.96, (math.cos(a) * 2.48, math.sin(a) * 2.48, 12.30), iron, verts=8)

    # Glass lantern room + brass mullions + glowing Fresnel beacon lens + patinated copper cupola dome!
    add_cyl("LanternBase", 1.48, 0.52, (0, 0, 12.08), white, verts=16)
    add_cyl("LanternGlass", 1.38, 1.85, (0, 0, 13.22), glass, verts=16)
    add_cyl("FresnelLens", 0.68, 1.15, (0, 0, 13.25), beacon, verts=16)
    for i in range(8):
        a = (i / 8) * math.pi * 2
        add_cyl(f"Mullion_{i}", 0.035, 1.92, (math.cos(a) * 1.41, math.sin(a) * 1.41, 13.22), brass, verts=8)
    add_cyl("CupolaRim", 1.62, 0.22, (0, 0, 14.22), copper, verts=16)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.45, location=(0, 0, 14.30), segments=20, ring_count=12)
    dome = bpy.context.active_object
    dome.name = "CupolaDome"
    dome.scale = (1.0, 1.0, 0.72)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    dome.data.materials.append(copper)
    add_cyl("Spire", 0.06, 1.35, (0, 0, 15.80), brass, verts=10, r2=0.012)

    export_glb("prop_lighthouse_pavilion.glb")


if __name__ == "__main__":
    build_lifeguard_tower()
    build_beach_umbrella()
    build_beach_lounger()
    build_basketball_hoop()
    build_lighthouse_pavilion()
    print("All 5 bespoke Blender Beach, Pier & Park GLBs exported cleanly!")
