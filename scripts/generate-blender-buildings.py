"""
Generates 4 bespoke, multi-story architectural showcase landmark buildings for Sol Coast's
enterable venues using Blender 5.2+ and exports them as compact Draco-compressed GLBs
into public/assets/props/:

  1. building_hotel_solaire.glb    — Ocean Drive Streamline Moderne Art Deco Boutique Hotel (b-108: 14.7 x 22.4 x 19m, +X front)
  2. building_club_neon.glb        — Neon Strip Cyberpunk Nightclub & Rooftop Sky-Deck      (b-89:  20.4 x 24.9 x 18m, -X front)
  3. building_cafe_habana.glb      — Coral Heights Spanish Revival Villa, Arcade & Cupola   (b-30:  22.5 x 24.8 x 13m, -X front)
  4. building_wynwood_gallery.glb  — Wynwood Contemporary Sawtooth-Roof Art Museum          (b-43:  24.0 x 24.2 x 13.5m, -X front)

Materials are named semantically (PBR_Plaster_*, PBR_Marble_*, PBR_Brick_*, PBR_Concrete_*,
PBR_Terracotta_*, Glass_Warm_*, Neon_*) so Sol Coast binds real Poly Haven normal/roughness maps
and live day/night emissive lighting automatically at runtime with zero texture duplication!

Run:
  blender --background --python scripts/generate-blender-buildings.py
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


def make_mat(name, base_color, roughness=0.5, metallic=0.0, emission=None, emission_strength=0.0, coat=0.0, alpha=1.0):
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


def add_torus(name, major_r, minor_r, loc, mat, rot=(0, 0, 0), major_segs=32, minor_segs=10):
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


def add_sphere(name, radius, loc, mat, scale=(1, 1, 1), segs=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=radius, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
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


def add_rounded_slab(name, w, d, h, loc, radius, mat, segs=6):
    """Creates a Streamline Moderne rounded-corner architectural eyebrow or slab."""
    hw = w * 0.5 - radius
    hd = d * 0.5 - radius
    pts = []
    corners = [(hw, -hd, -math.pi * 0.5), (hw, hd, 0.0), (-hw, hd, math.pi * 0.5), (-hw, -hd, math.pi)]
    for cx, cy, start_a in corners:
        for i in range(segs + 1):
            a = start_a + (i / segs) * (math.pi * 0.5)
            pts.append((cx + math.cos(a) * radius, cy + math.sin(a) * radius))
    obj = add_extruded_poly(name, pts, h, 0.0, mat, bevel_width=0.04)
    obj.location = (loc[0], loc[1], loc[2] - h * 0.5)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return obj


def add_arch_opening_wall(name, span_y, height, depth_x, arch_w, arch_h, loc, mat):
    """Builds a solid wall bay along X=loc[0] with a true semicircular Spanish arch cutout!"""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    half_s = span_y * 0.5
    half_a = arch_w * 0.5
    spring_z = arch_h - half_a

    # Build 2D arch facade silhouette in (Y, Z) plane using left pier, right pier, & arch spandrel!
    # Left pier
    def quad_extrude(y0, y1, z0, z1):
        v = [
            bm.verts.new((-depth_x * 0.5, y0, z0)),
            bm.verts.new((-depth_x * 0.5, y1, z0)),
            bm.verts.new((-depth_x * 0.5, y1, z1)),
            bm.verts.new((-depth_x * 0.5, y0, z1)),
        ]
        f = bm.faces.new(v)
        g = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, verts=[x for x in g["geom"] if isinstance(x, bmesh.types.BMVert)], vec=(depth_x, 0, 0))

    quad_extrude(-half_s, -half_a, 0.0, height)
    quad_extrude(half_a, half_s, 0.0, height)

    # Curved semicircular spandrel segments above arch
    segs = 10
    for i in range(segs):
        a0 = math.pi - (i / segs) * math.pi
        a1 = math.pi - ((i + 1) / segs) * math.pi
        y0 = math.cos(a0) * half_a
        z0 = spring_z + math.sin(a0) * half_a
        y1 = math.cos(a1) * half_a
        z1 = spring_z + math.sin(a1) * half_a
        v = [
            bm.verts.new((-depth_x * 0.5, y0, z0)),
            bm.verts.new((-depth_x * 0.5, y1, z1)),
            bm.verts.new((-depth_x * 0.5, y1, height)),
            bm.verts.new((-depth_x * 0.5, y0, height)),
        ]
        f = bm.faces.new(v)
        g = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, verts=[x for x in g["geom"] if isinstance(x, bmesh.types.BMVert)], vec=(depth_x, 0, 0))

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj.location = loc
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    obj.data.materials.append(mat)
    return obj


def add_hip_roof(name, w, d, ridge_h, base_z, mat, overhang=0.65, cx=0.0, cy=0.0):
    """Creates a realistic pitched Spanish hip roof with overhanging eaves."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    hw = w * 0.5 + overhang
    hd = d * 0.5 + overhang
    inset = min(hw, hd) * 0.62
    rw = max(0.2, hw - inset)
    rd = max(0.2, hd - inset)

    b0 = bm.verts.new((cx - hw, cy - hd, base_z))
    b1 = bm.verts.new((cx + hw, cy - hd, base_z))
    b2 = bm.verts.new((cx + hw, cy + hd, base_z))
    b3 = bm.verts.new((cx - hw, cy + hd, base_z))

    t0 = bm.verts.new((cx - rw, cy - rd, base_z + ridge_h))
    t1 = bm.verts.new((cx + rw, cy - rd, base_z + ridge_h))
    t2 = bm.verts.new((cx + rw, cy + rd, base_z + ridge_h))
    t3 = bm.verts.new((cx - rw, cy + rd, base_z + ridge_h))

    bm.faces.new((b0, b1, t1, t0))
    bm.faces.new((b1, b2, t2, t1))
    bm.faces.new((b2, b3, t3, t2))
    bm.faces.new((b3, b0, t0, t3))
    bm.faces.new((t0, t1, t2, t3))
    bm.faces.new((b3, b2, b1, b0))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj.data.materials.append(mat)
    return obj


