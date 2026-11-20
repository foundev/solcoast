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
  // 1. High-poly Ferrari 458 Italia (CC BY 4.0)
  await downloadFile(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/ferrari.glb',
    path.join(assetsDir, 'models', 'ferrari.glb'),
  );

  // Clean up old oversized/stiff Innerscene GLBs
  for (const old of ['character.glb', 'person_sam.glb', 'person_maya.glb', 'person_jordan.glb', 'person_harper.glb']) {
    fs.rmSync(path.join(assetsDir, 'models', old), { force: true });
  }

  // 2. Game-optimized Ready Player Me full-body civilian avatars (1:1 match with RPM optical mocap!)
  const rpmDemoBase =
    'https://raw.githubusercontent.com/readyplayerme/animation-library-demo/master/Assets/Ready%20Player%20Me/Avatars';
  const avatars = [
    { id: '64d6034717883fd73ebe3dea', out: 'avatar_1.glb' },
    { id: '64e359ea58f50a12df573a70', out: 'avatar_2.glb' },
    { id: '64e35a43c603b299c00dfeba', out: 'avatar_3.glb' },
    { id: '64e49ef0cb0dbe5f8449d1da', out: 'avatar_4.glb' },
    { id: '64e49f0ce0d08c465057866c', out: 'avatar_5.glb' },
    { id: '64e49fd93bf46b6b7fb28764', out: 'avatar_6.glb' },
  ];
  for (const av of avatars) {
    await downloadFile(
      `${rpmDemoBase}/${av.id}/2fac66e374c947c41bc74325c6e3d934/${av.id}.glb`,
      path.join(assetsDir, 'models', av.out),
    );
  }
  await downloadFile(
    'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/brunette.glb',
    path.join(assetsDir, 'models', 'avatar_7.glb'),
  );

  // 3. Studio optical motion-capture animations (MIT — ReadyPlayerMe/animation-library)
  const rpmAnimBase = 'https://raw.githubusercontent.com/readyplayerme/animation-library/master';
  const anims = [
    { src: 'masculine/glb/idle/M_Standing_Idle_001.glb', out: 'anim_idle.glb' },
    { src: 'masculine/glb/locomotion/M_Walk_001.glb', out: 'anim_walk.glb' },
    { src: 'masculine/glb/locomotion/M_Run_001.glb', out: 'anim_run.glb' },
    { src: 'masculine/glb/locomotion/M_Jog_Jump_001.glb', out: 'anim_jump.glb' },
  ];
  for (const a of anims) {
    await downloadFile(`${rpmAnimBase}/${a.src}`, path.join(assetsDir, 'animations', a.out));
  }

  // 4. Pure Sky CC0 HDRIs from Poly Haven
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

  // 5. Real photographic CC0 PBR texture sets from Poly Haven
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

  console.log('\nAll Sol Coast avatars, studio mocap clips, Pure-Sky HDRIs & PBR textures ready!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
