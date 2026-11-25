/**
 * Downloads 30 CC0 photorealistic PBR interior furniture & prop models from Poly Haven
 * and optimizes them into compact, Draco-compressed, y=0 grounded GLBs in public/assets/props/.
 *
 * Usage:
 *   node scripts/fetch-interior-props.mjs --download   (network: downloads 1k gltf + textures to ~/.cache/solcoast/ph-props)
 *   node scripts/fetch-interior-props.mjs --optimize   (offline: optimizes + writes public/assets/props/*.glb)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPrivateToolDir,
  assertSafeHttpsUrl,
  fetchBufferSafe,
  resolveWithin,
  writeFileAtomicNoSymlink,
} from './lib/safe-net.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const propsOutDir = path.resolve(__dirname, '..', 'public', 'assets', 'props');
const cacheRoot = process.env.SOLCOAST_CACHE_DIR
  ? path.resolve(process.env.SOLCOAST_CACHE_DIR)
  : path.join(os.homedir(), '.cache', 'solcoast');
const cacheDir = path.join(cacheRoot, 'ph-props');
const gltfOptDir = process.env.SOLCOAST_GLTF_OPT_DIR
  ? path.resolve(process.env.SOLCOAST_GLTF_OPT_DIR)
  : path.join(cacheRoot, 'gltf-opt');

const POLYHAVEN_HOSTS = new Set(['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.org']);
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

const PROP_SPECS = [
  { name: 'sofa_luxury', phId: 'sofa_03', simplifyRatio: 0.35 },
  { name: 'sofa_club', phId: 'Sofa_01', simplifyRatio: 0.35 },
  { name: 'lounge_chair', phId: 'mid_century_lounge_chair', simplifyRatio: 0.4 },
  { name: 'armchair', phId: 'modern_arm_chair_01', simplifyRatio: 0.4 },
  { name: 'bar_stool', phId: 'bar_chair_round_01', simplifyRatio: 0.45 },
  { name: 'dining_chair', phId: 'dining_chair_02', simplifyRatio: 0.45 },
  { name: 'gallery_bench', phId: 'painted_wooden_bench', simplifyRatio: 0.5 },
  { name: 'coffee_table', phId: 'modern_coffee_table_01', simplifyRatio: 0.5 },
  { name: 'bistro_table', phId: 'round_wooden_table_01', simplifyRatio: 0.5 },
  { name: 'dining_table', phId: 'dining_table', simplifyRatio: 0.5 },
  { name: 'console_table', phId: 'ClassicConsole_01', simplifyRatio: 0.4 },
  { name: 'cabinet', phId: 'modern_wooden_cabinet', simplifyRatio: 0.5 },
  { name: 'bed_suite', phId: 'GothicBed_01', simplifyRatio: 0.3 },
  { name: 'display_shelves', phId: 'wooden_display_shelves_01', simplifyRatio: 0.5 },
  { name: 'metal_shelves', phId: 'steel_frame_shelves_03', simplifyRatio: 0.5 },
  { name: 'chandelier', phId: 'Chandelier_01', simplifyRatio: 0.3, hangFromTop: true },
  { name: 'pendant_lamp', phId: 'modern_ceiling_lamp_01', simplifyRatio: 0.45, hangFromTop: true },
  { name: 'stage_lights', phId: 'flood_lights', simplifyRatio: 0.4 },
  { name: 'potted_plant_1', phId: 'potted_plant_01', simplifyRatio: 0.35 },
  { name: 'potted_plant_2', phId: 'potted_plant_02', simplifyRatio: 0.35 },
  { name: 'coffee_cart', phId: 'CoffeeCart_01', simplifyRatio: 0.35 },
  { name: 'chalkboard', phId: 'standing_chalkboard_01', simplifyRatio: 0.5 },
  { name: 'wine_bottles', phId: 'wine_bottles_01', simplifyRatio: 0.45 },
  { name: 'cake_display', phId: 'strawberry_chocolate_cake', simplifyRatio: 0.45 },
  { name: 'boombox', phId: 'boombox', simplifyRatio: 0.45 },
  { name: 'marble_bust', phId: 'marble_bust_01', simplifyRatio: 0.35 },
  { name: 'bronze_shark', phId: 'bronze_shark_statue', simplifyRatio: 0.35 },
  { name: 'grandfather_clock', phId: 'vintage_grandfather_clock_01', simplifyRatio: 0.4 },
  { name: 'spray_paint', phId: 'spray_paint_bottles_02', simplifyRatio: 0.45 },
  { name: 'ornate_mirror', phId: 'ornate_mirror_01', simplifyRatio: 0.4 },
];

const UA = { 'User-Agent': 'SolCoastGame/1.0 (https://github.com/foundev/solcoast)' };

async function downloadFile(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  const buf = await fetchBufferSafe(url, {
    headers: UA,
    allowedHosts: POLYHAVEN_HOSTS,
    maxBytes: MAX_DOWNLOAD_BYTES,
  });
  writeFileAtomicNoSymlink(cacheDir, dest, buf, { dirMode: 0o700, fileMode: 0o600 });
}

async function downloadAll() {
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  // Process in batches of 5 for fast parallel downloads without hammering Poly Haven
  for (let i = 0; i < PROP_SPECS.length; i += 5) {
    const batch = PROP_SPECS.slice(i, i + 5);
    await Promise.all(
      batch.map(async (spec) => {
        const dir = resolveWithin(cacheDir, spec.name);
        const marker = path.join(dir, '.done');
        if (fs.existsSync(marker)) {
          console.log(`[cached] ${spec.name} (${spec.phId})`);
          return;
        }
        const metaBuf = await fetchBufferSafe(`https://api.polyhaven.com/files/${spec.phId}`, {
          headers: UA,
          allowedHosts: POLYHAVEN_HOSTS,
          maxBytes: 2 * 1024 * 1024,
        });
        const meta = JSON.parse(metaBuf.toString('utf8'));
        const gltfEntry = meta.gltf?.['1k']?.gltf ?? meta.gltf?.['2k']?.gltf;
        if (!gltfEntry) throw new Error(`No glTF found for ${spec.phId}`);

        const mainName = path.basename(new URL(assertSafeHttpsUrl(gltfEntry.url, POLYHAVEN_HOSTS)).pathname);
        await downloadFile(gltfEntry.url, resolveWithin(dir, mainName));

        const includes = gltfEntry.include ?? {};
        await Promise.all(
          Object.entries(includes).map(([rel, info]) =>
            downloadFile(info.url, resolveWithin(dir, rel)),
          ),
        );
        writeFileAtomicNoSymlink(cacheDir, marker, mainName, { dirMode: 0o700, fileMode: 0o600 });
        console.log(`[downloaded] ${spec.name} <- ${spec.phId} (${Object.keys(includes).length + 1} files)`);
      }),
    );
  }
  console.log('All 30 Poly Haven CC0 interior props downloaded!');
}

function compressImageWithPil(bytes, mimeType, maxDim = 384) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solcoast-ptex-'));
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
    im.convert('RGB').save(sys.argv[2], 'JPEG', quality=78, optimize=True)
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

function bakeAndGround(doc, hangFromTop = false) {
  const root = doc.getRoot();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

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
          arr[i] = wx;
          arr[i + 1] = wy;
          arr[i + 2] = wz;
          if (wx < minX) minX = wx;
          if (wy < minY) minY = wy;
          if (wz < minZ) minZ = wz;
          if (wx > maxX) maxX = wx;
          if (wy > maxY) maxY = wy;
          if (wz > maxZ) maxZ = wz;
        }
        pos.setArray(arr);
      }
      const norm = prim.getAttribute('NORMAL');
      if (norm) {
        const arr = norm.getArray();
        for (let i = 0; i < arr.length; i += 3) {
          const [wx, wy, wz] = applyMat4Dir(wm, arr[i], arr[i + 1], arr[i + 2]);
          arr[i] = wx;
          arr[i + 1] = wy;
          arr[i + 2] = wz;
        }
        norm.setArray(arr);
      }
    }
  }

  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const refY = hangFromTop ? maxY : minY;

  for (const mesh of bakedMeshes) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray();
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] -= cx;
        arr[i + 1] -= refY;
        arr[i + 2] -= cz;
      }
      pos.setArray(arr);
    }
  }

  for (const node of root.listNodes()) {
    node.setTranslation([0, 0, 0]);
    node.setRotation([0, 0, 0, 1]);
    node.setScale([1, 1, 1]);
  }

  return {
    w: +(maxX - minX).toFixed(2),
    h: +(maxY - minY).toFixed(2),
    d: +(maxZ - minZ).toFixed(2),
  };
}

async function optimizeAll() {
  const pkgPath = assertPrivateToolDir(gltfOptDir);
  const require = createRequire(pkgPath);
  const { NodeIO } = require('@gltf-transform/core');
  const { ALL_EXTENSIONS, KHRDracoMeshCompression, KHRMaterialsTransmission } = require('@gltf-transform/extensions');
  const { dedup, draco, flatten, join, prune, simplify, weld } = require('@gltf-transform/functions');
  const draco3d = require('draco3dgltf');
  const { MeshoptSimplifier } = require('meshoptimizer');

  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  fs.mkdirSync(propsOutDir, { recursive: true });
  let totalBytes = 0;

  for (const spec of PROP_SPECS) {
    const dir = resolveWithin(cacheDir, spec.name);
    const gltfName = fs.readFileSync(path.join(dir, '.done'), 'utf8').trim();
    const inPath = resolveWithin(dir, gltfName);
    const outPath = resolveWithin(propsOutDir, `${spec.name}.glb`);

    const doc = await io.read(inPath);

    // Strip slow transmission extensions (reduces WebGL render passes)
    for (const mat of doc.getRoot().listMaterials()) {
      const tr = mat.getExtension(KHRMaterialsTransmission.EXTENSION_NAME);
      if (tr) {
        tr.dispose();
        mat.setAlphaMode('BLEND');
        const col = mat.getBaseColorFactor();
        mat.setBaseColorFactor([col[0], col[1], col[2], Math.min(col[3], 0.42)]);
      }
    }
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === KHRMaterialsTransmission.EXTENSION_NAME) ext.dispose();
    }

    await doc.transform(flatten());
    const dims = bakeAndGround(doc, Boolean(spec.hangFromTop));
    await doc.transform(
      dedup(),
      join({ keepNamed: false }),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: spec.simplifyRatio, error: 0.004 }),
      prune(),
    );

    // Compress embedded textures to 384px JPEG/PNG
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img || img.byteLength < 6000) continue;
      const compressed = compressImageWithPil(img, tex.getMimeType(), 384);
      tex.setImage(compressed.bytes);
      tex.setMimeType(compressed.mimeType);
    }

    doc.createExtension(KHRDracoMeshCompression).setRequired(true);
    await doc.transform(draco());

    await io.write(outPath, doc);
    const sz = fs.statSync(outPath).size;
    totalBytes += sz;
    console.log(
      `[opt] ${spec.name}.glb: ${(sz / 1024).toFixed(1)} KB | dims ${dims.w}×${dims.h}×${dims.d}m`,
    );
  }
  console.log(`Total 30 interior prop GLBs: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

const mode = process.argv[2];
if (mode === '--download') {
  await downloadAll();
} else if (mode === '--optimize') {
  await optimizeAll();
} else {
  console.error('Usage: node scripts/fetch-interior-props.mjs [--download|--optimize]');
  process.exit(1);
}