def apply_world_box_uvs(obj, tile_meters=3.2):
    """Applies clean real-world triplanar box UVs to a joined mesh so PBR textures never stretch."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv_layer = bm.loops.layers.uv.verify()
    inv = 1.0 / tile_meters
    for face in bm.faces:
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            co = loop.vert.co
            if az >= ax and az >= ay:
                u, v = co.x * inv, co.y * inv
            elif ax >= ay:
                u, v = co.y * inv, co.z * inv
            else:
                u, v = co.x * inv, co.z * inv
            loop[uv_layer].uv = (u, v)
    bm.to_mesh(mesh)
    bm.free()


def export_building_glb(filename):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    # Keep exact world-aligned X/Y center (0, 0) and exact Z=0 ground plane!
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()

    joined = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    apply_world_box_uvs(joined, tile_meters=3.2)

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
    print(f"[blender-building] {filename}: {sz:.1f} KB")


# ─── 1. HOTEL SOLAIRE (OCEAN DRIVE — STREAMLINE MODERNE ART DECO SHOWCASE) ──
# Footprint b-108: width=14.7 (X), depth=22.4 (Y), Ocean Drive front = +X (+7.35)
def build_hotel_solaire():
    clear_scene()
    stucco_cream = make_mat("PBR_Plaster_Cream", (0.98, 0.93, 0.88), roughness=0.72)
    stucco_coral = make_mat("PBR_Plaster_Coral", (0.98, 0.75, 0.78), roughness=0.72)
    marble = make_mat("PBR_Marble_Lobby", (0.95, 0.91, 0.85), roughness=0.22, coat=0.5)
    brass = make_mat("Metal_Brass", (0.90, 0.72, 0.30), roughness=0.20, metallic=0.94)
    dark_bronze = make_mat("Metal_Bronze", (0.18, 0.15, 0.14), roughness=0.32, metallic=0.82)
    warm_glass = make_mat("Glass_Warm_Hotel", (1.0, 0.85, 0.62), roughness=0.08, metallic=0.15, emission=(1.0, 0.78, 0.45), emission_strength=1.1, coat=1.0)
    lobby_glass = make_mat("Glass_Lobby_Hotel", (1.0, 0.88, 0.68), roughness=0.05, metallic=0.1, emission=(1.0, 0.82, 0.52), emission_strength=1.45, coat=1.0)
    neon_pink = make_mat("Neon_Pink", (1.0, 0.36, 0.65), roughness=0.1, emission=(1.0, 0.32, 0.62), emission_strength=3.5)
    neon_cyan = make_mat("Neon_Cyan", (0.18, 0.94, 1.0), roughness=0.1, emission=(0.15, 0.92, 1.0), emission_strength=3.2)
    carpet = make_mat("Fabric_Carpet", (0.58, 0.08, 0.16), roughness=0.88)
    balcony_glass = make_mat("Glass_Railing", (0.72, 0.90, 0.96), roughness=0.08, metallic=0.1, alpha=0.45, coat=1.0)

    w, d = 14.5, 22.2
    front_x = w * 0.5  # +7.25

    # 1. Ground-floor recessed travertine lobby plinth + colonnade (z = 0..4.5m)
    add_box("GroundCore", (w - 1.6, d - 1.0, 4.5), (-0.8, 0, 2.25), marble, bevel_width=0.04)
    # Recessed grand glowing glass lobby curtain wall across Ocean Drive (+X) facade
    add_box("LobbyGlassWall", (0.25, 16.5, 3.8), (front_x - 1.45, 0, 2.1), lobby_glass)
    # Double brass-framed grand hotel entrance doors right at center (y=0)
    add_box("DoorFrameOuter", (0.4, 3.6, 3.2), (front_x - 1.25, 0, 1.6), brass, bevel_width=0.03)
    add_box("DoorGlass", (0.45, 3.1, 2.85), (front_x - 1.22, 0, 1.48), lobby_glass)
    add_box("DoorCenterMullion", (0.5, 0.12, 2.9), (front_x - 1.20, 0, 1.48), brass)
    for hy in (-0.28, 0.28):
        add_cyl("DoorHandle", 0.03, 0.7, (front_x - 0.94, hy, 1.35), brass, verts=10)

    # Fluted travertine Art Deco colonnade pillars along the front veranda
    for py in (-9.6, -6.2, -2.5, 2.5, 6.2, 9.6):
        add_cyl(f"Col_{py}", 0.36, 4.4, (front_x - 0.35, py, 2.2), marble, verts=16)
        add_cyl(f"ColCap_{py}", 0.44, 0.24, (front_x - 0.35, py, 4.3), brass, verts=16)
        add_cyl(f"ColBase_{py}", 0.44, 0.24, (front_x - 0.35, py, 0.12), brass, verts=16)

    # Grand Stepped Streamline Moderne Porte-Cochère Marquee Canopy projecting over Ocean Drive sidewalk!
    add_rounded_slab("MarqueeMain", 4.2, 8.2, 0.55, (front_x + 1.1, 0, 4.45), 0.75, stucco_coral)
    add_rounded_slab("MarqueeUpper", 3.4, 6.8, 0.32, (front_x + 0.9, 0, 4.86), 0.65, stucco_cream)
    add_rounded_slab("MarqueeNeon", 4.35, 8.35, 0.12, (front_x + 1.1, 0, 4.45), 0.78, neon_pink)
    # Red velvet entrance carpet running cleanly out from the lobby doors onto the sidewalk
    add_box("RedCarpet", (4.6, 3.0, 0.04), (front_x + 0.95, 0, 0.02), carpet)

    # 2. Upper Hotel Floors (Floors 2, 3, 4: z = 4.5 .. 14.4m) with iconic curved Art Deco Eyebrow Visors!
    add_rounded_slab("UpperBody", w, d, 9.9, (0, 0, 9.45), 1.35, stucco_cream)
    # Iconic horizontal Streamline Moderne coral-pink wrap-around eyebrows at every floor slab!
    for fz in (4.65, 7.95, 11.25, 14.55):
        add_rounded_slab(f"Eyebrow_{fz}", w + 1.35, d + 1.25, 0.34, (0.2, 0, fz), 1.6, stucco_coral)
        add_rounded_slab(f"EyebrowNeon_{fz}", w + 1.46, d + 1.36, 0.09, (0.2, 0, fz + 0.14), 1.65, neon_cyan if fz > 10 else neon_pink)

    # Recessed Upper-Floor Oceanfront Suite Windows & Glass/Brass Juliet Balconies!
    for fz in (6.15, 9.45, 12.75):
        for wy in (-7.4, -3.7, 0.0, 3.7, 7.4):
            # Ocean Drive front (+X) windows & curved Juliet balconies
            add_box("WinFrame", (0.35, 2.35, 2.15), (front_x - 0.05, wy, fz), dark_bronze)
            add_box("WinGlass", (0.42, 2.15, 1.95), (front_x - 0.02, wy, fz), warm_glass)
            if abs(wy) > 1.5:
                # Projecting Juliet balcony slab + glass rail + brass handrail
                add_box("BalcSlab", (1.0, 2.7, 0.18), (front_x + 0.45, wy, fz - 1.15), stucco_cream, bevel_width=0.03)
                add_box("BalcGlass", (0.06, 2.55, 0.95), (front_x + 0.90, wy, fz - 0.62), balcony_glass)
                add_box("BalcRail", (0.08, 2.65, 0.06), (front_x + 0.90, wy, fz - 0.14), brass)
            # Rear (-X) suite windows
            add_box("RearWin", (0.35, 2.1, 1.85), (-front_x + 0.05, wy, fz), warm_glass)
        # Side North/South windows
        for side_y in (-d * 0.5, d * 0.5):
            for wx in (-4.0, 0.0, 4.0):
                add_box("SideWin", (2.1, 0.35, 1.85), (wx, side_y, fz), warm_glass)

    # 3. Iconic Stepped Art Deco Wedding-Cake Crown Tower & Neon Vertical Fins (z = 14.5 .. 19.2m)!
    add_rounded_slab("CrownTier1", 7.8, 9.6, 2.4, (2.2, 0, 15.8), 0.9, stucco_cream)
    add_rounded_slab("CrownTier2", 5.2, 6.2, 2.1, (2.6, 0, 18.0), 0.7, stucco_coral)
    # 3 vertical Art Deco fluted speed-fins running up the center of the Ocean Drive facade!
    for fy in (-1.2, 0.0, 1.2):
        add_box(f"CenterFin_{fy}", (0.75, 0.26, 14.4), (front_x + 0.22, fy, 12.1), stucco_cream, bevel_width=0.03)
        add_box(f"CenterFinNeon_{fy}", (0.14, 0.12, 13.8), (front_x + 0.58, fy, 12.1), neon_pink)
    # Rooftop golden Art Deco sunburst spire
    add_cyl("RoofSpire", 0.22, 3.2, (2.6, 0, 20.5), brass, verts=16, r2=0.04)
    add_torus("SpireRing1", 0.65, 0.07, (2.6, 0, 19.6), neon_cyan, major_segs=24)
    add_torus("SpireRing2", 0.42, 0.06, (2.6, 0, 20.3), neon_pink, major_segs=24)

    export_building_glb("building_hotel_solaire.glb")


# ─── 2. CLUB NEON (NEON STRIP — CYBERPUNK NIGHTCLUB & ROOFTOP SKY-DECK) ──────
# Footprint b-89: width=20.4 (X), depth=24.9 (Y), Neon Strip front = -X (-10.2)
def build_club_neon():
    clear_scene()
    obsidian = make_mat("PBR_Concrete_Obsidian", (0.09, 0.09, 0.13), roughness=0.42, metallic=0.25)
    slate = make_mat("PBR_Concrete_Slate", (0.16, 0.15, 0.22), roughness=0.52, metallic=0.18)
    steel = make_mat("Metal_DarkSteel", (0.12, 0.14, 0.18), roughness=0.28, metallic=0.88)
    brass = make_mat("Metal_ClubBrass", (0.90, 0.72, 0.30), roughness=0.2, metallic=0.92)
    velvet = make_mat("Fabric_Velvet", (0.72, 0.08, 0.28), roughness=0.75)
    neon_pink = make_mat("Neon_ClubPink", (1.0, 0.14, 0.56), roughness=0.1, emission=(1.0, 0.14, 0.56), emission_strength=4.0)
    neon_cyan = make_mat("Neon_ClubCyan", (0.12, 0.95, 1.0), roughness=0.1, emission=(0.12, 0.95, 1.0), emission_strength=4.0)
    neon_purple = make_mat("Neon_ClubPurple", (0.68, 0.25, 1.0), roughness=0.1, emission=(0.68, 0.25, 1.0), emission_strength=3.6)
    club_glass = make_mat("Glass_ClubGlow", (0.72, 0.15, 0.95), roughness=0.06, metallic=0.2, emission=(0.55, 0.12, 0.82), emission_strength=1.4, coat=1.0)
    sky_glass = make_mat("Glass_SkyDeck", (0.15, 0.82, 0.95), roughness=0.08, alpha=0.42, coat=1.0)

    w, d = 20.2, 24.6
    front_x = -w * 0.5  # -10.1

    # 1. Monolithic dark architectural concrete club hull (z = 0..14.8m)
    add_box("ClubCore", (w - 0.8, d - 0.6, 14.8), (0.4, 0, 7.4), obsidian, bevel_width=0.06)

    # Vertical fluted architectural acoustic steel ribs along ALL facades!
    for ry in range(-11, 12, 2):
        if abs(ry) > 4.2:
            add_box(f"FrontRib_{ry}", (0.45, 0.36, 14.4), (front_x + 0.1, ry, 7.2), slate, bevel_width=0.02)
            # Glowing vertical equalizer neon strips embedded between facade ribs!
            eq_h = 6.5 + ((abs(ry) * 3) % 7) * 1.05
            add_box(
                f"EqNeon_{ry}",
                (0.14, 0.14, eq_h),
                (front_x - 0.1, ry + 0.85, 2.0 + eq_h * 0.5),
                neon_cyan if (abs(ry) % 4 == 1) else neon_pink,
            )
    for rx in range(-8, 9, 3):
        for sy in (-d * 0.5, d * 0.5):
            add_box("SideRib", (0.4, 0.45, 14.4), (rx, sy, 7.2), slate)

    # 2. Dramatic Cantilevered Angular Nightclub Entrance Canopy & Concentric Neon Portal Arch!
    add_box("OverhangDeck", (4.6, 14.0, 0.9), (front_x - 1.4, 0, 5.2), steel, bevel_width=0.05)
    add_box("OverhangTopBlade", (5.2, 14.6, 0.16), (front_x - 1.6, 0, 5.65), neon_pink)
    add_box("OverhangBotBlade", (4.8, 14.2, 0.12), (front_x - 1.5, 0, 4.74), neon_cyan)

    # Concentric recessed neon portal arch frames leading into the double doors!
    for idx, (ox, span_y, h, mat) in enumerate([
        (front_x - 0.9, 6.2, 4.4, neon_cyan),
        (front_x - 0.4, 5.2, 4.0, neon_pink),
        (front_x + 0.1, 4.2, 3.6, neon_purple),
    ]):
        add_box(f"PortalTop_{idx}", (0.28, span_y, 0.22), (ox, 0, h), mat)
        for sy in (-span_y * 0.5, span_y * 0.5):
            add_box(f"PortalLeg_{idx}_{sy}", (0.28, 0.22, h), (ox, sy, h * 0.5), mat)

    # Recessed glowing magenta/purple tinted club double doors
    add_box("ClubDoorFrame", (0.35, 3.4, 3.1), (front_x + 0.3, 0, 1.55), steel)
    add_box("ClubDoorGlass", (0.40, 3.0, 2.8), (front_x + 0.26, 0, 1.45), club_glass)
    add_box("ClubDoorBar", (0.45, 0.12, 2.85), (front_x + 0.22, 0, 1.45), steel)

    # VIP Velvet Rope Stanchion Entry Lane right on the front threshold!
    for sy in (-1.85, 1.85):
        for sx in (front_x - 0.6, front_x - 2.1):
            add_cyl("Stanchion", 0.045, 0.95, (sx, sy, 0.48), brass, verts=10)
            add_cyl("StanchBase", 0.16, 0.05, (sx, sy, 0.025), brass, verts=12)
        add_cyl("VelvetRope", 0.032, 1.5, (front_x - 1.35, sy, 0.78), velvet, verts=8, rot=(0, math.pi * 0.5, 0))

    # 3. Upper Giant Architectural Marquee Light-Box + Rooftop VIP Sky-Deck (z = 14.8 .. 18.6m)!
    add_box("UpperCrownFrame", (1.2, 16.0, 3.2), (front_x - 0.25, 0, 12.6), steel, bevel_width=0.05)
    add_box("UpperCrownGlow", (0.25, 15.2, 0.14), (front_x - 0.88, 0, 14.2), neon_cyan)
    add_box("UpperCrownGlowB", (0.25, 15.2, 0.14), (front_x - 0.88, 0, 11.0), neon_pink)

    # Rooftop glass balustrade + VIP sky-lounge canopy!
    add_box("RoofGlassW", (0.12, d - 1.2, 1.4), (front_x + 0.5, 0, 15.5), sky_glass)
    add_box("RoofRailW", (0.16, d - 1.1, 0.08), (front_x + 0.5, 0, 16.24), neon_cyan)
    add_box("SkyCanopy", (7.5, 12.0, 0.35), (1.0, 0, 18.2), steel, bevel_width=0.04)
    add_box("SkyCanopyRim", (7.6, 12.1, 0.12), (1.0, 0, 18.02), neon_purple)
    for cx in (-2.4, 4.4):
        for cy in (-5.4, 5.4):
            add_cyl("SkyPillar", 0.16, 3.4, (cx, cy, 16.5), steel, verts=12)

    export_building_glb("building_club_neon.glb")


# ─── 3. CAFÉ HABANA (CORAL HEIGHTS — SPANISH MEDITERRANEAN VILLA & ARCADE) ──
# Footprint b-30: width=22.5 (X), depth=24.8 (Y), Coral Heights front = -X (-11.25)
def build_cafe_habana():
    clear_scene()
    stucco = make_mat("PBR_Plaster_Stucco", (0.96, 0.86, 0.72), roughness=0.78)
    ochre = make_mat("PBR_Plaster_Ochre", (0.90, 0.72, 0.52), roughness=0.78)
    terracotta = make_mat("PBR_Terracotta_Roof", (0.74, 0.31, 0.19), roughness=0.62)
    wood = make_mat("PBR_Parquet_Timber", (0.34, 0.19, 0.11), roughness=0.55)
    iron = make_mat("Metal_WroughtIron", (0.11, 0.11, 0.13), roughness=0.38, metallic=0.82)
    awning_cream = make_mat("Fabric_AwningCream", (0.96, 0.91, 0.82), roughness=0.78)
    awning_terra = make_mat("Fabric_AwningTerra", (0.76, 0.26, 0.18), roughness=0.78)
    warm_glass = make_mat("Glass_Warm_Cafe", (1.0, 0.86, 0.60), roughness=0.08, emission=(1.0, 0.80, 0.44), emission_strength=1.25, coat=1.0)
    hedge = make_mat("Foliage_Box", (0.16, 0.44, 0.20), roughness=0.85)
    blossom = make_mat("Foliage_Bougainvillea", (0.94, 0.20, 0.52), roughness=0.65)

    w, d = 22.0, 24.4
    front_x = -w * 0.5  # -11.0

    # 1. Ground-floor Spanish Revival Main Volume + 5-Bay Arched Colonnade Arcade on West (-X) Streetfront!
    add_box("VillaCore", (w - 2.2, d - 0.8, 8.6), (1.1, 0, 4.3), stucco, bevel_width=0.05)

    # Recessed glowing ground-floor café storefront windows + carved mahogany French double doors behind the arches!
    add_box("CafeInnerWall", (0.3, d - 2.2, 4.0), (front_x + 2.0, 0, 2.0), ochre)
    add_box("CafeFrontDoors", (0.35, 3.0, 3.0), (front_x + 1.85, 0, 1.5), wood)
    add_box("CafeDoorPanes", (0.40, 2.4, 2.3), (front_x + 1.82, 0, 1.65), warm_glass)
    for wy in (-8.4, -4.2, 4.2, 8.4):
        add_box(f"CafeBayWin_{wy}", (0.38, 2.8, 2.5), (front_x + 1.84, wy, 1.85), warm_glass)
        add_box(f"CafeWinSill_{wy}", (0.55, 3.1, 0.18), (front_x + 1.75, wy, 0.62), terracotta, bevel_width=0.02)

    # 5 Real Semicircular Spanish Stucco Arches forming the iconic streetfront colonnade arcade!
    bay_span = 4.2
    for bi in range(-2, 3):
        by = bi * bay_span
        add_arch_opening_wall(
            f"ArcadeArch_{bi}",
            bay_span,
            4.5,
            0.55,
            3.1,
            3.75,
            (front_x + 0.3, by, 0.0),
            stucco,
        )
        # Striped terracotta & cream sloped café canvas awning projecting out over each arch!
        add_box(
            f"AwningBase_{bi}",
            (1.65, 3.5, 0.16),
            (front_x - 0.72, by, 3.92),
            awning_terra,
            rot=(0, -0.36, 0),
        )
        for st in (-1.05, 0.0, 1.05):
            add_box(
                f"AwningStripe_{bi}_{st}",
                (1.67, 0.58, 0.18),
                (front_x - 0.72, by + st, 3.93),
                awning_cream,
                rot=(0, -0.36, 0),
            )

    # Arcade loggia ceiling slab + decorative cornice molding between floors
    add_box("ArcadeRoof", (2.6, d - 0.4, 0.35), (front_x + 1.3, 0, 4.45), ochre, bevel_width=0.04)
    add_box("BeltCornice", (w + 0.5, d + 0.5, 0.28), (0, 0, 4.55), terracotta, bevel_width=0.03)

    # 2. Second Floor Mediterranean Shuttered Windows & Wrought-Iron Juliet Balconies with Bougainvillea!
    add_box("SecondFloorFront", (2.2, d - 0.8, 4.1), (front_x + 1.1, 0, 6.65), stucco, bevel_width=0.04)
    for wy in (-8.4, -4.2, 0.0, 4.2, 8.4):
        add_box("UpperWin", (0.35, 1.75, 2.2), (front_x + 0.05, wy, 6.45), warm_glass)
        # Dark timber louvered shutters flanking each window
        for sh in (-1.15, 1.15):
            add_box("Shutter", (0.14, 0.55, 2.25), (front_x - 0.06, wy + sh, 6.45), wood)
        # Wrought-iron Juliet balcony + terracotta flower box + magenta bougainvillea blossoms!
        add_box("JulietBase", (0.75, 2.4, 0.14), (front_x - 0.35, wy, 5.28), terracotta, bevel_width=0.02)
        add_box("JulietRailTop", (0.06, 2.35, 0.06), (front_x - 0.68, wy, 6.15), iron)
        for bx in (-1.05, -0.65, -0.25, 0.25, 0.65, 1.05):
            add_cyl("Baluster", 0.02, 0.85, (front_x - 0.68, wy + bx, 5.72), iron, verts=6)
        # Flower planter box with vibrant bougainvillea!
        add_box("FlowerBox", (0.32, 1.6, 0.28), (front_x - 0.48, wy, 5.48), terracotta)
        add_box("FlowerHedge", (0.28, 1.5, 0.24), (front_x - 0.48, wy, 5.68), hedge)
        for fl in (-0.5, 0.0, 0.5):
            add_sphere("Blossom", 0.16, (front_x - 0.54, wy + fl, 5.80), blossom)

    # Side & rear Mediterranean windows
    for wx in (-6.0, 0.0, 6.0):
        for sy in (-d * 0.5 + 0.35, d * 0.5 - 0.35):
            add_box("SideWinL", (2.0, 0.35, 2.1), (wx, sy, 2.2), warm_glass)
            add_box("SideWinU", (1.7, 0.35, 2.0), (wx, sy, 6.4), warm_glass)

    # 3. Pitched Terracotta Barrel-Tile Hip Roof + Exposed Dark Timber Eave Corbels + Corner Roastery Bell Cupola!
    add_hip_roof("MainSpanishRoof", w, d, 3.2, 8.65, terracotta, overhang=0.85)
    # Exposed dark timber corbel beams beneath eaves along front & sides
    for cy in range(-11, 12, 2):
        add_box(f"CorbelW_{cy}", (0.95, 0.18, 0.24), (front_x - 0.32, cy, 8.48), wood)

    # Charming Southwest Corner Arched Cupola / Roastery Tower rising to 13.6m!
    cup_x, cup_y = front_x + 3.2, -d * 0.5 + 3.2
    add_box("CupolaBase", (4.4, 4.4, 3.2), (cup_x, cup_y, 10.6), ochre, bevel_width=0.04)
    for ang_y in (-2.22, 2.22):
        add_box("CupolaWinY", (1.6, 0.25, 1.8), (cup_x, cup_y + ang_y, 10.9), warm_glass)
    for ang_x in (-2.22, 2.22):
        add_box("CupolaWinX", (0.25, 1.6, 1.8), (cup_x + ang_x, cup_y, 10.9), warm_glass)
    add_hip_roof("CupolaRoof", 4.6, 4.6, 1.8, 12.15, terracotta, overhang=0.45, cx=cup_x, cy=cup_y)
    add_cyl("CupolaFinial", 0.05, 1.1, (cup_x, cup_y, 14.4), iron, verts=8)

    export_building_glb("building_cafe_habana.glb")


# ─── 4. WYNWOOD ART GALLERY (CONTEMPORARY SAWTOOTH-ROOF MUSEUM SHOWCASE) ─────
# Footprint b-43: width=24.0 (X), depth=24.2 (Y), Wynwood Arts front = -X (-12.0)
def build_wynwood_gallery():
    clear_scene()
    white_concrete = make_mat("PBR_Plaster_MuseumWhite", (0.95, 0.96, 0.98), roughness=0.62)
    arch_concrete = make_mat("PBR_Concrete_Museum", (0.64, 0.66, 0.70), roughness=0.68)
    black_steel = make_mat("Metal_BlackSteel", (0.09, 0.10, 0.13), roughness=0.30, metallic=0.85)
    chrome = make_mat("Metal_ChromeArt", (0.94, 0.96, 0.99), roughness=0.06, metallic=0.99)
    gallery_glass = make_mat("Glass_GalleryBright", (1.0, 0.97, 0.91), roughness=0.05, metallic=0.1, emission=(0.98, 0.94, 0.85), emission_strength=1.35, coat=1.0)
    skylight_glass = make_mat("Glass_Skylight", (0.85, 0.95, 1.0), roughness=0.08, emission=(0.75, 0.88, 1.0), emission_strength=0.9, coat=1.0)
    neon_gold = make_mat("Neon_GalleryGold", (1.0, 0.80, 0.25), roughness=0.1, emission=(1.0, 0.80, 0.25), emission_strength=3.2)
    mural_magenta = make_mat("Art_MuralMagenta", (0.95, 0.18, 0.55), roughness=0.45)
    mural_cyan = make_mat("Art_MuralCyan", (0.12, 0.85, 0.95), roughness=0.45)
    mural_gold = make_mat("Art_MuralGold", (1.0, 0.76, 0.16), roughness=0.45)

    w, d = 23.6, 23.8
    front_x = -w * 0.5  # -11.8

    # 1. Crisp White-Cube Museum Main Massing + Board-Formed Concrete Plinth (z = 0..8.8m)
    add_box("MuseumPlinth", (w, d, 0.5), (0, 0, 0.25), arch_concrete, bevel_width=0.04)
    add_box("MuseumBody", (w - 1.2, d - 0.6, 8.3), (0.6, 0, 4.65), white_concrete, bevel_width=0.05)

    # 2. Iconic 3-Bay Industrial Sawtooth North-Light Skylight Roof (z = 8.8 .. 12.6m)!
    bay_w = (w - 1.6) / 3.0
    for bi in range(3):
        bx0 = -w * 0.5 + 1.0 + bi * bay_w
        bx1 = bx0 + bay_w
        mesh = bpy.data.meshes.new(f"Sawtooth_{bi}")
        obj = bpy.data.objects.new(f"Sawtooth_{bi}", mesh)
        bpy.context.collection.objects.link(obj)
        bm = bmesh.new()
        hy = (d - 0.8) * 0.5
        # Triangular prism profile: vertical glazed clerestory facing -X (bx0), sloped roof down to bx1
        pts_xz = [(bx0, 8.8), (bx1, 8.8), (bx0, 12.2)]
        front_v = [bm.verts.new((px, -hy, pz)) for (px, pz) in pts_xz]
        face = bm.faces.new(front_v)
        g = bmesh.ops.extrude_face_region(bm, geom=[face])
        bmesh.ops.translate(bm, verts=[x for x in g["geom"] if isinstance(x, bmesh.types.BMVert)], vec=(0, hy * 2.0, 0))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        obj.data.materials.append(arch_concrete)

        # Glowing clerestory skylight glass ribbon along the vertical face of each sawtooth!
        add_box(f"ClerestoryGlass_{bi}", (0.14, d - 1.6, 2.75), (bx0 - 0.05, 0, 10.45), skylight_glass)
        for my in range(-10, 11, 4):
            add_box(f"ClerestoryMull_{bi}_{my}", (0.22, 0.14, 3.0), (bx0 - 0.08, my, 10.45), black_steel)

    # 3. Dramatic Cantilevered Black-Steel & Glass Museum Entrance Pavilion on West (-X) Facade!
    add_box("CantileverCanopy", (4.8, 12.6, 0.65), (front_x - 1.2, 0, 6.2), black_steel, bevel_width=0.04)
    add_box("CantileverGlow", (4.9, 12.7, 0.10), (front_x - 1.22, 0, 5.84), neon_gold)
    # Double-height museum glass curtain wall with crisp black steel grid mullions!
    add_box("CurtainGlass", (0.25, 11.4, 5.6), (front_x + 0.15, 0, 3.1), gallery_glass)
    for my in (-5.7, -3.8, -1.9, 0.0, 1.9, 3.8, 5.7):
        add_box(f"CurtainMullV_{my}", (0.36, 0.14, 5.8), (front_x + 0.08, my, 3.1), black_steel)
    for mz in (3.0, 5.8):
        add_box(f"CurtainMullH_{mz}", (0.36, 11.6, 0.14), (front_x + 0.08, 0, mz), black_steel)

    # 4. Outdoor Streetfront Sculpture Alcove + Oversized Chrome & Neon Modernist Ribbon Sculpture!
    add_box("AlcovePlinth", (2.4, 4.6, 0.55), (front_x - 0.4, 8.2, 0.52), arch_concrete, bevel_width=0.03)
    add_torus("OutdoorArtOuter", 1.55, 0.14, (front_x - 0.4, 8.2, 2.65), chrome, rot=(0.45, 1.15, 0.35), major_segs=36)
    add_torus("OutdoorArtInner", 1.05, 0.08, (front_x - 0.4, 8.2, 2.65), neon_gold, rot=(-0.6, 0.4, 0.8), major_segs=32)

    # 5. Recessed Geometric Wynwood Street-Art Relief Mural Bays flanking the South & North Gallery Walls!
    # Left front flank (-Y on -X wall) bold 3D geometric pop-art relief installation!
    add_box("FrontArtFrame", (0.35, 5.0, 5.2), (front_x + 0.1, -8.4, 3.6), black_steel, bevel_width=0.03)
    add_box("FrontArtBg", (0.38, 4.5, 4.7), (front_x + 0.06, -8.4, 3.6), arch_concrete)
    add_cyl("FrontArtSun", 1.25, 0.18, (front_x - 0.08, -8.4, 4.2), mural_gold, verts=24, rot=(0, math.pi * 0.5, 0))
    add_box("FrontArtStripe1", (0.22, 4.1, 0.62), (front_x - 0.10, -8.4, 2.55), mural_magenta)
    add_box("FrontArtStripe2", (0.22, 3.6, 0.52), (front_x - 0.10, -8.4, 1.85), mural_cyan)

    # Large geometric sculptural mural relief panels on North & South exterior gallery walls
    for sy_sign in (-1, 1):
        sy = sy_sign * (d * 0.5 - 0.25)
        for mx, col_a, col_b in [(-4.2, mural_magenta, mural_cyan), (4.6, mural_cyan, mural_gold)]:
            add_box("SideMuralFrame", (6.8, 0.35, 5.2), (mx, sy, 4.4), black_steel, bevel_width=0.03)
            add_box("SideMuralBg", (6.3, 0.42, 4.7), (mx, sy, 4.4), col_a)
            add_box("SideMuralAccent", (2.8, 0.48, 2.8), (mx + 1.1, sy, 4.6), col_b, rot=(0, 0.35, 0))

    export_building_glb("building_wynwood_gallery.glb")


if __name__ == "__main__":
    build_hotel_solaire()
    build_club_neon()
    build_cafe_habana()
    build_wynwood_gallery()
    print("All 4 bespoke Blender showcase buildings exported cleanly!")
