"""
Generates bespoke Blender 5.2 Hotel Solaire 2F Commercial Ice Machine GLB (Sweep Batch 4):
  - hotel_ice_machine.glb — Brushed stainless steel hotel corridor ice dispenser (0.92m x 1.72m x 0.68m)
    with recessed ice chute bay, stainless push-paddle, perforated drip tray, cooling louver grille,
    illuminated cyan status strip, ice bucket shelf, and adjustable leveling feet.

Run:
  blender --background --python scripts/generate-blender-ice-machine.py
"""
import os
import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "public", "assets", "props"))
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, base_color, roughness=0.45, metallic=0.0, emission=None, emission_strength=0.0, coat=0.0):
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


def add_cyl(name, r1, depth, loc, mat, verts=16, rot=(0, 0, 0), r2=None):
    if r2 is not None:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r1, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def build_hotel_ice_machine():
    clear_scene()
    steel = make_mat("IceSteel", (0.76, 0.80, 0.85), roughness=0.24, metallic=0.90)
    steel_dark = make_mat("IceSteelDark", (0.28, 0.31, 0.36), roughness=0.38, metallic=0.80)
    black = make_mat("IceRecess", (0.07, 0.08, 0.11), roughness=0.42, metallic=0.25)
    chrome = make_mat("IceChrome", (0.90, 0.93, 0.96), roughness=0.14, metallic=0.96)
    brass = make_mat("IceBrass", (0.88, 0.70, 0.30), roughness=0.22, metallic=0.92)
    cyan_glow = make_mat("IceCyanGlow", (0.20, 0.94, 1.0), roughness=0.1, emission=(0.18, 0.95, 1.0), emission_strength=2.8)
    bucket_mat = make_mat("IceBucket", (0.95, 0.96, 0.98), roughness=0.22, coat=0.6)

    # Faces -Y in Blender -> +Z in glTF (facing straight out into the 2F Hotel Corridor!)
    # 4 heavy commercial rubber/steel leveling feet (z = 0..0.10m)
    for lx in (-0.38, 0.38):
        for ly in (-0.26, 0.26):
            add_cyl(f"Foot_{lx}_{ly}", 0.036, 0.10, (lx, ly, 0.05), steel_dark, verts=12)

    # Lower dispenser base cabinet (z = 0.10..0.82m) + upper ice-maker condenser head (z = 1.24..1.72m)
    add_box("LowerBody", (0.90, 0.66, 0.72), (0, 0, 0.46), steel, bevel_width=0.018)
    add_box("UpperHead", (0.92, 0.68, 0.48), (0, 0, 1.48), steel, bevel_width=0.020)

    # Recessed central dispensing bay (z = 0.82..1.24m) framed by left/right side pillars + back wall
    add_box("BayBack", (0.86, 0.44, 0.44), (0, 0.11, 1.03), steel_dark)
    add_box("BayPillarL", (0.16, 0.66, 0.44), (-0.37, 0, 1.03), steel, bevel_width=0.014)
    add_box("BayPillarR", (0.16, 0.66, 0.44), (0.37, 0, 1.03), steel, bevel_width=0.014)
    add_box("BayInsetBack", (0.58, 0.04, 0.42), (0, -0.11, 1.03), black)

    # Stainless drain tray shelf + slotted grate + stainless ice chute & push-lever paddle!
    add_box("DrainShelf", (0.60, 0.26, 0.045), (0, -0.22, 0.82), steel_dark, bevel_width=0.008)
    for gx in range(-4, 5):
        add_box(f"Grate_{gx}", (0.024, 0.20, 0.014), (gx * 0.06, -0.22, 0.848), chrome)
    # Angled dispensing chute + chrome push paddle
    add_cyl("IceChute", 0.062, 0.16, (0, -0.17, 1.18), chrome, verts=14, rot=(0.24, 0, 0))
    add_box("PushPaddle", (0.18, 0.024, 0.16), (0, -0.135, 1.02), chrome, rot=(-0.10, 0, 0), bevel_width=0.006)
    # Small complimentary chilled ice bucket sitting neatly on the left side of the bay shelf
    add_cyl("Bucket", 0.072, 0.14, (-0.18, -0.22, 0.92), bucket_mat, verts=16, r2=0.082)
    add_cyl("BucketRim", 0.084, 0.018, (-0.18, -0.22, 0.99), brass, verts=16)

    # Upper front Art Deco control header bezel + glowing cyan status LED bar + cooling louvers!
    add_box("HeaderBezel", (0.82, 0.035, 0.18), (0, -0.34, 1.54), black, bevel_width=0.008)
    add_box("HeaderTrim", (0.84, 0.02, 0.20), (0, -0.332, 1.54), brass)
    add_box("StatusLED", (0.56, 0.025, 0.022), (0, -0.352, 1.48), cyan_glow)
    # Power & dispense indicator buttons
    add_cyl("BtnIce", 0.022, 0.025, (-0.28, -0.352, 1.56), cyan_glow, verts=12, rot=(math.pi * 0.5, 0, 0))
    add_cyl("BtnWater", 0.022, 0.025, (-0.20, -0.352, 1.56), chrome, verts=12, rot=(math.pi * 0.5, 0, 0))

    # Horizontal louvered cooling vents on lower front panel & upper side panels
    for i in range(6):
        add_box(f"FrontLouver_{i}", (0.68, 0.025, 0.026), (0, -0.334, 0.22 + i * 0.065), steel_dark, rot=(0.35, 0, 0))
    for sx in (-0.462, 0.462):
        for i in range(4):
            add_box(f"SideLouver_{sx}_{i}", (0.02, 0.42, 0.026), (sx, 0, 1.34 + i * 0.075), steel_dark)

    # Normalize floor to z=0 and center XY
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
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    out_path = os.path.join(OUT_DIR, "hotel_ice_machine.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_materials="EXPORT",
    )
    print(f"[blender-ice] hotel_ice_machine.glb: {os.path.getsize(out_path) / 1024.0:.1f} KB")


import math

if __name__ == "__main__":
    build_hotel_ice_machine()
