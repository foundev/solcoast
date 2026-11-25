import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertWithinDir,
  fetchBufferSafe,
  writeFileAtomicNoSymlink,
} from './lib/safe-net.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'public', 'assets');
const forceDownload = process.argv.includes('--force');

const UA = { 'User-Agent': 'SolCoastGame/1.0 (+https://github.com/foundev/solcoast)' };
const MAX_ASSET_BYTES = 100 * 1024 * 1024; // 100 MB safety ceiling

const STATIC_ALLOWED_HOSTS = new Set([
  'raw.githubusercontent.com',
  'api.polyhaven.com',
  'dl.polyhaven.org',
  'cdn.polyhaven.org',
  'www.innerscene.com',
  'innerscene.com',
]);

async function downloadFile(url, destPath) {
  const safeDest = assertWithinDir(assetsDir, destPath);
  if (!forceDownload && fs.existsSync(safeDest) && fs.statSync(safeDest).size > 1024) {
    console.log(`• ${path.relative(rootDir, safeDest)} (cached)`);
    return;
  }
  const buf = await fetchBufferSafe(url, {
    headers: UA,
    allowedHosts: STATIC_ALLOWED_HOSTS,
    maxBytes: MAX_ASSET_BYTES,
  });
  writeFileAtomicNoSymlink(assetsDir, safeDest, buf);
  console.log(`✓ ${path.relative(rootDir, safeDest)} (${(buf.length / 1024).toFixed(0)} KB)`);
}

function extractSingleGlbSafely(zipPath, destPath) {
  // Inspect ZIP entries in Python without extracting arbitrary files to disk:
  // rejects Zip Slip (../ or absolute paths), symlinks, zip bombs, and non-glTF payloads,
  // and writes atomically via a sibling temp file (never following symlinks at dest_path).
  const py = `
import os, posixpath, stat, sys, tempfile, zipfile

zip_path, dest_path, max_bytes = sys.argv[1], sys.argv[2], int(sys.argv[3])
if os.path.islink(dest_path):
    raise RuntimeError(f'Refusing to overwrite symlink: {dest_path!r}')
with zipfile.ZipFile(zip_path, 'r') as zf:
    chosen = None
    for info in zf.infolist():
        name = info.filename
        if info.is_dir():
            continue
        if name.startswith('/') or name.startswith('\\\\') or ':' in name.split('/')[0]:
            raise RuntimeError(f'Unsafe absolute archive path: {name!r}')
        norm = posixpath.normpath(name.replace('\\\\', '/'))
        if norm == '..' or norm.startswith('../') or '/..' in norm:
            raise RuntimeError(f'Unsafe traversal archive path: {name!r}')
        mode = (info.external_attr >> 16) & 0o170000
        if mode == stat.S_IFLNK:
            raise RuntimeError(f'Refusing symlink entry in archive: {name!r}')
        if info.file_size > max_bytes:
            raise RuntimeError(f'Archive entry exceeds size limit: {name!r} ({info.file_size} bytes)')
        if norm.lower().endswith('.glb') and chosen is None:
            chosen = info
    if chosen is None:
        raise RuntimeError('No .glb entry found inside ZIP archive')
    with zf.open(chosen, 'r') as src:
        data = src.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise RuntimeError('Extracted GLB exceeded size limit')
    if data[:4] != b'glTF':
        raise RuntimeError('Extracted .glb does not have valid glTF binary header')
    fd, tmp_out = tempfile.mkstemp(prefix='.glb-', dir=os.path.dirname(dest_path))
    try:
        with os.fdopen(fd, 'wb') as dst:
            dst.write(data)
        os.chmod(tmp_out, 0o644)
        os.replace(tmp_out, dest_path)
    except Exception:
        if os.path.exists(tmp_out):
            os.unlink(tmp_out)
        raise
`;
  execFileSync('python3', ['-c', py, zipPath, destPath, String(MAX_ASSET_BYTES)]);
}

