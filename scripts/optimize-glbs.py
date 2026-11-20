#!/usr/bin/env python3
"""
Optimizes embedded high-res PNG textures inside GLB 2.0 files (downscaling >1024px
and converting opaque textures to quality-85 JPEG while preserving PNG alpha maps
such as hair/eyelashes/eyebrows). Keeps all meshes, rigs, and animations intact.
"""
import io
import json
import os
import struct
import sys
from PIL import Image


def pad4(data: bytes, fill: bytes = b"\x00") -> bytes:
    rem = len(data) % 4
    return data if rem == 0 else data + fill * (4 - rem)


def optimize_glb(path: str, max_dim: int = 1024) -> None:
    raw = open(path, "rb").read()
    magic, version, _total_len = struct.unpack_from("<4sII", raw, 0)
    assert magic == b"glTF" and version == 2, f"Not a valid GLB 2.0: {path}"

    json_len, json_type = struct.unpack_from("<I4s", raw, 12)
    assert json_type == b"JSON"
    gltf = json.loads(raw[20 : 20 + json_len].decode("utf-8"))

    bin_offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<I4s", raw, bin_offset)
    assert bin_type == b"BIN\x00"
    bin_data = raw[bin_offset + 8 : bin_offset + 8 + bin_len]

    image_bv_map = {}
    for idx, img_def in enumerate(gltf.get("images", [])):
        if "bufferView" in img_def:
            image_bv_map[img_def["bufferView"]] = idx

    new_chunks = []
    cur_offset = 0

    for bv_idx, bv in enumerate(gltf.get("bufferViews", [])):
        start = bv.get("byteOffset", 0)
        length = bv["byteLength"]
        chunk = bin_data[start : start + length]

        if bv_idx in image_bv_map:
            img_idx = image_bv_map[bv_idx]
            img_def = gltf["images"][img_idx]
            im = Image.open(io.BytesIO(chunk))

            # Determine if image actually uses transparency
            has_alpha = False
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                alpha = im.convert("RGBA").getchannel("A")
                lo, _hi = alpha.getextrema()
                has_alpha = lo < 250

            limit = 512 if has_alpha else max_dim
            if max(im.size) > limit:
                im.thumbnail((limit, limit), Image.Resampling.LANCZOS)

            out_buf = io.BytesIO()
            if has_alpha:
                im.convert("RGBA").save(out_buf, format="PNG", optimize=True)
                img_def["mimeType"] = "image/png"
            else:
                im.convert("RGB").save(out_buf, format="JPEG", quality=84, optimize=True)
                img_def["mimeType"] = "image/jpeg"
            chunk = out_buf.getvalue()

        padded = pad4(chunk, b"\x00")
        bv["byteOffset"] = cur_offset
        bv["byteLength"] = len(chunk)
        new_chunks.append(padded)
        cur_offset += len(padded)

    new_bin = b"".join(new_chunks)
    gltf["buffers"][0]["byteLength"] = len(new_bin)

    new_json = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total_size = 12 + 8 + len(new_json) + 8 + len(new_bin)

    out = (
        struct.pack("<4sII", b"glTF", 2, total_size)
        + struct.pack("<I4s", len(new_json), b"JSON")
        + new_json
        + struct.pack("<I4s", len(new_bin), b"BIN\x00")
        + new_bin
    )
    old_kb = len(raw) // 1024
    new_kb = len(out) // 1024
    open(path, "wb").write(out)
    print(f"Optimized {os.path.basename(path)}: {old_kb} KB -> {new_kb} KB")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        optimize_glb(p)
