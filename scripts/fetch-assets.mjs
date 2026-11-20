import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'public', 'assets');

const UA = { 'User-Agent': 'SolCoastGame/1.0 (+https://github.com/foundev/solcoast)' };

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function downloadFile(url, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const buf = await downloadBuffer(url);
  fs.writeFileSync(destPath, buf);
  console.log(`✓ ${path.relative(rootDir, destPath)} (${(buf.length / 1024).toFixed(0)} KB)`);
}

async function downloadGlbOrZip(url, destGlbPath) {
  fs.mkdirSync(path.dirname(destGlbPath), { recursive: true });
  const buf = await downloadBuffer(url);
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic === 'glTF') {
    fs.writeFileSync(destGlbPath, buf);
    console.log(`✓ ${path.relative(rootDir, destGlbPath)} (${(buf.length / 1024).toFixed(0)} KB, raw glb)`);
    return;
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    // ZIP archive: extract the .glb file inside
    const tmpZip = `${destGlbPath}.tmp.zip`;
    const tmpDir = `${destGlbPath}.tmp.dir`;
    fs.writeFileSync(tmpZip, buf);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    execFileSync('unzip', ['-o', '-q', tmpZip, '-d', tmpDir]);

    const findGlb = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = findGlb(full);
          if (nested) return nested;
        } else if (entry.name.toLowerCase().endsWith('.glb')) {
          return full;
        }
      }
      return null;
    };

    const glbPath = findGlb(tmpDir);
    if (!glbPath) {
      throw new Error(`No .glb found inside ZIP from ${url}`);
    }
    fs.copyFileSync(glbPath, destGlbPath);
    fs.rmSync(tmpZip, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const sizeKb = (fs.statSync(destGlbPath).size / 1024).toFixed(0);
    console.log(`✓ ${path.relative(rootDir, destGlbPath)} (${sizeKb} KB, extracted from zip)`);
    return;
  }
  throw new Error(`Unexpected response format (${magic}) from ${url}`);
}

async function fetchPolyHavenFiles(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA });
  if (!res.ok) throw new Error(`Poly Haven API error ${res.status} for ${id}`);
  return res.json();
}

async function main() {
  // 1. High-poly Ferrari 458 Italia (CC BY 4.0)
  await downloadFile(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/ferrari.glb',
    path.join(assetsDir, 'models', 'ferrari.glb'),
  );

  // 2. Four realistic CC0 civilian rigged humans with Idle/Walk/Jog/Run clips (Innerscene Locomotion Collection)
  const people = [
    { slug: 'locomotion-collection-sam-3d-person-animated-dc23800f', out: 'person_sam.glb' },
    { slug: 'locomotion-collection-maya-3d-person-animated-1499b2fd', out: 'person_maya.glb' },
    { slug: 'locomotion-collection-jordan-3d-person-animated-911f1584', out: 'person_jordan.glb' },
    { slug: 'locomotion-collection-harper-3d-person-animated-797e1e2a', out: 'person_harper.glb' },
  ];
  for (const p of people) {
    await downloadGlbOrZip(
      `https://www.innerscene.com/api/library/${p.slug}/download`,
      path.join(assetsDir, 'models', p.out),
    );
  }

  // Remove old Halo-like Soldier.glb if present
  fs.rmSync(path.join(assetsDir, 'models', 'character.glb'), { force: true });

  // 3. Pure Sky CC0 HDRIs from Poly Haven (ZERO giant buildings or ground objects in the skybox!)
  const hdris = [
    { id: 'qwantani_sunset_puresky', out: 'sunset.hdr' },
    { id: 'kloofendal_48d_partly_cloudy_puresky', out: 'midday.hdr' },
    { id: 'qwantani_night_puresky', out: 'night.hdr' },
  ];
  for (const h of hdris) {
    const info = await fetchPolyHavenFiles(h.id);
    const url = info.hdri?.['1k']?.hdr?.url;
    if (!url) throw new Error(`No 1k hdr URL for ${h.id}`);
    await downloadFile(url, path.join(assetsDir, 'hdri', h.out));
  }

  // 4. Real photographic CC0 PBR texture sets from Poly Haven (1K jpg)
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
      if (!entry?.url) continue;
      await downloadFile(entry.url, path.join(assetsDir, 'textures', `${t.outPrefix}_${m.dst}`));
    }
  }

  console.log('\nAll Sol Coast Pure-Sky HDRIs & CC0 civilian human GLBs downloaded cleanly!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
