/**
 * Downloads 8 photorealistic CC0 interior PBR texture sets (Diffuse + Normal + Roughness)
 * from Poly Haven and optimizes them to 512px JPEGs in public/assets/textures/.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBufferSafe, writeFileAtomicNoSymlink } from './lib/safe-net.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'public', 'assets', 'textures');
const cacheRoot = process.env.SOLCOAST_CACHE_DIR
  ? path.resolve(process.env.SOLCOAST_CACHE_DIR)
  : path.join(os.homedir(), '.cache', 'solcoast');
const cacheDir = path.join(cacheRoot, 'ph-int-tex');

const POLYHAVEN_HOSTS = new Set(['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.org']);
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

const TEX_SPECS = [
  { prefix: 'int_marble', phId: 'marble_tiles' },
  { prefix: 'int_parquet', phId: 'herringbone_parquet' },
  { prefix: 'int_brick', phId: 'brick_wall_005' },
  { prefix: 'int_plaster', phId: 'painted_plaster_wall' },
  { prefix: 'int_terracotta', phId: 'patterned_terracotta_tiling' },
  { prefix: 'int_tile_white', phId: 'floor_tiles_06' },
  { prefix: 'int_concrete', phId: 'concrete_wall_001' },
  { prefix: 'int_wood_panel', phId: 'diagonal_parquet' },
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
  await Promise.all(
    TEX_SPECS.map(async (spec) => {
      const metaBuf = await fetchBufferSafe(`https://api.polyhaven.com/files/${spec.phId}`, {
        headers: UA,
        allowedHosts: POLYHAVEN_HOSTS,
        maxBytes: 2 * 1024 * 1024,
      });
      const meta = JSON.parse(metaBuf.toString('utf8'));

      const pickUrl = (keys) => {
        for (const k of keys) {
          const node = meta[k]?.['1k']?.jpg ?? meta[k]?.['1k']?.png ?? meta[k]?.['2k']?.jpg;
          if (node?.url) return node.url;
        }
        return null;
      };

      const diffUrl = pickUrl(['Diffuse', 'diff', 'albedo']);
      const norUrl = pickUrl(['nor_gl', 'Normal', 'nor_dx']);
      const roughUrl = pickUrl(['Rough', 'rough', 'arm']);
      if (!diffUrl || !norUrl || !roughUrl) {
        throw new Error(`Missing maps for ${spec.phId}: keys=${Object.keys(meta).join(',')}`);
      }

      await Promise.all([
        downloadFile(diffUrl, path.join(cacheDir, `${spec.prefix}_diff.raw`)),
        downloadFile(norUrl, path.join(cacheDir, `${spec.prefix}_nor.raw`)),
        downloadFile(roughUrl, path.join(cacheDir, `${spec.prefix}_rough.raw`)),
      ]);
      console.log(`[downloaded] ${spec.prefix} <- ${spec.phId}`);
    }),
  );
}

function optimizeAll() {
  fs.mkdirSync(outDir, { recursive: true });
  let total = 0;
  const py = `
from PIL import Image
import sys
Image.MAX_IMAGE_PIXELS = 40_000_000
im = Image.open(sys.argv[1]).convert('RGB')
im.thumbnail((512, 512), Image.Resampling.LANCZOS)
im.save(sys.argv[2], 'JPEG', quality=82, optimize=True)
`;
  for (const spec of TEX_SPECS) {
    for (const map of ['diff', 'nor', 'rough']) {
      const src = path.join(cacheDir, `${spec.prefix}_${map}.raw`);
      const dst = path.join(outDir, `${spec.prefix}_${map}.jpg`);
      execFileSync('python3', ['-c', py, src, dst]);
      total += fs.statSync(dst).size;
    }
    console.log(`[opt] ${spec.prefix}_{diff,nor,rough}.jpg`);
  }
  console.log(`Total 8 interior PBR sets (24 JPEGs): ${(total / 1024).toFixed(1)} KB`);
}

if (process.argv[2] === '--download') {
  await downloadAll();
} else if (process.argv[2] === '--optimize') {
  optimizeAll();
} else {
  console.error('Usage: node scripts/fetch-interior-textures.mjs [--download|--optimize]');
  process.exit(1);
}
