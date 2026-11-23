"""
Generates 3 bespoke Blender 5.2 luxury hotel architectural fixture GLBs for Hotel Solaire:
  1. hotel_elevator_doors.glb — Ornate brushed-brass Art Deco elevator portal with chevron doors, dial & call panel
  2. hotel_soaking_tub.glb    — Sculpted curved porcelain freestanding spa soaking tub with brass floor faucet
  3. hotel_vanity_sink.glb    — Marble & walnut hotel bathroom double-basin vanity with backlit mirror & brass faucets

Run:
  blender --background --python scripts/generate-blender-hotel.py
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


def make_mat(name, base_color, roughness=0.4, metallic=0.0, emission=None, emission_strength=0.0, coat=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name=name)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if coat > 0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.05
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


def add_cyl(name, r1, depth, loc, mat, verts=20, rot=(0, 0, 0), smooth=True, r2=None):
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


def add_torus(name, major_r, minor_r, loc, mat, rot=(0, 0, 0), major_segs=28, minor_segs=10):
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


def export_glb(filename):
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
    cx = (min_x + max_x) * 0.5
    cy = (min_y + max_y) * 0.5
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
    print(f"[blender-hotel] {filename}: {sz:.1f} KB")


# ─── 1. ART DECO BRASS ELEVATOR DOORS & FLOOR INDICATOR DIAL ────────────────
# Faces -Y in Blender -> +Z in glTF
def build_hotel_elevator_doors():
    clear_scene()
    marble = make_mat("ElevMarble", (0.16, 0.14, 0.16), roughness=0.18, coat=0.7)
    brass = make_mat("ElevBrass", (0.88, 0.70, 0.30), roughness=0.20, metallic=0.95)
    bronze = make_mat("ElevBronze", (0.42, 0.30, 0.14), roughness=0.26, metallic=0.88)
    warm_glow = make_mat("ElevDialGlow", (1.0, 0.85, 0.45), roughness=0.1, emission=(1.0, 0.82, 0.38), emission_strength=3.2)
    green_btn = make_mat("ElevCallGlow", (0.25, 0.96, 0.72), roughness=0.1, emission=(0.25, 0.96, 0.72), emission_strength=3.5)

    # Stepped black-marble surround portal (2.6m wide x 3.2m tall)
    add_box("SurroundL", (0.42, 0.30, 3.05), (-1.12, 0, 1.525), marble, bevel_width=0.025)
    add_box("SurroundR", (0.42, 0.30, 3.05), (1.12, 0, 1.525), marble, bevel_width=0.025)
    add_box("SurroundTop", (2.75, 0.34, 0.62), (0, 0, 2.95), marble, bevel_width=0.03)

    # Twin gleaming brushed-brass sliding elevator door leaves with Art Deco chevron ribs!
    for sx in (-0.46, 0.46):
        add_box(f"DoorLeaf_{sx}", (0.88, 0.10, 2.60), (sx, 0.04, 1.30), brass, bevel_width=0.012)
        # Decorative bronze Art Deco vertical & chevron trim bars
        add_box(f"DoorTrimV_{sx}", (0.06, 0.04, 2.20), (sx, -0.02, 1.32), bronze)
        for cz in (0.75, 1.35, 1.95):
            add_box(f"ChevL_{sx}_{cz}", (0.34, 0.035, 0.045), (sx - 0.12, -0.025, cz), bronze, rot=(0, 0.42, 0))
            add_box(f"ChevR_{sx}_{cz}", (0.34, 0.035, 0.045), (sx + 0.12, -0.025, cz), bronze, rot=(0, -0.42, 0))

    # Semicircular Art Deco Mechanical Floor Dial above the doors!
    add_cyl("DialBacking", 0.38, 0.08, (0, -0.17, 2.86), bronze, verts=24, rot=(math.pi * 0.5, 0, 0))
    add_cyl("DialFace", 0.31, 0.05, (0, -0.20, 2.86), warm_glow, verts=24, rot=(math.pi * 0.5, 0, 0))
    add_box("DialNeedle", (0.035, 0.04, 0.28), (0.04, -0.23, 2.94), marble, rot=(0, -0.35, 0))
    add_box("DialCoverBot", (0.85, 0.14, 0.36), (0, -0.18, 2.66), marble)

    # Illuminated Brass Call-Button Panel on the right jamb
    add_box("CallPlate", (0.16, 0.05, 0.38), (1.12, -0.17, 1.25), brass, bevel_width=0.01)
    add_cyl("BtnUp", 0.032, 0.04, (1.12, -0.20, 1.32), green_btn, verts=14, rot=(math.pi * 0.5, 0, 0))
    add_cyl("BtnDn", 0.032, 0.04, (1.12, -0.20, 1.18), warm_glow, verts=14, rot=(math.pi * 0.5, 0, 0))

    export_glb("hotel_elevator_doors.glb")


# ─── 2. SCULPTED FREESTANDING SPA SOAKING TUB & BRASS FAUCET ────────────────
def build_hotel_soaking_tub():
    clear_scene()
    porcelain = make_mat("TubPorcelain", (0.97, 0.96, 0.94), roughness=0.08, coat=1.0)
    brass = make_mat("TubBrass", (0.90, 0.72, 0.30), roughness=0.18, metallic=0.96)
    water = make_mat("BathWater", (0.65, 0.92, 0.95), roughness=0.04, alpha=0.68, coat=1.0)
    towel = make_mat("SpaTowel", (0.94, 0.89, 0.82), roughness=0.88)
    wood = make_mat("BathCaddy", (0.48, 0.30, 0.16), roughness=0.52)

    # Lathe-turned hollow soaking tub scaled into a graceful oval (1.85m x 0.92m x 0.64m)!
    mesh = bpy.data.meshes.new("TubShell")
    obj = bpy.data.objects.new("TubShell", mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    prof = [
        (0.02, 0.0),
        (0.42, 0.0),
        (0.48, 0.14),
        (0.52, 0.54),
        (0.54, 0.62),
        (0.48, 0.64),
        (0.44, 0.58),
        (0.40, 0.14),
        (0.02, 0.12),
    ]
    verts = [bm.verts.new((r, 0, z)) for (r, z) in prof]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.pi * 2, steps=32, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    obj.scale = (1.75, 0.86, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(porcelain)

    # Shimmering bath water + walnut bath caddy + folded white spa towel
    w_obj = add_cyl("BathWaterDisc", 0.45, 0.03, (0, 0, 0.48), water, verts=28)
    w_obj.scale = (1.62, 0.78, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_box("BathCaddy", (0.28, 0.96, 0.035), (0.12, 0, 0.65), wood, bevel_width=0.008)
    add_box("FoldedTowel", (0.22, 0.34, 0.08), (0.12, 0.14, 0.70), towel, bevel_width=0.02)

    # Floor-mounted freestanding brass gooseneck faucet
    add_cyl("FaucetBase", 0.075, 0.04, (-1.05, 0, 0.02), brass, verts=16)
    add_cyl("FaucetPipe", 0.024, 0.86, (-1.05, 0, 0.45), brass, verts=12)
    add_cyl("FaucetArm", 0.020, 0.34, (-0.90, 0, 0.86), brass, verts=12, rot=(0, math.pi * 0.5, 0))
    add_cyl("FaucetNozzle", 0.018, 0.09, (-0.75, 0, 0.81), brass, verts=12)

    export_glb("hotel_soaking_tub.glb")


# ─── 3. HOTEL MARBLE DOUBLE-BASIN BATHROOM VANITY & BACKLIT MIRROR ──────────
# Faces -Y in Blender -> +Z in glTF
def build_hotel_vanity_sink():
    clear_scene()
    walnut = make_mat("VanityWalnut", (0.30, 0.17, 0.10), roughness=0.42)
    marble = make_mat("VanityMarble", (0.95, 0.92, 0.88), roughness=0.16, coat=0.65)
    porcelain = make_mat("SinkWhite", (0.98, 0.98, 0.98), roughness=0.08, coat=1.0)
    brass = make_mat("VanityBrass", (0.90, 0.72, 0.30), roughness=0.18, metallic=0.95)
    mirror = make_mat("VanityMirror", (0.78, 0.86, 0.92), roughness=0.04, metallic=0.95, coat=1.0)
    backlight = make_mat("MirrorGlow", (1.0, 0.90, 0.72), roughness=0.1, emission=(1.0, 0.88, 0.65), emission_strength=2.6)

    # Walnut floating cabinet + brass legs + beveled marble countertop
    add_box("VanityCab", (2.05, 0.58, 0.56), (0, 0, 0.52), walnut, bevel_width=0.018)
    for lx in (-0.94, 0.94):
        for ly in (-0.22, 0.22):
            add_cyl("VLeg", 0.022, 0.26, (lx, ly, 0.13), brass, verts=10)
    add_box("VanityTop", (2.14, 0.64, 0.07), (0, 0, 0.84), marble, bevel_width=0.015)

    # Twin ceramic vessel sinks + brass gooseneck faucets
    for sx in (-0.54, 0.54):
        add_cyl(f"VesselSink_{sx}", 0.18, 0.14, (sx, -0.02, 0.94), porcelain, verts=22, r2=0.22)
        add_cyl(f"FaucetPost_{sx}", 0.016, 0.26, (sx, 0.21, 1.00), brass, verts=10)
        add_cyl(f"FaucetSpout_{sx}", 0.013, 0.18, (sx, 0.13, 1.12), brass, verts=10, rot=(math.pi * 0.5, 0, 0))
        add_box(f"DrawerPull_{sx}", (0.28, 0.03, 0.025), (sx, -0.31, 0.62), brass)

    # Large brass-framed backlit vanity mirror above sinks!
    add_box("MirrorGlowBack", (1.92, 0.04, 1.12), (0, 0.28, 1.72), backlight)
    add_box("MirrorFrame", (1.84, 0.05, 1.04), (0, 0.25, 1.72), brass, bevel_width=0.015)
    add_box("MirrorGlass", (1.76, 0.03, 0.96), (0, 0.23, 1.72), mirror)

    export_glb("hotel_vanity_sink.glb")


# ─── 4. HOUSEKEEPING MAID'S CLEANING & LINEN TROLLEY ────────────────────────
# Faces -Y in Blender -> +Z in glTF
def build_hotel_housekeeping_cart():
    clear_scene()
    steel = make_mat("CartSteel", (0.16, 0.17, 0.20), roughness=0.35, metallic=0.82)
    walnut = make_mat("CartWood", (0.34, 0.20, 0.12), roughness=0.45)
    towel_w = make_mat("CleanTowel", (0.96, 0.95, 0.93), roughness=0.88)
    linen_b = make_mat("LaundryBag", (0.14, 0.28, 0.48), roughness=0.82)
    chrome = make_mat("CartChrome", (0.86, 0.88, 0.92), roughness=0.18, metallic=0.95)
    spray_blue = make_mat("SprayBlue", (0.15, 0.68, 0.92), roughness=0.25)
    spray_gold = make_mat("SprayGold", (0.94, 0.72, 0.22), roughness=0.25)
    rubber = make_mat("WheelRubber", (0.08, 0.08, 0.09), roughness=0.75)

    # Rolling base deck + 4 swivel caster wheels
    add_box("BaseDeck", (1.28, 0.56, 0.06), (0, 0, 0.14), steel, bevel_width=0.01)
    for wx in (-0.54, 0.54):
        for wy in (-0.21, 0.21):
            add_cyl(f"Wheel_{wx}_{wy}", 0.065, 0.04, (wx, wy, 0.065), rubber, verts=14, rot=(math.pi * 0.5, 0, 0))

    # Main walnut & steel linen cabinet (0.92m wide x 0.52m deep x 0.96m tall)
    add_box("CabBack", (0.88, 0.04, 0.92), (-0.02, 0.24, 0.62), walnut)
    add_box("CabSideL", (0.04, 0.52, 0.92), (-0.45, 0, 0.62), walnut)
    add_box("CabSideR", (0.04, 0.52, 0.92), (0.41, 0, 0.62), walnut)
    for sz in (0.18, 0.48, 0.78, 1.07):
        add_box(f"Shelf_{sz}", (0.86, 0.50, 0.035), (-0.02, 0, sz), steel)

    # Top amenity tray rim
    add_box("TrayBack", (0.88, 0.03, 0.09), (-0.02, 0.23, 1.12), steel)
    add_box("TrayFront", (0.88, 0.03, 0.07), (-0.02, -0.23, 1.11), steel)

    # Neatly stacked crisp white bath towels & folded bed sheets on the open shelves!
    for shelf_z in (0.20, 0.50, 0.80):
        for col_x in (-0.26, 0.0, 0.24):
            for layer in range(3):
                add_box(
                    f"Towel_{shelf_z}_{col_x}_{layer}",
                    (0.21, 0.38, 0.072),
                    (col_x, -0.02, shelf_z + 0.04 + layer * 0.078),
                    towel_w,
                    bevel_width=0.015,
                )

    # Blue canvas soiled-linen hamper bag hanging on the left steel hoop
    add_box("HamperHoop", (0.34, 0.44, 0.03), (-0.62, 0, 1.04), chrome)
    add_box("LaundryBagMesh", (0.30, 0.40, 0.72), (-0.62, 0, 0.66), linen_b, bevel_width=0.04)

    # Chrome push-handle rail on right side + hanging caddy
    add_cyl("PushRailL", 0.016, 0.30, (0.52, -0.18, 1.02), chrome, verts=10, rot=(0, math.pi * 0.5, 0))
    add_cyl("PushRailR", 0.016, 0.30, (0.52, 0.18, 1.02), chrome, verts=10, rot=(0, math.pi * 0.5, 0))
    add_cyl("PushBar", 0.018, 0.40, (0.64, 0, 1.02), chrome, verts=12, rot=(math.pi * 0.5, 0, 0))
    add_box("SideTrashBin", (0.22, 0.34, 0.48), (0.54, 0, 0.42), steel, bevel_width=0.02)

    # Cleaning spray bottles, rolled amenities & upright broom clipped on top/back
    for i, (bx, mat) in enumerate([(-0.30, spray_blue), (-0.16, spray_gold), (0.04, spray_blue), (0.20, towel_w)]):
        add_cyl(f"Bottle_{i}", 0.042, 0.18, (bx, -0.04, 1.18), mat, verts=12)
        add_cyl(f"Nozzle_{i}", 0.016, 0.05, (bx, -0.04, 1.29), towel_w, verts=10)
    add_cyl("BroomHandle", 0.014, 1.22, (0.46, 0.22, 0.74), chrome, verts=10)
    add_box("BroomHead", (0.22, 0.06, 0.11), (0.46, 0.22, 0.15), walnut, bevel_width=0.01)

    export_glb("hotel_housekeeping_cart.glb")


# ─── 5. CLASSIC BRASS BIRDCAGE BELLHOP LUGGAGE CART ─────────────────────────
def build_hotel_luggage_cart():
    clear_scene()
    brass = make_mat("BellBrass", (0.92, 0.74, 0.30), roughness=0.16, metallic=0.96)
    crimson = make_mat("BellCarpet", (0.52, 0.08, 0.14), roughness=0.90)
    rubber = make_mat("BellWheel", (0.08, 0.08, 0.09), roughness=0.72)
    leather = make_mat("SuitcaseTan", (0.48, 0.26, 0.12), roughness=0.42)
    navy_case = make_mat("SuitcaseNavy", (0.12, 0.20, 0.36), roughness=0.28, coat=0.5)
    cream_case = make_mat("SuitcaseCream", (0.90, 0.85, 0.76), roughness=0.32, coat=0.4)

    # Carpeted base deck with protective black bumper & 4 wheels
    add_box("BaseBumper", (1.22, 0.68, 0.09), (0, 0, 0.16), rubber, bevel_width=0.02)
    add_box("BaseCarpet", (1.16, 0.62, 0.05), (0, 0, 0.21), crimson, bevel_width=0.01)
    for wx in (-0.46, 0.46):
        for wy in (-0.24, 0.24):
            add_cyl(f"Wheel_{wx}_{wy}", 0.075, 0.045, (wx, wy, 0.075), rubber, verts=16, rot=(math.pi * 0.5, 0, 0))

    # Gleaming tubular brass birdcage side uprights + top arches + finial ball!
    for sx in (-0.54, 0.54):
        for sy in (-0.27, 0.27):
            add_cyl(f"Post_{sx}_{sy}", 0.022, 1.32, (sx, sy, 0.88), brass, verts=12)
        add_cyl(f"EndCross_{sx}", 0.020, 0.56, (sx, 0, 1.15), brass, verts=12, rot=(math.pi * 0.5, 0, 0))
        add_cyl(f"TopArch_{sx}", 0.022, 0.62, (sx * 0.52, 0, 1.72), brass, verts=12, rot=(0, sx * 0.72, 0))

    # Top garment hanger bar + ornate brass finial crown
    add_cyl("GarmentBar", 0.022, 1.08, (0, 0, 1.84), brass, verts=14, rot=(0, math.pi * 0.5, 0))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.075, location=(0, 0, 1.92), segments=16, ring_count=10)
    fin = bpy.context.active_object
    fin.name = "BrassFinial"
    bpy.ops.object.shade_smooth()
    fin.data.materials.append(brass)

    # Stacked luxury designer suitcases resting on the crimson deck!
    add_box("CaseNavy", (0.62, 0.44, 0.26), (-0.16, 0.0, 0.36), navy_case, rot=(0, 0, 0.06), bevel_width=0.025)
    add_box("CaseTan", (0.54, 0.38, 0.22), (-0.14, 0.02, 0.60), leather, rot=(0, 0, -0.08), bevel_width=0.02)
    add_box("CaseStrapL", (0.04, 0.40, 0.23), (-0.30, 0.02, 0.60), brass)
    add_box("CaseStrapR", (0.04, 0.40, 0.23), (0.02, 0.02, 0.60), brass)
    add_box("CaseCream", (0.34, 0.42, 0.54), (0.32, 0.0, 0.50), cream_case, rot=(0, 0, -0.10), bevel_width=0.025)
    add_box("CaseHandle", (0.14, 0.03, 0.06), (0.32, 0.0, 0.79), brass)

    export_glb("hotel_luggage_cart.glb")


# ─── 6. ROOM SERVICE TROLLEY WITH SILVER CLOCHE & CHAMPAGNE ─────────────────
def build_hotel_room_service_cart():
    clear_scene()
    linen = make_mat("TableLinen", (0.97, 0.96, 0.93), roughness=0.84)
    silver = make_mat("SilverDome", (0.90, 0.92, 0.95), roughness=0.08, metallic=0.98)
    gold = make_mat("TrayGold", (0.90, 0.72, 0.30), roughness=0.18, metallic=0.95)
    glass_g = make_mat("ChampagneBottle", (0.08, 0.26, 0.14), roughness=0.10, coat=0.9)
    flute = make_mat("ChampagneFlute", (0.94, 0.92, 0.76), roughness=0.08, alpha=0.65, coat=1.0)
    rubber = make_mat("RSWheel", (0.08, 0.08, 0.09), roughness=0.75)

    # 4 wheels + draped crisp white floor-length hotel tablecloth
    for wx in (-0.36, 0.36):
        for wy in (-0.28, 0.28):
            add_cyl(f"Wheel_{wx}_{wy}", 0.045, 0.03, (wx, wy, 0.045), rubber, verts=12, rot=(math.pi * 0.5, 0, 0))
    add_box("LinenSkirt", (0.96, 0.74, 0.74), (0, 0, 0.47), linen, bevel_width=0.03)
    add_box("TableTopPad", (0.98, 0.76, 0.04), (0, 0, 0.85), linen, bevel_width=0.015)

    # Silver oval serving tray + gleaming domed food cloche + handle!
    add_cyl("ServingTray", 0.22, 0.02, (-0.18, 0.02, 0.88), silver, verts=24)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.18, location=(-0.18, 0.02, 0.89), segments=24, ring_count=12)
    dome = bpy.context.active_object
    dome.name = "ClocheDome"
    dome.scale = (1.0, 1.0, 0.85)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    dome.data.materials.append(silver)
    add_torus("ClocheHandle", 0.028, 0.008, (-0.18, 0.02, 1.06), gold, rot=(math.pi * 0.5, 0, 0))

    # Silver champagne ice bucket + bottle + 2 tall flutes
    add_cyl("IceBucket", 0.095, 0.22, (0.24, -0.06, 0.98), silver, verts=18, r2=0.115)
    add_cyl("BottleBody", 0.042, 0.24, (0.25, -0.06, 1.12), glass_g, verts=14, rot=(0.15, 0.12, 0))
    add_cyl("BottleFoil", 0.018, 0.10, (0.27, -0.08, 1.26), gold, verts=12, rot=(0.15, 0.12, 0))
    for fx, fy in [(0.16, 0.18), (0.30, 0.14)]:
        add_cyl(f"FluteStem_{fx}", 0.006, 0.10, (fx, fy, 0.92), silver, verts=8)
        add_cyl(f"FluteCup_{fx}", 0.022, 0.11, (fx, fy, 1.02), flute, verts=12, r2=0.026)

    export_glb("hotel_room_service_cart.glb")


# ─── 7. MODERN ONE-PIECE PORCELAIN HOTEL TOILET ─────────────────────────────
# Faces -Y in Blender -> +Z in glTF
def build_hotel_toilet_bidet():
    clear_scene()
    porcelain = make_mat("ToiletPorcelain", (0.98, 0.98, 0.97), roughness=0.08, coat=1.0)
    chrome = make_mat("ToiletChrome", (0.90, 0.92, 0.95), roughness=0.14, metallic=0.96)
    paper = make_mat("ToiletPaper", (0.96, 0.95, 0.92), roughness=0.90)

    # Pedestal base + sculpted oval bowl + lid + sleek rear tank
    add_cyl("BasePedestal", 0.16, 0.34, (0, -0.06, 0.17), porcelain, verts=20, r2=0.19)
    bowl = add_cyl("Bowl", 0.20, 0.14, (0, -0.10, 0.38), porcelain, verts=24)
    bowl.scale = (0.95, 1.24, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    lid = add_cyl("SeatLid", 0.195, 0.035, (0, -0.10, 0.46), porcelain, verts=24)
    lid.scale = (0.95, 1.24, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    add_box("TankBody", (0.40, 0.22, 0.56), (0, 0.22, 0.50), porcelain, bevel_width=0.03)
    add_box("TankLid", (0.42, 0.24, 0.04), (0, 0.22, 0.79), porcelain, bevel_width=0.012)
    add_box("FlushLever", (0.08, 0.025, 0.025), (-0.18, 0.10, 0.72), chrome)

    # Side freestanding chrome toilet paper stand + roll
    add_cyl("TPBase", 0.08, 0.02, (0.38, 0.08, 0.01), chrome, verts=14)
    add_cyl("TPPost", 0.012, 0.56, (0.38, 0.08, 0.29), chrome, verts=10)
    add_cyl("TPRoll", 0.055, 0.11, (0.34, 0.04, 0.56), paper, verts=16, rot=(0, math.pi * 0.5, 0))

    export_glb("hotel_toilet_bidet.glb")


# ─── 8. SUITE 4K TV CREDENZA, ESPRESSO TRAY & STOCKED MINIBAR ───────────────
# Faces -Y in Blender -> +Z in glTF
def build_hotel_tv_minibar():
    clear_scene()
    walnut = make_mat("CredWalnut", (0.30, 0.18, 0.11), roughness=0.42)
    marble = make_mat("CredMarble", (0.94, 0.91, 0.87), roughness=0.18, coat=0.6)
    brass = make_mat("CredBrass", (0.90, 0.72, 0.30), roughness=0.18, metallic=0.95)
    bezel = make_mat("TvBezel", (0.05, 0.06, 0.08), roughness=0.22, metallic=0.6)
    screen = make_mat(
        "TvWelcomeGlow",
        (0.18, 0.45, 0.62),
        roughness=0.06,
        emission=(0.24, 0.68, 0.88),
        emission_strength=1.6,
        coat=1.0,
    )
    fridge_glass = make_mat("FridgeGlass", (0.14, 0.24, 0.32), roughness=0.08, alpha=0.55, coat=1.0)
    fridge_glow = make_mat("FridgeLED", (0.92, 0.96, 1.0), roughness=0.2, emission=(0.85, 0.92, 1.0), emission_strength=1.4)
    bottle_a = make_mat("MiniGreen", (0.12, 0.52, 0.26), roughness=0.2)
    bottle_b = make_mat("MiniAmber", (0.88, 0.48, 0.14), roughness=0.2)

    # Walnut credenza with marble top + brass legs
    add_box("CredBody", (2.10, 0.54, 0.62), (0, 0, 0.46), walnut, bevel_width=0.015)
    add_box("CredTop", (2.16, 0.58, 0.05), (0, 0, 0.79), marble, bevel_width=0.012)
    for lx in (-0.96, 0.96):
        for ly in (-0.21, 0.21):
            add_cyl(f"Leg_{lx}_{ly}", 0.02, 0.16, (lx, ly, 0.08), brass, verts=10)

    # Glass-front illuminated minibar fridge on right bay with mini bottles inside!
    add_box("FridgeBack", (0.52, 0.04, 0.48), (0.64, 0.14, 0.46), fridge_glow)
    for i, bx in enumerate((0.48, 0.58, 0.68, 0.78)):
        add_cyl(f"MiniBot_{i}", 0.024, 0.16, (bx, 0.0, 0.36), bottle_a if i % 2 == 0 else bottle_b, verts=10)
    add_box("FridgeDoor", (0.56, 0.03, 0.52), (0.64, -0.27, 0.46), fridge_glass)
    add_box("FridgeHandle", (0.025, 0.04, 0.24), (0.39, -0.30, 0.46), brass)

    # Sleek 55" Hotel 4K TV mounted above the credenza
    add_box("TvStand", (0.48, 0.22, 0.03), (-0.18, 0.02, 0.83), bezel)
    add_box("TvNeck", (0.10, 0.06, 0.22), (-0.18, 0.06, 0.94), bezel)
    add_box("TvFrame", (1.36, 0.05, 0.80), (-0.18, 0.05, 1.38), bezel, bevel_width=0.008)
    add_box("TvScreen", (1.30, 0.02, 0.74), (-0.18, 0.018, 1.38), screen)

    # In-room pod espresso maker & chrome ice bucket on right side of marble top!
    add_box("EspressoUnit", (0.18, 0.26, 0.26), (0.74, 0.02, 0.95), bezel, bevel_width=0.01)
    add_cyl("SuiteIceBucket", 0.08, 0.16, (0.48, -0.02, 0.90), brass, verts=16)

    export_glb("hotel_tv_minibar.glb")


if __name__ == "__main__":
    build_hotel_elevator_doors()
    build_hotel_soaking_tub()
    build_hotel_vanity_sink()
    build_hotel_housekeeping_cart()
    build_hotel_luggage_cart()
    build_hotel_room_service_cart()
    build_hotel_toilet_bidet()
    build_hotel_tv_minibar()
    print("All 8 bespoke Blender Hotel Solaire fixtures exported cleanly!")
