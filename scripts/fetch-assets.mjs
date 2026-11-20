import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'public', 'assets');

const UA = { 'User-Agent': 'SolCoastGame/1.0 (+https://github.com/foundev/solcoast)' };

async function downloadFile(url, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetch(url, { headers: UA });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  console.log(`✓ ${path.relative(rootDir, destPath)} (${(buf.length / 1024).toFixed(0)} KB)`);
}

async function fetchPolyHavenFiles(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA });
  if (!res.ok) throw new Error(`Poly Haven API error ${res.status} for ${id}`);
  return res.json();
}

async function main() {
  // 1. High-poly sculpted sports car + rigged mocap human character (.glb)
  await downloadFile(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/ferrari.glb',
    path.join(assetsDir, 'models', 'ferrari.glb'),
  );
  await downloadFile(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb',
    path.join(assetsDir, 'models', 'character.glb'),
  );

  // 2. Real photographic CC0 HDRIs from Poly Haven (1K .hdr)
  const hdris = [
    { id: 'venice_sunset', out: 'sunset.hdr' },
    { id: 'kloofendal_48d_partly_cloudy_puresky', out: 'midday.hdr' },
    { id: 'moonless_golf', out: 'night.hdr' },
  ];
  for (const h of hdris) {
    const info = await fetchPolyHavenFiles(h.id);
    const url = info.hdri?.['1k']?.hdr?.url;
    if (!url) throw new Error(`No 1k hdr URL for ${h.id}`);
    await downloadFile(url, path.join(assetsDir, 'hdri', h.out));
  }

  // 3. Real photographic CC0 PBR texture sets from Poly Haven (1K jpg)
  const textures = [
    { id: 'asphalt_02', outPrefix: 'asphalt' },
    { id: 'sand_01', outPrefix: 'sand' },
    { id: 'wood_planks', outPrefix: 'wood' },
    { id: 'concrete_floor_02', outPrefix: 'concrete' },
  ];
  for (const t of textures) {
    const info = await fetchPolyHavenFiles(t.id);
    const maps = [
      { src: 'Diffuse', dst: 'diff.jpg' },
      { src: 'nor_gl', dst: 'nor.jpg' },
      { src: 'Rough', dst: 'rough.jpg' },
    ];
    for (const m of maps) {
      const entry = info[m.src]?.['1k']?.jpg;
      if (!entry?.url) {
        console.warn(`! Skipping missing ${m.src} for ${t.id}`);
        continue;
      }
      await downloadFile(entry.url, path.join(assetsDir, 'textures', `${t.outPrefix}_${m.dst}`));
    }
  }

  console.log('\nAll Sol Coast photorealistic assets downloaded cleanly!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
