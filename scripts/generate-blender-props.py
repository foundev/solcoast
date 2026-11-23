"""
Generates 10 bespoke, beveled, smooth-shaded PBR hero interior 3D models for Sol Coast
using Blender 5.2+ and exports them as compact Draco-compressed GLBs into public/assets/props/.

Run:
  blender --background --python scripts/generate-blender-props.py
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Euler

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "public", "assets", "props"))
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, base_color, roughness=0.4, metallic=0.0, emission=None, emission_strength=0.0, alpha=1.0, coat=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
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


def add_cyl(name, radius, depth, loc, mat, verts=20, rot=(0, 0, 0), smooth=True, radius_top=None):
    if radius_top is not None:
        bpy.ops.mesh.primitive_cone_add(
            vertices=verts, radius1=radius, radius2=radius_top, depth=depth, location=loc, rotation=rot
        )
    else:
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot
        )
    obj = bpy.context.active_object
    obj.name = name
    if smooth:
        bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def add_sphere(name, radius, loc, mat, scale=(1, 1, 1), segs=16, rings=10):
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


def export_glb(filename):
    # Ensure grounded cleanly at Z=0 (Blender Z-up -> glTF Y-up) and centered X/Y
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

    # Join all sub-meshes into a single multi-material mesh for ultra-low WebGL draw calls!
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
    print(f"[blender] {filename}: {sz:.1f} KB")


# ─── 1. CONCERT GRAND PIANO + BENCH ──────────────────────────────────────────
def build_grand_piano():
    clear_scene()
    lacquer = make_mat("PianoLacquer", (0.02, 0.02, 0.025), roughness=0.08, metallic=0.05, coat=1.0)
    crimson = make_mat("PianoSoundboard", (0.55, 0.38, 0.14), roughness=0.35, metallic=0.2)
    brass = make_mat("Brass", (0.85, 0.67, 0.28), roughness=0.22, metallic=0.92)
    ivory = make_mat("Ivory", (0.95, 0.93, 0.88), roughness=0.25)
    ebony = make_mat("Ebony", (0.04, 0.04, 0.05), roughness=0.2)
    leather = make_mat("BenchLeather", (0.08, 0.04, 0.04), roughness=0.45)

    # S-curved grand piano rim profile (X=width, Y=depth, keyboard at -Y)
    pts = [
        (-0.76, -0.52),
        (0.76, -0.52),
        (0.76, -0.05),
        (0.68, 0.25),
        (0.46, 0.55),
        (0.32, 0.92),
        (0.18, 1.28),
        (-0.08, 1.42),
        (-0.42, 1.38),
        (-0.68, 1.15),
        (-0.76, 0.72),
    ]
    add_extruded_poly("BodyRim", pts, 0.30, 0.72, lacquer, bevel_width=0.02)
    add_extruded_poly("Soundboard", [(x * 0.9, y * 0.9) for (x, y) in pts], 0.05, 0.96, crimson)

    # Angled open piano lid propped by brass stick
    lid = add_extruded_poly("OpenLid", pts, 0.035, 1.03, lacquer, bevel_width=0.01)
    lid.location = (-0.76, 0, 1.03)
    for v in lid.data.vertices:
        v.co.x += 0.76
        v.co.z -= 1.03
    lid.rotation_euler = (0, -0.44, 0)

    # Brass prop stick
    add_cyl("LidProp", 0.012, 0.68, (0.58, 0.22, 1.32), brass, verts=10, rot=(0, 0.24, 0))

    # Keyboard bed + white & black keys
    add_box("KeyBed", (1.48, 0.36, 0.14), (0, -0.64, 0.75), lacquer, bevel_width=0.015)
    add_box("WhiteKeys", (1.32, 0.18, 0.035), (0, -0.68, 0.835), ivory, bevel_width=0.004)
    for i in range(36):
        if i % 7 in (0, 1, 3, 4, 5):
            kx = -0.62 + i * 0.035
            add_box(f"BlackKey_{i}", (0.018, 0.11, 0.028), (kx, -0.63, 0.86), ebony)

    # Music stand
    add_box("MusicStand", (0.72, 0.03, 0.26), (0, -0.42, 1.14), lacquer, rot=(0.25, 0, 0), bevel_width=0.008)

    # 3 turned fluted legs + brass casters
    for idx, (lx, ly) in enumerate([(-0.62, -0.46), (0.62, -0.46), (-0.18, 1.15)]):
        add_cyl(f"Leg_{idx}", 0.048, 0.68, (lx, ly, 0.39), lacquer, verts=14, radius_top=0.068)
        add_cyl(f"Caster_{idx}", 0.035, 0.06, (lx, ly, 0.035), brass, verts=12)

    # Pedal lyre + 3 brass pedals
    add_cyl("LyreL", 0.02, 0.56, (-0.12, -0.22, 0.44), lacquer, verts=10)
    add_cyl("LyreR", 0.02, 0.56, (0.12, -0.22, 0.44), lacquer, verts=10)
    add_box("PedalBox", (0.32, 0.12, 0.09), (0, -0.22, 0.14), lacquer, bevel_width=0.01)
    for px in (-0.08, 0.0, 0.08):
        add_box("Pedal", (0.028, 0.12, 0.018), (px, -0.29, 0.13), brass)

    # Matching tufted piano bench
    add_box("BenchSeat", (0.86, 0.38, 0.10), (0, -1.16, 0.52), leather, bevel_width=0.025)
    add_box("BenchFrame", (0.82, 0.34, 0.07), (0, -1.16, 0.44), lacquer, bevel_width=0.01)
    for bx in (-0.36, 0.36):
        for by in (-1.01, -1.31):
            add_cyl("BenchLeg", 0.024, 0.44, (bx, by, 0.22), lacquer, verts=10, radius_top=0.032)

    export_glb("grand_piano.glb")


# ─── 2. ART DECO MARBLE & GOLD FOUNTAIN ──────────────────────────────────────
def build_art_deco_fountain():
    clear_scene()
    marble = make_mat("CreamMarble", (0.94, 0.90, 0.84), roughness=0.18, coat=0.5)
    gold = make_mat("ArtDecoGold", (0.90, 0.72, 0.30), roughness=0.2, metallic=0.95)
    water = make_mat("TurquoiseWater", (0.12, 0.85, 0.88), roughness=0.06, metallic=0.1, emission=(0.1, 0.75, 0.82), emission_strength=0.45, alpha=0.82)

    # Stepped octagonal basin
    add_cyl("BaseStep", 1.65, 0.18, (0, 0, 0.09), marble, verts=8, smooth=False)
    add_cyl("BasinOuter", 1.48, 0.52, (0, 0, 0.44), marble, verts=8, smooth=False)
    add_torus("GoldTrimLow", 1.42, 0.045, (0, 0, 0.70), gold, major_segs=24)
    add_cyl("WaterPool", 1.34, 0.08, (0, 0, 0.62), water, verts=24)

    # Fluted central spire + 2 upper scalloped bowls
    add_cyl("Pedestal1", 0.32, 0.85, (0, 0, 0.92), marble, verts=16, radius_top=0.22)
    add_cyl("Bowl1", 0.88, 0.18, (0, 0, 1.38), marble, verts=20, radius_top=0.95)
    add_torus("GoldRim1", 0.94, 0.032, (0, 0, 1.48), gold, major_segs=24)
    add_cyl("Water1", 0.85, 0.05, (0, 0, 1.44), water, verts=20)

    add_cyl("Pedestal2", 0.18, 0.65, (0, 0, 1.75), gold, verts=16, radius_top=0.12)
    add_cyl("Bowl2", 0.48, 0.14, (0, 0, 2.08), marble, verts=20, radius_top=0.54)
    add_cyl("Water2", 0.45, 0.04, (0, 0, 2.13), water, verts=18)

    # Finial + glowing crystal plume
    add_sphere("FinialGold", 0.16, (0, 0, 2.34), gold)
    add_cyl("WaterPlume", 0.04, 0.42, (0, 0, 2.58), water, verts=12, radius_top=0.14)

    export_glb("art_deco_fountain.glb")


# ─── 3. CLUB NEON DJ BOOTH + TWIN SPEAKER STACKS ─────────────────────────────
def build_dj_booth_rig():
    clear_scene()
    chassis = make_mat("DarkSteel", (0.06, 0.065, 0.09), roughness=0.35, metallic=0.65)
    chrome = make_mat("Chrome", (0.85, 0.88, 0.92), roughness=0.14, metallic=0.96)
    vinyl = make_mat("Vinyl", (0.02, 0.02, 0.025), roughness=0.18, coat=0.7)
    pink = make_mat("NeonPink", (1.0, 0.18, 0.58), roughness=0.1, emission=(1.0, 0.18, 0.58), emission_strength=3.2)
    cyan = make_mat("NeonCyan", (0.15, 0.95, 1.0), roughness=0.1, emission=(0.15, 0.95, 1.0), emission_strength=3.2)
    amber = make_mat("PadAmber", (1.0, 0.72, 0.15), roughness=0.2, emission=(1.0, 0.72, 0.15), emission_strength=2.2)

    # Angled DJ console booth
    add_box("ConsoleMain", (2.8, 0.92, 1.12), (0, 0, 0.56), chassis, bevel_width=0.03)
    add_box("ConsoleTop", (2.94, 1.02, 0.08), (0, 0, 1.14), chassis, bevel_width=0.02)

    # Glowing equalizer front ribs
    for i in range(9):
        x = -1.12 + i * 0.28
        h = 0.28 + (0.48 if i % 2 == 0 else 0.22) + (0.15 if i in (3, 4, 5) else 0)
        add_box(f"EqBar_{i}", (0.14, 0.05, h), (x, -0.47, 0.22 + h * 0.5), pink if i % 2 == 0 else cyan)

    # Twin DJ Turntables with vinyl records & chrome platters
    for sx in (-0.78, 0.78):
        add_box("DeckBase", (0.58, 0.46, 0.07), (sx, 0, 1.21), chassis, bevel_width=0.01)
        add_cyl("Platter", 0.20, 0.03, (sx - 0.03, 0, 1.26), chrome, verts=24)
        add_cyl("VinylDisc", 0.185, 0.015, (sx - 0.03, 0, 1.28), vinyl, verts=24)
        add_cyl("Label", 0.06, 0.018, (sx - 0.03, 0, 1.285), pink if sx < 0 else cyan, verts=16)
        add_cyl("ToneArm", 0.008, 0.26, (sx + 0.18, 0.02, 1.30), chrome, verts=8, rot=(1.45, 0, -0.35))

    # Central 4-channel Mixer with glowing pads
    add_box("Mixer", (0.52, 0.48, 0.08), (0, 0, 1.21), chassis, bevel_width=0.01)
    for gx in range(4):
        for gy in range(2):
            add_box("Pad", (0.07, 0.07, 0.02), (-0.15 + gx * 0.10, -0.14 + gy * 0.10, 1.26), cyan if gy == 0 else amber)
    for fx in (-0.12, -0.04, 0.04, 0.12):
        add_box("Fader", (0.025, 0.05, 0.035), (fx, 0.12, 1.27), chrome)

    # Towering Left & Right Club Subwoofer Speaker Stacks!
    for sx in (-2.05, 2.05):
        add_box("SubCab", (1.05, 0.85, 2.35), (sx, 0.12, 1.18), chassis, bevel_width=0.03)
        for wz, wr in [(0.62, 0.34), (1.38, 0.30), (1.98, 0.18)]:
            add_torus("SpeakerRing", wr, 0.032, (sx, -0.31, wz), cyan if wz < 1.5 else pink, rot=(math.pi * 0.5, 0, 0))
            add_cyl("SpeakerCone", wr * 0.88, 0.12, (sx, -0.26, wz), vinyl, verts=20, rot=(math.pi * 0.5, 0, 0), radius_top=wr * 0.25)
            add_sphere("DustCap", wr * 0.24, (sx, -0.27, wz), chrome)

    export_glb("dj_booth_rig.glb")


# ─── 4. COMMERCIAL 3-GROUP CUBAN ESPRESSO MACHINE & GRINDER ──────────────────
def build_espresso_machine():
    clear_scene()
    chrome = make_mat("EspressoChrome", (0.90, 0.91, 0.94), roughness=0.1, metallic=0.98)
    crimson = make_mat("EspressoRed", (0.68, 0.09, 0.10), roughness=0.2, metallic=0.3, coat=0.9)
    dark = make_mat("RubberDark", (0.06, 0.06, 0.07), roughness=0.6)
    brass = make_mat("BrassGauge", (0.88, 0.72, 0.32), roughness=0.22, metallic=0.9)
    ceramic = make_mat("CupWhite", (0.96, 0.94, 0.90), roughness=0.18)
    beans = make_mat("CoffeeBeans", (0.16, 0.08, 0.04), roughness=0.55)

    # Main stainless base & drip tray
    add_box("Base", (1.08, 0.58, 0.12), (-0.16, 0, 0.06), chrome, bevel_width=0.015)
    add_box("DripGrate", (0.96, 0.22, 0.03), (-0.16, -0.18, 0.13), dark)
    add_box("BodyBack", (1.06, 0.42, 0.46), (-0.16, 0.08, 0.35), crimson, bevel_width=0.03)
    add_box("TopPlate", (1.02, 0.40, 0.04), (-0.16, 0.08, 0.59), chrome, bevel_width=0.01)

    # 3 chrome group heads + portafilter handles
    for gx in (-0.48, -0.16, 0.16):
        add_cyl("GroupHead", 0.065, 0.12, (gx, -0.15, 0.42), chrome, verts=16)
        add_cyl("Portafilter", 0.052, 0.06, (gx, -0.15, 0.33), chrome, verts=16)
        add_cyl("PFHandle", 0.018, 0.18, (gx, -0.27, 0.31), dark, verts=10, rot=(1.35, 0, 0))

    # Brass pressure gauges + dual steam wands
    add_cyl("GaugeL", 0.042, 0.025, (-0.34, -0.14, 0.50), brass, verts=16, rot=(math.pi * 0.5, 0, 0))
    add_cyl("GaugeR", 0.042, 0.025, (0.02, -0.14, 0.50), brass, verts=16, rot=(math.pi * 0.5, 0, 0))
    for sx in (-0.60, 0.28):
        add_cyl("SteamWand", 0.01, 0.24, (sx, -0.19, 0.34), chrome, verts=8, rot=(0.35, 0, 0))

    # Stacked espresso cups on top warming tray
    for i, cx in enumerate([-0.50, -0.35, -0.20, -0.05, 0.10]):
        add_cyl(f"Cup_{i}", 0.038, 0.065, (cx, 0.08, 0.64), ceramic, verts=14, radius_top=0.045)
        if i % 2 == 0:
            add_cyl(f"CupTop_{i}", 0.036, 0.062, (cx, 0.08, 0.70), ceramic, verts=14, radius_top=0.043)

    # Commercial Coffee Grinder beside machine
    add_box("GrinderBase", (0.24, 0.32, 0.34), (0.58, 0.02, 0.17), crimson, bevel_width=0.02)
    add_cyl("Hopper", 0.06, 0.28, (0.58, 0.02, 0.48), beans, verts=18, radius_top=0.14)
    add_cyl("HopperLid", 0.145, 0.025, (0.58, 0.02, 0.63), dark, verts=18)

    export_glb("espresso_machine.glb")


# ─── 5. CURVED GLASS BAKERY PASTRY DISPLAY CASE ──────────────────────────────
def build_pastry_display_case():
    clear_scene()
    walnut = make_mat("WalnutWood", (0.30, 0.16, 0.09), roughness=0.42)
    brass = make_mat("VitrineBrass", (0.85, 0.68, 0.32), roughness=0.22, metallic=0.92)
    glass = make_mat("VitrineGlass", (0.86, 0.95, 1.0), roughness=0.05, metallic=0.1, alpha=0.30)
    pastry = make_mat("GoldenPastry", (0.82, 0.54, 0.22), roughness=0.55)
    frosting = make_mat("BerryFrosting", (0.85, 0.25, 0.38), roughness=0.35)
    cream = make_mat("CreamCake", (0.96, 0.90, 0.78), roughness=0.45)

    # Solid wooden counter base
    add_box("CabinetBase", (1.85, 0.86, 0.76), (0, 0, 0.38), walnut, bevel_width=0.02)
    add_box("BrassPlinth", (1.88, 0.88, 0.06), (0, 0, 0.79), brass, bevel_width=0.01)

    # Glass display enclosure + brass corner posts
    add_box("GlassFront", (1.80, 0.03, 0.74), (0, -0.40, 1.18), glass)
    add_box("GlassTop", (1.80, 0.80, 0.03), (0, 0, 1.56), glass)
    for sx in (-0.90, 0.90):
        add_box("GlassSide", (0.03, 0.80, 0.74), (sx, 0, 1.18), glass)
        for sy in (-0.40, 0.40):
            add_cyl("BrassPost", 0.018, 0.78, (sx, sy, 1.18), brass, verts=10)

    # 2 interior display shelves stocked with pastries & cakes!
    for sz in (0.98, 1.28):
        add_box("Shelf", (1.72, 0.64, 0.025), (0, 0, sz), brass)
        # Rows of golden croissants / pastelitos
        for ix in range(-3, 4):
            px = ix * 0.22
            if sz < 1.1:
                if ix < 0:
                    add_cyl("Cake", 0.09, 0.09, (px, -0.06, sz + 0.06), cream, verts=16)
                    add_cyl("Frosting", 0.092, 0.025, (px, -0.06, sz + 0.11), frosting, verts=16)
                else:
                    add_box("Pastelito", (0.12, 0.12, 0.055), (px, -0.05, sz + 0.04), pastry, rot=(0, 0, 0.25), bevel_width=0.015)
            else:
                add_torus("Croissant", 0.055, 0.026, (px, -0.05, sz + 0.04), pastry, major_segs=14, minor_segs=8)

    export_glb("pastry_display_case.glb")


# ─── 6. WYNWOOD KINETIC NEON & CHROME GALLERY SCULPTURE ──────────────────────
def build_neon_sculpture_arch():
    clear_scene()
    obsidian = make_mat("ObsidianPlinth", (0.04, 0.045, 0.06), roughness=0.14, metallic=0.25, coat=0.8)
    chrome = make_mat("MirrorChrome", (0.92, 0.94, 0.98), roughness=0.06, metallic=0.99)
    cyan = make_mat("GlowCyan", (0.15, 0.95, 1.0), roughness=0.1, emission=(0.15, 0.95, 1.0), emission_strength=3.5)
    magenta = make_mat("GlowMagenta", (1.0, 0.18, 0.65), roughness=0.1, emission=(1.0, 0.18, 0.65), emission_strength=3.5)
    gold = make_mat("GlowGold", (1.0, 0.80, 0.25), roughness=0.1, emission=(1.0, 0.80, 0.25), emission_strength=2.8)

    # Stepped beveled obsidian plinth
    add_box("PlinthBase", (2.1, 2.1, 0.22), (0, 0, 0.11), obsidian, bevel_width=0.03)
    add_box("PlinthMid", (1.6, 1.6, 0.55), (0, 0, 0.50), obsidian, bevel_width=0.03)
    add_torus("BaseRing", 0.92, 0.025, (0, 0, 0.79), cyan, major_segs=36)

    # Interlocking floating chrome & glowing neon gyroscopic rings!
    add_torus("RingOuter", 1.15, 0.065, (0, 0, 2.25), chrome, rot=(math.pi * 0.5, 0.28, 0.3), major_segs=40, minor_segs=14)
    add_torus("RingCyan", 0.92, 0.038, (0, 0, 2.25), cyan, rot=(math.pi * 0.5, -0.45, 0.85), major_segs=36, minor_segs=12)
    add_torus("RingMagenta", 0.68, 0.038, (0, 0, 2.25), magenta, rot=(0.65, 0.55, 0.2), major_segs=32, minor_segs=12)
    add_torus("RingGold", 0.44, 0.030, (0, 0, 2.25), gold, rot=(-0.75, 0.2, 0.9), major_segs=28, minor_segs=10)
    add_sphere("CoreOrb", 0.22, (0, 0, 2.25), chrome, segs=24, rings=16)

    export_glb("neon_sculpture_arch.glb")


# ─── 7. ARTIST STUDIO A-FRAME EASEL + CANVAS + PALETTE ───────────────────────
def build_artist_easel():
    clear_scene()
    oak = make_mat("StudioOak", (0.56, 0.38, 0.22), roughness=0.55)
    canvas_bg = make_mat("CanvasBase", (0.96, 0.94, 0.90), roughness=0.75)
    pink = make_mat("PaintPink", (0.98, 0.22, 0.55), roughness=0.4)
    teal = make_mat("PaintTeal", (0.12, 0.82, 0.85), roughness=0.4)
    sun = make_mat("PaintGold", (1.0, 0.78, 0.18), roughness=0.4)
    navy = make_mat("PaintNavy", (0.10, 0.14, 0.34), roughness=0.4)

    # A-frame hardwood tripod legs
    add_box("LegLeft", (0.055, 0.045, 1.95), (-0.30, 0.04, 0.96), oak, rot=(-0.12, 0.14, 0), bevel_width=0.008)
    add_box("LegRight", (0.055, 0.045, 1.95), (0.30, 0.04, 0.96), oak, rot=(-0.12, -0.14, 0), bevel_width=0.008)
    add_box("LegRear", (0.055, 0.045, 1.92), (0, 0.44, 0.92), oak, rot=(0.36, 0, 0), bevel_width=0.008)
    add_box("CenterMast", (0.06, 0.045, 1.75), (0, 0.06, 1.15), oak, rot=(-0.12, 0, 0), bevel_width=0.008)

    # Shelf ledge
    add_box("Ledge", (0.92, 0.12, 0.045), (0, -0.05, 0.82), oak, rot=(-0.12, 0, 0), bevel_width=0.008)

    # Stretched canvas with bold layered 3D Miami sunset relief art!
    add_box("CanvasFrame", (1.08, 0.05, 0.86), (0, -0.04, 1.28), canvas_bg, rot=(-0.12, 0, 0), bevel_width=0.01)
    add_box("ArtSky", (1.00, 0.015, 0.78), (0, -0.068, 1.28), navy, rot=(-0.12, 0, 0))
    add_cyl("ArtSun", 0.22, 0.02, (0.06, -0.08, 1.38), sun, verts=24, rot=(math.pi * 0.5 - 0.12, 0, 0))
    add_box("ArtWave1", (0.92, 0.02, 0.10), (0, -0.075, 1.08), pink, rot=(-0.12, 0, 0))
    add_box("ArtWave2", (0.86, 0.02, 0.08), (0, -0.078, 0.98), teal, rot=(-0.12, 0, 0))

    # Paint dabs & brush jar on ledge
    add_cyl("BrushJar", 0.042, 0.11, (0.34, -0.06, 0.88), teal, verts=14)
    for bi in range(4):
        add_cyl("Brush", 0.006, 0.24, (0.33 + bi * 0.012, -0.06, 0.96), oak, verts=6, rot=(0.1, -0.15 + bi * 0.1, 0))

    export_glb("artist_easel.glb")


# ─── 8. MIAMI NEON PALM WALL SCULPTURE ───────────────────────────────────────
def build_neon_palm_sign():
    clear_scene()
    back = make_mat("AcrylicBack", (0.05, 0.05, 0.08), roughness=0.15, metallic=0.2)
    pink = make_mat("TubePink", (1.0, 0.20, 0.60), roughness=0.1, emission=(1.0, 0.20, 0.60), emission_strength=4.0)
    cyan = make_mat("TubeCyan", (0.12, 0.96, 1.0), roughness=0.1, emission=(0.12, 0.96, 1.0), emission_strength=4.0)
    gold = make_mat("TubeGold", (1.0, 0.80, 0.20), roughness=0.1, emission=(1.0, 0.80, 0.20), emission_strength=3.5)

    # Dark rounded acrylic backing panel (vertical, faces -Y)
    add_box("BackPanel", (1.85, 0.06, 1.35), (0, 0, 0.68), back, bevel_width=0.02)

    # Glowing neon sun ring
    add_torus("SunNeon", 0.36, 0.022, (0.28, -0.05, 0.78), pink, rot=(math.pi * 0.5, 0, 0), major_segs=28)
    # Horizon stripes
    for i, hz in enumerate([0.24, 0.34, 0.44]):
        add_box(f"Wave_{i}", (1.50 - i * 0.18, 0.03, 0.032), (0, -0.05, hz), gold if i == 1 else cyan)

    # Curved palm trunk segments + glowing cyan fronds
    trunk_pts = [(-0.42, 0.24), (-0.34, 0.46), (-0.24, 0.68), (-0.16, 0.92)]
    for i in range(len(trunk_pts) - 1):
        x0, z0 = trunk_pts[i]
        x1, z1 = trunk_pts[i + 1]
        mx, mz = (x0 + x1) * 0.5, (z0 + z1) * 0.5
        ang = math.atan2(x1 - x0, z1 - z0)
        ln = math.hypot(x1 - x0, z1 - z0)
        add_cyl(f"Trunk_{i}", 0.024, ln + 0.03, (mx, -0.06, mz), pink, verts=10, rot=(0, ang, 0))

    # 5 radiating palm fronds
    for ang in (-1.35, -0.78, -0.25, 0.45, 1.05):
        fx = -0.16 + math.sin(ang) * 0.24
        fz = 0.94 + math.cos(ang) * 0.20
        add_cyl("Frond", 0.018, 0.48, (fx, -0.07, fz), cyan, verts=10, rot=(0, ang, 0))

    export_glb("neon_palm_sign.glb")


# ─── 9. SCALLOPED ART DECO HOTEL RECEPTION DESK ──────────────────────────────
def build_hotel_reception_desk():
    clear_scene()
    marble = make_mat("DeskMarble", (0.95, 0.92, 0.87), roughness=0.16, coat=0.6)
    walnut = make_mat("DeskWalnut", (0.28, 0.15, 0.09), roughness=0.38)
    brass = make_mat("DeskBrass", (0.88, 0.70, 0.30), roughness=0.2, metallic=0.94)
    warm_lamp = make_mat("LampGlow", (1.0, 0.88, 0.62), roughness=0.2, emission=(1.0, 0.84, 0.52), emission_strength=2.5)
    screen = make_mat("ScreenBlue", (0.18, 0.68, 0.95), roughness=0.15, emission=(0.18, 0.68, 0.95), emission_strength=1.5)
    dark = make_mat("MonitorBlack", (0.05, 0.05, 0.06), roughness=0.3)

    # Main desk body + recessed plinth + overhanging marble counter top
    add_box("Plinth", (4.6, 1.25, 0.14), (0, 0, 0.07), brass, bevel_width=0.015)
    add_box("Body", (4.8, 1.35, 0.96), (0, 0, 0.62), walnut, bevel_width=0.03)
    add_box("MarbleTop", (5.05, 1.55, 0.10), (0, 0, 1.14), marble, bevel_width=0.025)

    # Art Deco fluted brass ribs across the front facade!
    for i in range(19):
        rx = -2.25 + i * 0.25
        add_cyl(f"Flute_{i}", 0.042, 0.92, (rx, -0.68, 0.62), brass, verts=12)

    # Twin Art Deco desk lamps
    for lx in (-1.85, 1.85):
        add_cyl("LampBase", 0.09, 0.05, (lx, -0.25, 1.21), brass, verts=16)
        add_cyl("LampStem", 0.018, 0.34, (lx, -0.25, 1.40), brass, verts=10)
        add_sphere("LampShade", 0.13, (lx, -0.25, 1.58), warm_lamp, scale=(1.2, 1.2, 0.75))

    # Brass concierge bell + dual check-in monitors
    add_sphere("Bell", 0.055, (0, -0.45, 1.20), brass, scale=(1.0, 1.0, 0.7))
    for mx in (-0.85, 0.85):
        add_box("MonStand", (0.14, 0.14, 0.14), (mx, 0.15, 1.25), dark)
        add_box("MonFrame", (0.52, 0.04, 0.32), (mx, 0.12, 1.44), dark, rot=(0.12, 0, 0), bevel_width=0.008)
        add_box("MonScreen", (0.46, 0.015, 0.26), (mx, 0.14, 1.44), screen, rot=(0.12, 0, 0))

    export_glb("hotel_reception_desk.glb")


# ─── 10. STOCKED COCKTAIL BAR COUNTER (SHAKERS + MARTINI GLASSES) ────────────
def build_cocktail_bar_set():
    clear_scene()
    brass = make_mat("BarBrass", (0.90, 0.72, 0.32), roughness=0.18, metallic=0.95)
    chrome = make_mat("ShakerChrome", (0.92, 0.94, 0.96), roughness=0.08, metallic=0.98)
    glass = make_mat("MartiniGlass", (0.88, 0.96, 1.0), roughness=0.05, metallic=0.1, alpha=0.45)
    lime = make_mat("CocktailLime", (0.32, 0.92, 0.45), roughness=0.1, emission=(0.25, 0.85, 0.4), emission_strength=0.35)
    pink = make_mat("CocktailCosmo", (1.0, 0.25, 0.55), roughness=0.1, emission=(0.95, 0.22, 0.5), emission_strength=0.35)
    tray = make_mat("BarTray", (0.12, 0.08, 0.06), roughness=0.3)

    # Bar serving tray with chrome cocktail shaker, ice bucket, and 4 glowing cocktail glasses!
    add_cyl("Tray", 0.42, 0.025, (0, 0, 0.012), tray, verts=28)
    add_torus("TrayRim", 0.42, 0.016, (0, 0, 0.028), brass, major_segs=28)

    # Cocktail shaker
    add_cyl("ShakerBody", 0.042, 0.18, (-0.14, -0.06, 0.12), chrome, verts=16, radius_top=0.055)
    add_cyl("ShakerCap", 0.052, 0.065, (-0.14, -0.06, 0.24), chrome, verts=16, radius_top=0.026)

    # Brass ice bucket
    add_cyl("IceBucket", 0.085, 0.19, (0.16, 0.08, 0.12), brass, verts=18, radius_top=0.105)

    # 3 Martini glasses with colorful Miami drinks
    for idx, (gx, gy, dmat) in enumerate([(-0.08, 0.18, pink), (0.06, -0.16, lime), (0.20, -0.12, pink)]):
        add_cyl(f"MBases_{idx}", 0.042, 0.008, (gx, gy, 0.03), glass, verts=14)
        add_cyl(f"MStem_{idx}", 0.006, 0.11, (gx, gy, 0.09), glass, verts=8)
        add_cyl(f"MCup_{idx}", 0.008, 0.075, (gx, gy, 0.17), glass, verts=16, radius_top=0.062)
        add_cyl(f"MDrink_{idx}", 0.01, 0.045, (gx, gy, 0.175), dmat, verts=14, radius_top=0.052)

    export_glb("cocktail_bar_set.glb")


if __name__ == "__main__":
    build_grand_piano()
    build_art_deco_fountain()
    build_dj_booth_rig()
    build_espresso_machine()
    build_pastry_display_case()
    build_neon_sculpture_arch()
    build_artist_easel()
    build_neon_palm_sign()
    build_hotel_reception_desk()
    build_cocktail_bar_set()
    print("All 10 custom Blender hero interior GLBs exported cleanly!")
