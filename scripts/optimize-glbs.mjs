/**
 * Game-asset pipeline for Sol Coast:
 *   1. Strips KHR_materials_transmission (avoids costly 2nd full-scene WebGL render pass)
 *   2. Merges 400+ CAD sub-meshes by material into ~11-17 draw calls
 *   3. Bakes exact -Z forward alignment, X/Z centering, y=0 grounding & real-world scale
 *   4. Decimates CAD tessellation via meshoptimizer + compresses embedded textures + Draco
 *
 * One-time deps (installed in a user-private cache directory, never world-writable /tmp):
 *   mkdir -p -m 700 ~/.cache/solcoast/gltf-opt
 *   npm install --prefix ~/.cache/solcoast/gltf-opt @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf meshoptimizer
 *   node scripts/optimize-glbs.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateToolDir } from './lib/safe-net.mjs';

const gltfOptDir = process.env.SOLCOAST_GLTF_OPT_DIR
  ? path.resolve(process.env.SOLCOAST_GLTF_OPT_DIR)
  : path.join(os.homedir(), '.cache', 'solcoast', 'gltf-opt');
const gltfOptPkg = assertPrivateToolDir(gltfOptDir);
const require = createRequire(gltfOptPkg);
const { NodeIO, PropertyType } = require('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRDracoMeshCompression, KHRMaterialsTransmission } = require('@gltf-transform/extensions');
const { dedup, draco, flatten, join, prune, simplify, weld } = require('@gltf-transform/functions');
const draco3d = require('draco3dgltf');
const { MeshoptSimplifier } = require('meshoptimizer');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(__dirname, '..', 'public', 'assets', 'models');

// Exact native orientation -> rotation around Y needed so front/bow faces -Z
const MODEL_SPECS = [
  // Cars (all scaled to realistic meters, grounded at y=0, facing -Z)
  { file: 'car_spyder.glb', rotY: -Math.PI / 2, kind: 'car', simplifyRatio: 0.30, targetLen: 4.35 },
  { file: 'car_gt.glb', rotY: -Math.PI / 2, kind: 'car', simplifyRatio: 0.30, targetLen: 4.65 },
  { file: 'car_ev.glb', rotY: -Math.PI / 2, kind: 'car', simplifyRatio: 0.30, targetLen: 4.40 },
  { file: 'car_suv.glb', rotY: -Math.PI / 2, kind: 'car', simplifyRatio: 0.25, targetLen: 4.75 },
  { file: 'car_taxi.glb', rotY: -Math.PI / 2, kind: 'car', simplifyRatio: 0.25, targetLen: 4.68 },
  { file: 'car_coupe.glb', rotY: -Math.PI / 2, kind: 'car', simplifyRatio: 0.25, targetLen: 4.55 },
  { file: 'car_jdm.glb', rotY: Math.PI, kind: 'car', simplifyRatio: 0.25, targetLen: 4.48 },
  // Boats & Cruise Ship (bow faces -Z, grounded at minY=0)
  { file: 'boat_speedboat.glb', rotY: Math.PI / 2, kind: 'boat', simplifyRatio: 0.35, targetLen: 8.2 },
  { file: 'boat_cruiser.glb', rotY: Math.PI / 2, kind: 'boat', simplifyRatio: 0.25, targetLen: 12.5 },
  { file: 'boat_sailboat.glb', rotY: Math.PI / 2, kind: 'boat', simplifyRatio: 0.25, targetLen: 10.5 },
  { file: 'boat_motorboat.glb', rotY: Math.PI / 2, kind: 'boat', simplifyRatio: 0.25, targetLen: 6.5 },
  { file: 'boat_watertaxi.glb', rotY: Math.PI, kind: 'boat', simplifyRatio: 0.50, targetLen: 11.0 },
  { file: 'boat_cruiseship.glb', rotY: Math.PI / 2, kind: 'boat', simplifyRatio: 0.25, targetLen: 185.0 },
];

function compressImageWithPil(bytes, mimeType, maxDim = 512) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solcoast-tex-'));
  try {
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const inPath = path.join(tmpDir, `in.${ext}`);
    const outPath = path.join(tmpDir, 'out.jpg');
    const outPng = path.join(tmpDir, 'out.png');
    fs.writeFileSync(inPath, bytes);
    const py = `
from PIL import Image
import sys
Image.MAX_IMAGE_PIXELS = 40_000_000
im = Image.open(sys.argv[1])
has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
if has_alpha:
    alpha = im.convert('RGBA').getchannel('A')
    lo, hi = alpha.getextrema()
    has_alpha = lo < 250
max_dim = int(sys.argv[4])
if max(im.size) > max_dim:
    im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
if has_alpha:
    im.convert('RGBA').save(sys.argv[3], 'PNG', optimize=True)
    print('png')
else:
    im.convert('RGB').save(sys.argv[2], 'JPEG', quality=82, optimize=True)
    print('jpg')
`;
    const mode = execFileSync('python3', ['-c', py, inPath, outPath, outPng, String(maxDim)], {
      encoding: 'utf8',
    }).trim();
    if (mode === 'png') {
      return { bytes: new Uint8Array(fs.readFileSync(outPng)), mimeType: 'image/png' };
    }
    return { bytes: new Uint8Array(fs.readFileSync(outPath)), mimeType: 'image/jpeg' };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function applyMat4Pos(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function applyMat4Dir(m, x, y, z) {
  const nx = m[0] * x + m[4] * y + m[8] * z;
  const ny = m[1] * x + m[5] * y + m[9] * z;
  const nz = m[2] * x + m[6] * y + m[10] * z;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function transformSceneAndBake(doc, rotY, targetLen) {
  const root = doc.getRoot();
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const rotateVec = (x, y, z) => [x * cos + z * sin, y, -x * sin + z * cos];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Bake each node's world matrix + rotY directly into vertex positions/normals, then reset node TRS
  const bakedMeshes = new Set();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || bakedMeshes.has(mesh)) continue;
    bakedMeshes.add(mesh);
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (pos) {
        const arr = pos.getArray();
        for (let i = 0; i < arr.length; i += 3) {
          const [wx, wy, wz] = applyMat4Pos(wm, arr[i], arr[i + 1], arr[i + 2]);
          const [rx, ry, rz] = rotateVec(wx, wy, wz);
          arr[i] = rx;
          arr[i + 1] = ry;
          arr[i + 2] = rz;
          if (rx < minX) minX = rx;
          if (ry < minY) minY = ry;
          if (rz < minZ) minZ = rz;
          if (rx > maxX) maxX = rx;
          if (ry > maxY) maxY = ry;
          if (rz > maxZ) maxZ = rz;
        }
        pos.setArray(arr);
      }
      const norm = prim.getAttribute('NORMAL');
      if (norm) {
        const arr = norm.getArray();
        for (let i = 0; i < arr.length; i += 3) {
          const [wx, wy, wz] = applyMat4Dir(wm, arr[i], arr[i + 1], arr[i + 2]);
          const [rx, ry, rz] = rotateVec(wx, wy, wz);
          arr[i] = rx;
          arr[i + 1] = ry;
          arr[i + 2] = rz;
        }
        norm.setArray(arr);
      }
      const tan = prim.getAttribute('TANGENT');
      if (tan) {
        const arr = tan.getArray();
        for (let i = 0; i < arr.length; i += 4) {
          const [wx, wy, wz] = applyMat4Dir(wm, arr[i], arr[i + 1], arr[i + 2]);
          const [rx, ry, rz] = rotateVec(wx, wy, wz);
          arr[i] = rx;
          arr[i + 1] = ry;
          arr[i + 2] = rz;
        }
        tan.setArray(arr);
      }
    }
    node.setTranslation([0, 0, 0]);
    node.setRotation([0, 0, 0, 1]);
    node.setScale([1, 1, 1]);
  }

  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const curLen = Math.max(0.01, maxZ - minZ);
  const scale = targetLen ? targetLen / curLen : 1;

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray();
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = (arr[i] - cx) * scale;
        arr[i + 1] = (arr[i + 1] - minY) * scale;
        arr[i + 2] = (arr[i + 2] - cz) * scale;
      }
      pos.setArray(arr);
    }
  }

  return {
    width: +((maxX - minX) * scale).toFixed(2),
    height: +((maxY - minY) * scale).toFixed(2),
    length: +((maxZ - minZ) * scale).toFixed(2),
  };
}

async function main() {
  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  for (const spec of MODEL_SPECS) {
    const filePath = path.join(modelsDir, spec.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Missing ${spec.file}, skipping`);
      continue;
    }
    const beforeKb = Math.round(fs.statSync(filePath).size / 1024);
    const doc = await io.read(filePath);

    // 1. Strip expensive KHR_materials_transmission (avoids full-scene transmission render pass!)
    for (const mat of doc.getRoot().listMaterials()) {
      const trans = mat.getExtension('KHR_materials_transmission');
      if (trans) {
        mat.setExtension('KHR_materials_transmission', null);
        mat.setAlphaMode('BLEND');
        const col = mat.getBaseColorFactor();
        const isLens = /lens|clear/i.test(mat.getName());
        mat.setBaseColorFactor([
          isLens ? col[0] : Math.min(col[0], 0.14),
          isLens ? col[1] : Math.min(col[1], 0.22),
          isLens ? col[2] : Math.min(col[2], 0.30),
          isLens ? 0.55 : 0.72,
        ]);
        mat.setRoughnessFactor(0.06);
        mat.setMetallicFactor(0.18);
      }
    }
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === KHRMaterialsTransmission.EXTENSION_NAME) {
        ext.dispose();
      }
    }

    // 2. Flatten hierarchy and merge primitives by material (435 draw calls -> ~11!)
    await doc.transform(
      flatten(),
      dedup({ propertyTypes: [PropertyType.MATERIAL, PropertyType.TEXTURE] }),
      join({ keepNamed: false }),
      prune(),
    );

    // 3. Bake exact -Z forward orientation, X/Z centering, y=0 grounding & real-world scale
    const dims = transformSceneAndBake(doc, spec.rotY, spec.targetLen);

    // 4. Weld vertices & decimate CAD tessellation cleanly
    await doc.transform(
      weld({ tolerance: 0.0005 }),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: spec.simplifyRatio,
        error: 0.008,
        lockBorder: false,
      }),
      prune(),
    );

    // 5. Downscale & JPEG-compress embedded textures to max 512px
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img || img.byteLength < 16384) continue;
      const maxDim = spec.file === 'boat_cruiseship.glb' ? 512 : 512;
      const compressed = compressImageWithPil(Buffer.from(img), tex.getMimeType(), maxDim);
      if (compressed.bytes.byteLength < img.byteLength) {
        tex.setImage(compressed.bytes);
        tex.setMimeType(compressed.mimeType);
      }
    }

    // 6. Apply Draco mesh compression
    await doc.transform(
      draco({
        method: 'edgebreaker',
        encodeSpeed: 5,
        decodeSpeed: 5,
        quantizePosition: 14,
        quantizeNormal: 10,
        quantizeTexcoord: 12,
      }),
    );

    await io.write(filePath, doc);
    const afterKb = Math.round(fs.statSync(filePath).size / 1024);

    let prims = 0;
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) {
      for (const p of m.listPrimitives()) {
        prims++;
        const idx = p.getIndices();
        tris += idx ? idx.getCount() / 3 : (p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
      }
    }
    console.log(
      `✓ ${spec.file.padEnd(20)} ${String(beforeKb).padStart(5)}KB -> ${String(afterKb).padStart(4)}KB | prims:${String(prims).padEnd(2)} | tris:${String(Math.round(tris)).padStart(6)} | size:${dims.width}x${dims.height}x${dims.length}m`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
