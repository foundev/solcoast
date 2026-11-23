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


if __name__ == "__main__":
    build_hotel_elevator_doors()
    build_hotel_soaking_tub()
    build_hotel_vanity_sink()
    print("All 3 bespoke Blender Hotel Solaire fixtures exported cleanly!")