async function downloadInnersceneGlb(slug, destPath) {
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    throw new Error(`Invalid Innerscene slug: ${slug}`);
  }
  const safeDest = assertWithinDir(assetsDir, destPath);
  if (!forceDownload && fs.existsSync(safeDest) && fs.statSync(safeDest).size > 1024) {
    console.log(`• ${path.relative(rootDir, safeDest)} (cached)`);
    return;
  }
  fs.mkdirSync(path.dirname(safeDest), { recursive: true });
  const url = `https://www.innerscene.com/api/library/${slug}/download`;
  const buf = await fetchBufferSafe(url, {
    headers: UA,
    allowedHosts: STATIC_ALLOWED_HOSTS,
    allowRedirectHosts: true,
    maxBytes: MAX_ASSET_BYTES,
  });
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic === 'glTF') {
    writeFileAtomicNoSymlink(assetsDir, safeDest, buf);
    console.log(`✓ ${path.relative(rootDir, safeDest)} (${(buf.length / 1024).toFixed(0)} KB, raw GLB)`);
    return;
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solcoast-glb-'));
    try {
      const zipPath = path.join(tmpDir, 'pkg.zip');
      fs.writeFileSync(zipPath, buf, { flag: 'wx', mode: 0o600 });
      extractSingleGlbSafely(zipPath, safeDest);
      const sizeKb = (fs.statSync(safeDest).size / 1024).toFixed(0);
      console.log(`✓ ${path.relative(rootDir, safeDest)} (${sizeKb} KB, extracted GLB)`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }
  throw new Error(`Unexpected format (magic=${JSON.stringify(magic)}) for Innerscene ${slug}`);
}

async function fetchPolyHavenFiles(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid Poly Haven asset id: ${id}`);
  }
  const buf = await fetchBufferSafe(`https://api.polyhaven.com/files/${id}`, {
    headers: UA,
    allowedHosts: STATIC_ALLOWED_HOSTS,
    maxBytes: 2 * 1024 * 1024,
  });
  return JSON.parse(buf.toString('utf8'));
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
    { src: 'masculine/glb/locomotion/M_Walk_002.glb', out: 'anim_walk2.glb' },
    { src: 'feminine/glb/locomotion/F_Walk_002.glb', out: 'anim_walk_f.glb' },
    { src: 'feminine/glb/locomotion/F_Walk_003.glb', out: 'anim_walk_f2.glb' },
    { src: 'masculine/glb/locomotion/M_Run_001.glb', out: 'anim_run.glb' },
    { src: 'masculine/glb/locomotion/M_Jog_Jump_001.glb', out: 'anim_jump.glb' },
  ];
  for (const a of anims) {
    await downloadFile(`${rpmAnimBase}/${a.src}`, path.join(assetsDir, 'animations', a.out));
  }

  // 3b. Additional CC0 3D Car Models (Innerscene CC0 Public Domain Library)
  const cc0Cars = [
    { slug: 'generic-convertible-roadster-05aace60', out: 'car_spyder.glb' },
    { slug: 'generic-front-engine-grand-tourer-coupe-9a08f635', out: 'car_gt.glb' },
    { slug: 'generic-electric-hatchback-6f7e33fa', out: 'car_ev.glb' },
    { slug: 'generic-compact-suv-9f157ee5', out: 'car_suv.glb' },
    { slug: 'generic-city-taxi-with-taxi-roof-sign-394afe2b', out: 'car_taxi.glb' },
    { slug: '1990s-jdm-style-sports-coupe-generic-821985f3', out: 'car_jdm.glb' },
    { slug: 'generic-two-door-coupe-f57c8670', out: 'car_coupe.glb' },
  ];
  for (const car of cc0Cars) {
    await downloadInnersceneGlb(car.slug, path.join(assetsDir, 'models', car.out));
  }

  // 3c. CC0 3D Boats, Yachts & Cruise Liner (Innerscene CC0 Public Domain Library)
  const cc0Boats = [
    { slug: 'speedboat-436b0fd0', out: 'boat_speedboat.glb' },
    { slug: 'cabin-cruiser-597d60da', out: 'boat_cruiser.glb' },
    { slug: 'sailing-yacht-8-m-aa9dbd30', out: 'boat_sailboat.glb' },
    { slug: 'motorboat-with-outboard-engine-ad5a12bb', out: 'boat_motorboat.glb' },
    { slug: 'water-taxi-boat-925a8345', out: 'boat_watertaxi.glb' },
    { slug: 'cruise-ship-d142a65c', out: 'boat_cruiseship.glb' },
  ];
  for (const boat of cc0Boats) {
    await downloadInnersceneGlb(boat.slug, path.join(assetsDir, 'models', boat.out));
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
