"""
Generates 4 radically distinct, sculpted, lathe-turned PBR fountain varieties for Sol Coast
using Blender 5.2+ and exports them as compact single-mesh Draco-compressed GLBs in public/assets/props/:

  1. art_deco_fountain.glb         — Luxury Miami Art Deco Lotus & Sunburst Fountain (Hotel Solaire Atrium)
  2. fountain_plaza_grand.glb      — Monumental 12m Palm Plaza Dolphin & 3-Tier Cascading Fountain
  3. fountain_spanish_courtyard.glb — Coral Heights 8-Point Star Terracotta & Talavera Tile Courtyard Fountain
  4. fountain_modern_zen.glb       — Modernist Honed Basalt Infinity Reflecting Pool & Brass Water-Wall Fountain

Run:
  blender --background --python scripts/generate-blender-fountains.py
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


def make_mat(name, base_color, roughness=0.4, metallic=0.0, emission=None, emission_strength=0.0, alpha=1.0, coat=0.0):
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


def add_lathe(name, profile_rz, mat, steps=32, smooth=True):
    """Creates a smooth lathe-turned revolution mesh from [(radius, z), ...] points around the Z axis."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    verts = [bm.verts.new((r, 0.0, z)) for (r, z) in profile_rz]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]

    bmesh.ops.spin(
        bm,
        geom=verts + edges,
        cent=(0.0, 0.0, 0.0),
        axis=(0.0, 0.0, 1.0),
        angle=math.pi * 2.0,
        steps=steps,
        use_merge=True,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if smooth:
        bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def add_extruded_poly(name, pts_2d, height, z_base, mat, bevel_width=0.0):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z_base)) for (x, y) in pts_2d]
    face = bm.faces.new(verts)
    geom = bmesh.ops.extrude_face_region(bm, geom=[face])
    ext_verts = [g for g in geom["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ext_verts, vec=(0, 0, height))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if bevel_width > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel_width
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(mat)
    return obj


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


def add_sphere(name, radius, loc, mat, scale=(1, 1, 1), segs=18, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=radius, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def add_torus(name, major_r, minor_r, loc, mat, rot=(0, 0, 0), major_segs=32, minor_segs=12):
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


def add_curved_tube(name, pts_3d, radius, mat, segs=10):
    """Creates a smooth curved pipe/spout/dolphin arc along a list of 3D points."""
    curve_data = bpy.data.curves.new(name=name + "_curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 3
    curve_data.resolution_u = 8

    spline = curve_data.splines.new("POLY")
    spline.points.add(len(pts_3d) - 1)
    for i, (x, y, z) in enumerate(pts_3d):
        spline.points[i].co = (x, y, z, 1.0)

    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.active_object
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
    print(f"[blender-fountain] {filename}: {sz:.1f} KB")


# ─── 1. REBUILT ART DECO LOTUS & SUNBURST FOUNTAIN (HOTEL SOLAIRE ATRIUM) ────
def build_art_deco_fountain():
    clear_scene()
    marble = make_mat("CreamTravertine", (0.95, 0.91, 0.85), roughness=0.18, coat=0.55)
    rose_marble = make_mat("RoseMarble", (0.86, 0.67, 0.64), roughness=0.2, coat=0.5)
    gold = make_mat("BrushedArtDecoGold", (0.92, 0.74, 0.30), roughness=0.18, metallic=0.96)
    mosaic = make_mat("PoolMosaic", (0.06, 0.42, 0.52), roughness=0.22, coat=0.6)
    water = make_mat(
        "CrystalWater",
        (0.18, 0.86, 0.92),
        roughness=0.04,
        metallic=0.05,
        emission=(0.12, 0.72, 0.80),
        emission_strength=0.45,
        alpha=0.72,
        coat=1.0,
    )
    warm_led = make_mat("WarmUnderGlow", (1.0, 0.84, 0.46), roughness=0.1, emission=(1.0, 0.82, 0.42), emission_strength=3.0)

    # Lathe-turned stepped marble & bullnose coping basin (hollow pool inside!)
    basin_profile = [
        (0.02, 0.0),
        (1.72, 0.0),
        (1.72, 0.14),
        (1.56, 0.16),
        (1.52, 0.54),
        (1.64, 0.58),
        (1.66, 0.68),
        (1.58, 0.72),
        (1.42, 0.72),
        (1.36, 0.64),
        (1.34, 0.22),
        (0.02, 0.22),
    ]
    add_lathe("MainBasin", basin_profile, marble, steps=36)
    add_cyl("MosaicFloor", 1.33, 0.04, (0, 0, 0.23), mosaic, verts=32)
    add_cyl("BasinWater", 1.35, 0.05, (0, 0, 0.56), water, verts=32)
    add_torus("GoldRimBand", 1.54, 0.028, (0, 0, 0.46), gold, major_segs=36)
    add_torus("UnderGlowRing", 0.58, 0.024, (0, 0, 0.26), warm_led, major_segs=28)

    # 12 fluted rose-marble & gold pilasters wrapping the outer basin
    for i in range(12):
        ang = (i / 12.0) * math.pi * 2.0
        px = math.cos(ang) * 1.54
        py = math.sin(ang) * 1.54
        add_cyl(f"Rib_{i}", 0.055, 0.42, (px, py, 0.36), rose_marble, verts=10)
        add_sphere(f"Cap_{i}", 0.045, (px, py, 0.57), gold)

    # Sculpted curved Art Deco pedestal + 2 lotus bowls (true lathe curves!)
    spire_profile = [
        (0.46, 0.22),
        (0.42, 0.38),
        (0.28, 0.55),
        (0.22, 0.92),
        (0.26, 1.15),
        # Lower sculpted lotus bowl
        (0.68, 1.24),
        (0.96, 1.38),
        (1.02, 1.48),
        (0.94, 1.52),
        (0.84, 1.44),
        (0.24, 1.30),
        # Upper urn stem
        (0.18, 1.52),
        (0.14, 1.82),
        # Upper lotus bowl
        (0.42, 1.92),
        (0.58, 2.04),
        (0.61, 2.12),
        (0.54, 2.14),
        (0.46, 2.06),
        (0.14, 1.98),
        # Finial stem
        (0.09, 2.25),
        (0.03, 2.38),
    ]
    add_lathe("LotusSpire", spire_profile, marble, steps=32)
    add_cyl("Bowl1Water", 0.88, 0.04, (0, 0, 1.44), water, verts=28)
    add_cyl("Bowl2Water", 0.50, 0.035, (0, 0, 2.08), water, verts=24)
    add_torus("GoldBowlRim1", 0.98, 0.024, (0, 0, 1.50), gold, major_segs=32)
    add_torus("GoldBowlRim2", 0.58, 0.02, (0, 0, 2.12), gold, major_segs=28)

    # 4 arched golden swan-neck water spouts curving out from the mid-tier!
    for i in range(4):
        ang = (i / 4.0) * math.pi * 2.0 + math.pi * 0.25
        c, s = math.cos(ang), math.sin(ang)
        pts = [
            (c * 0.22, s * 0.22, 0.95),
            (c * 0.48, s * 0.48, 1.08),
            (c * 0.66, s * 0.66, 0.98),
            (c * 0.72, s * 0.72, 0.88),
        ]
        add_curved_tube(f"Spout_{i}", pts, 0.024, gold)

    # Iconic Miami Art Deco Golden Sunburst Finial atop the fountain!
    add_sphere("SunCore", 0.14, (0, 0, 2.48), gold)
    for i in range(8):
        ang = (i / 8.0) * math.pi * 2.0
        add_cyl(
            f"Ray_{i}",
            0.022,
            0.34,
            (math.cos(ang) * 0.18, math.sin(ang) * 0.18, 2.54),
            gold,
            verts=8,
            rot=(0, 0.9, ang),
            r2=0.004,
        )

    export_glb("art_deco_fountain.glb")


# ─── 2. MONUMENTAL PALM PLAZA GRAND DOLPHIN & 3-TIER FOUNTAIN (12M WIDE!) ───
def build_fountain_plaza_grand():
    clear_scene()
    limestone = make_mat("MiamiLimestone", (0.91, 0.87, 0.80), roughness=0.42)
    travertine = make_mat("WarmTravertine", (0.86, 0.79, 0.69), roughness=0.35)
    bronze = make_mat("AgedBronze", (0.28, 0.38, 0.32), roughness=0.28, metallic=0.88)
    gold_bronze = make_mat("PolishedBronze", (0.76, 0.58, 0.26), roughness=0.24, metallic=0.92)
    pool_tile = make_mat("DeepTealTile", (0.04, 0.34, 0.44), roughness=0.22, coat=0.6)
    water = make_mat(
        "PlazaWater",
        (0.14, 0.84, 0.94),
        roughness=0.04,
        emission=(0.08, 0.65, 0.78),
        emission_strength=0.4,
        alpha=0.74,
        coat=1.0,
    )
    uplight = make_mat("CyanUplight", (0.25, 0.96, 1.0), roughness=0.1, emission=(0.25, 0.96, 1.0), emission_strength=3.2)

    # Grand 12m diameter circular basin with stepped sitting terrace & rolled coping
    basin_prof = [
        (0.05, 0.0),
        (6.05, 0.0),
        (6.05, 0.22),
        (5.65, 0.25),
        (5.58, 0.78),
        (5.80, 0.84),
        (5.82, 0.98),
        (5.68, 1.04),
        (5.26, 1.04),
        (5.16, 0.92),
        (5.12, 0.28),
        (0.05, 0.28),
    ]
    add_lathe("GrandBasin", basin_prof, limestone, steps=44)
    add_cyl("GrandTileFloor", 5.10, 0.06, (0, 0, 0.29), pool_tile, verts=40)
    add_cyl("GrandWater", 5.14, 0.08, (0, 0, 0.82), water, verts=40)

    # 8 carved stone coping pilasters + underwater cyan LED uplight rings around the pool
    for i in range(8):
        ang = (i / 8.0) * math.pi * 2.0
        px, py = math.cos(ang) * 5.52, math.sin(ang) * 5.52
        add_box(f"Pilaster_{i}", (0.62, 0.62, 0.92), (px, py, 0.62), travertine, rot=(0, 0, ang), bevel_width=0.04)
        add_sphere(f"Finial_{i}", 0.20, (px, py, 1.18), gold_bronze)
        lx, ly = math.cos(ang) * 3.25, math.sin(ang) * 3.25
        add_torus(f"Uplight_{i}", 0.22, 0.04, (lx, ly, 0.36), uplight, major_segs=16)

    # Monumental 3-tier lathe-turned Renaissance-Miami cascading tower (5.2m tall!)
    tower_prof = [
        (1.65, 0.28),
        (1.52, 0.52),
        (1.18, 0.78),
        (0.88, 1.18),
        (0.76, 1.62),
        # Tier 1 massive sculpted bowl (r = 2.65m)
        (1.90, 1.82),
        (2.58, 2.06),
        (2.68, 2.22),
        (2.54, 2.28),
        (2.35, 2.14),
        (0.76, 1.92),
        # Tier 2 urn column
        (0.58, 2.38),
        (0.46, 2.95),
        # Tier 2 bowl (r = 1.65m)
        (1.18, 3.12),
        (1.58, 3.30),
        (1.65, 3.42),
        (1.52, 3.46),
        (1.38, 3.34),
        (0.42, 3.18),
        # Tier 3 crown stem & chalice bowl (r = 0.86m)
        (0.32, 3.72),
        (0.24, 4.18),
        (0.68, 4.34),
        (0.86, 4.50),
        (0.88, 4.58),
        (0.78, 4.60),
        (0.68, 4.48),
        (0.22, 4.38),
        # Top nozzle crown
        (0.16, 4.78),
        (0.06, 5.05),
    ]
    add_lathe("CascadingTower", tower_prof, travertine, steps=36)
    add_cyl("Tier1Water", 2.42, 0.06, (0, 0, 2.16), water, verts=32)
    add_cyl("Tier2Water", 1.45, 0.05, (0, 0, 3.38), water, verts=28)
    add_cyl("Tier3Water", 0.72, 0.04, (0, 0, 4.52), water, verts=24)

    # 4 Sculpted Leaping Bronze Dolphins arcing gracefully around the lower pedestal!
    for i in range(4):
        ang = (i / 4.0) * math.pi * 2.0 + math.pi * 0.25
        c, s = math.cos(ang), math.sin(ang)
        pts = [
            (c * 1.15, s * 1.15, 0.85),
            (c * 1.62, s * 1.62, 1.32),
            (c * 1.55, s * 1.55, 1.85),
            (c * 1.12, s * 1.12, 1.98),
        ]
        add_curved_tube(f"DolphinBody_{i}", pts, 0.16, bronze)
        # Dolphin snout + tail fluke
        add_cyl(f"DolphinSnout_{i}", 0.11, 0.34, (c * 1.82, s * 1.82, 1.12), bronze, verts=12, rot=(0, 1.1, ang), r2=0.035)
        add_box(f"DolphinTail_{i}", (0.12, 0.42, 0.18), (c * 1.05, s * 1.05, 2.04), bronze, rot=(0, 0.4, ang), bevel_width=0.02)

    export_glb("fountain_plaza_grand.glb")


# ─── 3. SPANISH COURTYARD 8-POINT STAR TERRACOTTA & TALAVERA FOUNTAIN ────────
def build_fountain_spanish_courtyard():
    clear_scene()
    terracotta = make_mat("TerracottaClay", (0.74, 0.33, 0.20), roughness=0.58)
    sandstone = make_mat("CoralSandstone", (0.88, 0.78, 0.64), roughness=0.52)
    cobalt = make_mat("TalaveraCobalt", (0.09, 0.26, 0.68), roughness=0.14, coat=0.9)
    teal_tile = make_mat("TalaveraTeal", (0.10, 0.62, 0.64), roughness=0.14, coat=0.9)
    bronze = make_mat("PatinaBronze", (0.45, 0.34, 0.18), roughness=0.3, metallic=0.88)
    water = make_mat(
        "CourtyardWater",
        (0.16, 0.78, 0.86),
        roughness=0.04,
        emission=(0.08, 0.55, 0.65),
        emission_strength=0.35,
        alpha=0.76,
        coat=1.0,
    )

    # Iconic 8-pointed Moorish/Spanish star basin (2 overlapping rotated squares!)
    for idx, rot_z in enumerate([0.0, math.pi * 0.25]):
        add_box(f"StarOuter_{idx}", (2.35, 2.35, 0.58), (0, 0, 0.29), terracotta, rot=(0, 0, rot_z), bevel_width=0.03)
        add_box(f"StarRim_{idx}", (2.46, 2.46, 0.10), (0, 0, 0.60), sandstone, rot=(0, 0, rot_z), bevel_width=0.025)
        add_box(f"StarInlay_{idx}", (2.10, 2.10, 0.08), (0, 0, 0.62), cobalt if idx == 0 else teal_tile, rot=(0, 0, rot_z), bevel_width=0.01)

    # Shimmering tiled basin water surface inside the star rim
    add_cyl("StarWater", 1.12, 0.06, (0, 0, 0.61), water, verts=24)

    # Carved sandstone central pedestal + glazed cobalt ring + overflowing scalloped terracotta amphora urn!
    ped_prof = [
        (0.55, 0.25),
        (0.48, 0.45),
        (0.32, 0.65),
        (0.28, 1.05),
        (0.52, 1.18),
        (0.68, 1.28),
        (0.62, 1.34),
        (0.30, 1.24),
        # Amphora urn body
        (0.24, 1.38),
        (0.42, 1.62),
        (0.46, 1.85),
        (0.36, 2.06),
        (0.20, 2.22),
        (0.28, 2.34),
        (0.24, 2.36),
        (0.16, 2.22),
    ]
    add_lathe("SpanishPedestalUrn", ped_prof, terracotta, steps=28)
    add_torus("CobaltBand", 0.45, 0.035, (0, 0, 1.82), cobalt, major_segs=28)
    add_torus("TealBand", 0.39, 0.028, (0, 0, 1.56), teal_tile, major_segs=28)

    # 4 ornate bronze water spouts + twin amphora handles
    for i in range(4):
        ang = (i / 4.0) * math.pi * 2.0
        c, s = math.cos(ang), math.sin(ang)
        pts = [(c * 0.28, s * 0.28, 1.05), (c * 0.56, s * 0.56, 1.02), (c * 0.66, s * 0.66, 0.90)]
        add_curved_tube(f"BronzeSpout_{i}", pts, 0.025, bronze)
    for side in (-1, 1):
        pts = [
            (side * 0.24, 0, 2.18),
            (side * 0.56, 0, 2.08),
            (side * 0.56, 0, 1.78),
            (side * 0.42, 0, 1.68),
        ]
        add_curved_tube(f"UrnHandle_{side}", pts, 0.032, terracotta)

    export_glb("fountain_spanish_courtyard.glb")


# ─── 4. MODERNIST HONED BASALT INFINITY & BRASS WATER-WALL FOUNTAIN ──────────
def build_fountain_modern_zen():
    clear_scene()
    basalt = make_mat("HonedBasalt", (0.09, 0.10, 0.12), roughness=0.22, metallic=0.12, coat=0.4)
    slate = make_mat("TexturedSlate", (0.15, 0.17, 0.20), roughness=0.45, metallic=0.15)
    brass = make_mat("ArchitecturalBrass", (0.88, 0.70, 0.30), roughness=0.2, metallic=0.95)
    pebble = make_mat("RiverStone", (0.42, 0.44, 0.46), roughness=0.35)
    water = make_mat(
        "InfinityWater",
        (0.10, 0.74, 0.86),
        roughness=0.03,
        metallic=0.1,
        emission=(0.08, 0.62, 0.78),
        emission_strength=0.48,
        alpha=0.72,
        coat=1.0,
    )
    led = make_mat("ZenLedStrip", (0.20, 0.96, 1.0), roughness=0.1, emission=(0.20, 0.96, 1.0), emission_strength=3.5)

    # Low sleek architectural honed basalt reflecting pool (4.6m x 3.2m)
    add_box("PoolBase", (4.6, 3.2, 0.18), (0, 0, 0.09), basalt, bevel_width=0.03)
    # 4 beveled infinity perimeter walls
    add_box("CurbN", (4.6, 0.26, 0.44), (0, 1.47, 0.32), basalt, bevel_width=0.025)
    add_box("CurbS", (4.6, 0.26, 0.44), (0, -1.47, 0.32), basalt, bevel_width=0.025)
    add_box("CurbW", (0.26, 3.2, 0.44), (-2.17, 0, 0.32), basalt, bevel_width=0.025)
    add_box("CurbE", (0.26, 3.2, 0.44), (2.17, 0, 0.32), basalt, bevel_width=0.025)

    # Mirror-gloss infinity water sheet + recessed cyan underwater LED strip
    add_box("ReflectingWater", (4.12, 2.72, 0.06), (0, 0, 0.46), water)
    add_box("LedN", (3.95, 0.05, 0.04), (0, 1.30, 0.42), led)
    add_box("LedS", (3.95, 0.05, 0.04), (0, -1.30, 0.42), led)

    # 3 Asymmetrical Stepped Slate & Brushed-Brass Overflowing Water-Wall Monoliths!
    monoliths = [
        (-1.05, 0.15, 0.95, 0.36, 1.95),
        (0.05, -0.10, 1.05, 0.40, 2.65),
        (1.15, 0.12, 0.90, 0.34, 1.55),
    ]
    for idx, (mx, my, mw, md, mh) in enumerate(monoliths):
        add_box(f"Monolith_{idx}", (mw, md, mh), (mx, my, 0.18 + mh * 0.5), slate, bevel_width=0.025)
        # Brushed brass top spill weir lip
        add_box(f"BrassWeir_{idx}", (mw + 0.06, md + 0.12, 0.08), (mx, my, 0.18 + mh), brass, bevel_width=0.015)
        # Shimmering cascading water curtains on front & back faces
        for side in (-1, 1):
            add_box(
                f"WaterSheet_{idx}_{side}",
                (mw * 0.82, 0.03, mh - 0.25),
                (mx, my + side * (md * 0.5 + 0.03), 0.35 + (mh - 0.25) * 0.5),
                water,
            )

    # Smooth sculpted river stones resting along the shallow edge
    for idx, (rx, ry, rs) in enumerate([(-1.6, -0.8, 0.22), (-1.2, -0.95, 0.16), (1.5, -0.85, 0.24), (1.75, 0.8, 0.19)]):
        add_sphere(f"Stone_{idx}", rs, (rx, ry, 0.46), pebble, scale=(1.2, 0.9, 0.55))

    export_glb("fountain_modern_zen.glb")


if __name__ == "__main__":
    build_art_deco_fountain()
    build_fountain_plaza_grand()
    build_fountain_spanish_courtyard()
    build_fountain_modern_zen()
    print("All 4 sculpted Blender fountain varieties exported cleanly!")
