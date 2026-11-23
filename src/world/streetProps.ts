import * as THREE from 'three';
import { createRng } from '../core/math';
import {
  AVENUE_XS,
  ROAD_WIDTH,
  SIDEWALK_HEIGHT,
  SOUTH_PIER,
  STREET_ZS,
  getGroundHeight,
} from './cityData';
import { createLightGlowTexture } from './postfx';
import type { CityBlueprint } from './types';

export interface StreetPropsHandles {
  root: THREE.Group;
  update: (elapsed: number, nightFactor: number) => void;
}

interface TrafficSignalCluster {
  redMat: THREE.MeshStandardMaterial;
  amberMat: THREE.MeshStandardMaterial;
  greenMat: THREE.MeshStandardMaterial;
  phaseOffset: number;
}

interface SeagullAgent {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  centerX: number;
  centerZ: number;
  radius: number;
  altitude: number;
  speed: number;
  phase: number;
}

function createNeonSignTexture(title: string, subtitle: string, bgHex: string, fgHex: string, accentHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 160);

  // Double Art Deco glowing border
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 144);
  ctx.strokeStyle = fgHex;
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 476, 124);

  ctx.fillStyle = fgHex;
  ctx.font = '900 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 68);

  ctx.fillStyle = accentHex;
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillText(subtitle, 256, 118);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createBillboardTexture(headline: string, sub: string, gradA: string, gradB: string, badge: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, gradA);
  grad.addColorStop(1, gradB);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Decorative Miami sunset sun & stripes
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.arc(410, 128, 82, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(10, 14, 28, 0.72)';
  ctx.fillRect(24, 24, 154, 34);
  ctx.fillStyle = '#2cf3ff';
  ctx.font = '800 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(badge, 36, 46);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 56px system-ui, sans-serif';
  ctx.fillText(headline, 24, 134);

  ctx.fillStyle = '#ffe9b8';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillText(sub, 24, 192);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Adds high-density GTA-style street-level realism across Sol Coast:
 * - Raised 3D concrete curbs framing city blocks
 * - Live cycling intersection traffic signal gantries
 * - Readable glowing Ocean Drive hotel marquees & roadside billboards
 * - Sidewalk café umbrellas & bistro tables, park benches, fire hydrants
 * - Tropical bougainvillea median planters & beach dune grass
 * - Additive volumetric streetlamp light halos & circling coastal seagulls!
 */
export function buildStreetProps(scene: THREE.Scene, blueprint: CityBlueprint): StreetPropsHandles {
  const root = new THREE.Group();
  const rng = createRng(773305);
  const glowTex = createLightGlowTexture();

  const signals: TrafficSignalCluster[] = [];
  const lightHalos: THREE.Sprite[] = [];
  const signMaterials: THREE.MeshStandardMaterial[] = [];
  const seagulls: SeagullAgent[] = [];

  const curbMat = new THREE.MeshStandardMaterial({ color: 0xd4d7df, roughness: 0.85 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x262d3a, metalness: 0.78, roughness: 0.3 });
  const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xd92b3a, roughness: 0.42, metalness: 0.35 });
  const woodBenchMat = new THREE.MeshStandardMaterial({ color: 0x8a5b38, roughness: 0.75 });
  const planterStoneMat = new THREE.MeshStandardMaterial({ color: 0xe6dfd4, roughness: 0.8 });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x276e3c, roughness: 0.88 });
  const blossomMat = new THREE.MeshStandardMaterial({ color: 0xf2388f, roughness: 0.65 });

  // 1. Raised 3D Concrete Curbs around ALL city blocks batched in 1 InstancedMesh draw call!
  const halfRoad = ROAD_WIDTH * 0.5;
  const blockCount = (AVENUE_XS.length - 1) * (STREET_ZS.length - 1);
  const blockSlabGeo = new THREE.BoxGeometry(1, SIDEWALK_HEIGHT, 1);
  const blockSlabs = new THREE.InstancedMesh(blockSlabGeo, curbMat, blockCount);
  blockSlabs.receiveShadow = true;
  const slabDummy = new THREE.Object3D();
  let slabIdx = 0;
  for (let bx = 0; bx < AVENUE_XS.length - 1; bx++) {
    for (let bz = 0; bz < STREET_ZS.length - 1; bz++) {
      const minX = AVENUE_XS[bx] + halfRoad + 0.4;
      const maxX = AVENUE_XS[bx + 1] - halfRoad - 0.4;
      const minZ = STREET_ZS[bz] + halfRoad + 0.4;
      const maxZ = STREET_ZS[bz + 1] - halfRoad - 0.4;
      slabDummy.position.set((minX + maxX) * 0.5, SIDEWALK_HEIGHT * 0.5, (minZ + maxZ) * 0.5);
      slabDummy.scale.set(maxX - minX, 1, maxZ - minZ);
      slabDummy.updateMatrix();
      blockSlabs.setMatrixAt(slabIdx++, slabDummy.matrix);
    }
  }
  blockSlabs.instanceMatrix.needsUpdate = true;
  root.add(blockSlabs);

  // 2. Live Cycling Intersection Traffic Signal Gantries
  const signalBoxMat = new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.5, metalness: 0.4 });
  for (let ix = 0; ix < AVENUE_XS.length; ix++) {
    for (let iz = 0; iz < STREET_ZS.length; iz++) {
      // Place traffic gantries at major central intersections
      if ((ix + iz) % 2 !== 0) continue;
      const ax = AVENUE_XS[ix];
      const sz = STREET_ZS[iz];

      const redMat = new THREE.MeshStandardMaterial({ color: 0x330808, emissive: 0xff1e2d, emissiveIntensity: 0.2 });
      const amberMat = new THREE.MeshStandardMaterial({ color: 0x332406, emissive: 0xffb703, emissiveIntensity: 0.1 });
      const greenMat = new THREE.MeshStandardMaterial({ color: 0x063318, emissive: 0x22ff77, emissiveIntensity: 2.2 });

      signals.push({ redMat, amberMat, greenMat, phaseOffset: (ix * 3 + iz * 5) * 1.9 });

      const gantry = new THREE.Group();
      gantry.position.set(ax - 9.4, 0.2, sz - 9.4);

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.4, 8), poleMat);
      post.position.y = 3.2;
      post.castShadow = true;
      gantry.add(post);

      // Cantilevered horizontal mast arm extending over the avenue
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 7.6, 8), poleMat);
      arm.rotation.z = Math.PI * 0.5;
      arm.position.set(3.8, 6.1, 0);
      gantry.add(arm);

      // Hanging traffic light head with 3 lenses
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.25, 0.36), signalBoxMat);
      head.position.set(5.4, 5.75, 0);
      gantry.add(head);

      const lensGeo = new THREE.SphereGeometry(0.11, 8, 8);
      const rLens = new THREE.Mesh(lensGeo, redMat);
      rLens.position.set(5.4, 6.1, 0.16);
      const aLens = new THREE.Mesh(lensGeo, amberMat);
      aLens.position.set(5.4, 5.75, 0.16);
      const gLens = new THREE.Mesh(lensGeo, greenMat);
      gLens.position.set(5.4, 5.4, 0.16);
      gantry.add(rLens, aLens, gLens);

      // Mirror lenses on opposite face
      const rLensB = rLens.clone();
      rLensB.position.z = -0.16;
      const aLensB = aLens.clone();
      aLensB.position.z = -0.16;
      const gLensB = gLens.clone();
      gLensB.position.z = -0.16;
      gantry.add(rLensB, aLensB, gLensB);

      root.add(gantry);
    }
  }

  // 3. Readable Neon Hotel & District Marquees across Ocean Drive, Neon Strip, Wynwood, Coral Heights & North Beach
  const hotelMarquees = [
    { title: 'HOTEL SOLAIRE', sub: 'OCEAN DRIVE · ART DECO', bg: '#1e102b', fg: '#ff6ca8', acc: '#2cf3ff', x: 125, z: -65 },
    { title: 'THE FLAMINGO', sub: 'ROOFTOP LOUNGE & BAR', bg: '#161b30', fg: '#ffd166', acc: '#ff4d8d', x: 125, z: 25 },
    { title: 'PALM ROYALE', sub: 'SOUTH BEACH SUITES', bg: '#0e242c', fg: '#46f7b4', acc: '#ffcf5c', x: 125, z: 112 },
    { title: 'CLUB NEON', sub: 'OPEN LATE · LIVE SYNTH', bg: '#180c2e', fg: '#2cf3ff', acc: '#ff2e93', x: -5, z: -65 },
    { title: 'VELVET PALMS', sub: 'MIDTOWN NIGHTCLUB', bg: '#220f24', fg: '#ff70a6', acc: '#ffe066', x: -5, z: 25 },
    { title: 'MARINA CLUB', sub: 'YACHT CHARTERS & GRILL', bg: '#0c2032', fg: '#72efdd', acc: '#ffb703', x: 12, z: 145 },
    { title: 'WYNWOOD WALLS', sub: 'STREET ART · GALLERIES', bg: '#1a1030', fg: '#ffcf5c', acc: '#ff2e93', x: -185, z: -245 },
    { title: 'SOL ARENA', sub: 'LIVE CONCERTS & HOOPS', bg: '#0c182e', fg: '#2cf3ff', acc: '#ff4d8d', x: -275, z: -245 },
    { title: 'CAFE HABANA', sub: 'CORAL HEIGHTS · ESPRESSO', bg: '#2c1610', fg: '#ffd166', acc: '#ff8a3d', x: -275, z: 25 },
    { title: 'BAYSIDE RESORT', sub: 'NORTH BEACH TOWERS', bg: '#0c2233', fg: '#72efdd', acc: '#2cf3ff', x: 125, z: -245 },
  ];

  for (const m of hotelMarquees) {
    const tex = createNeonSignTexture(m.title, m.sub, m.bg, m.fg, m.acc);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });
    signMaterials.push(mat);

    const signFrame = new THREE.Group();
    signFrame.position.set(m.x, 5.8, m.z);
    signFrame.rotation.y = Math.PI * 0.5;

    const board = new THREE.Mesh(new THREE.BoxGeometry(8.6, 2.7, 0.35), [
      poleMat,
      poleMat,
      poleMat,
      poleMat,
      mat,
      mat,
    ]);
    board.castShadow = true;
    signFrame.add(board);

    // Support brackets into facade
    for (const bx of [-3.2, 3.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5.8, 6), poleMat);
      post.position.set(bx, -2.9, 0);
      signFrame.add(post);
    }

    root.add(signFrame);
  }

  // 4. Roadside & Rooftop Miami Billboards
  const billboards = [
    {
      headline: 'SOLSTICE GT',
      sub: '0-60 IN 2.6s · OWN THE COAST',
      a: '#181436',
      b: '#ff427b',
      badge: 'SOL MOTORS',
      x: 151,
      z: -155,
      yaw: -0.35,
    },
    {
      headline: 'VICE WAVE 98.5',
      sub: 'NON-STOP SUNSET SYNTH & COASTAL BEATS',
      a: '#0c1f3a',
      b: '#00b4d8',
      badge: 'LIVE ON AIR',
      x: -102,
      z: -62,
      yaw: Math.PI * 0.5,
    },
    {
      headline: 'KEY SOL VILLAS',
      sub: 'PRIVATE ISLAND LIVING ACROSS THE CAUSEWAY',
      a: '#122938',
      b: '#18a999',
      badge: 'LUXURY REALTY',
      x: 152,
      z: -188,
      yaw: 0.25,
    },
    {
      headline: 'SOL COLA',
      sub: 'ICE COLD MIAMI CITRUS REFRESHMENT',
      a: '#4a1228',
      b: '#ff8a3d',
      badge: 'STAY COOL',
      x: -188,
      z: 112,
      yaw: 0.4,
    },
  ];

  for (const bb of billboards) {
    const tex = createBillboardTexture(bb.headline, bb.sub, bb.a, bb.b, bb.badge);
    const faceMat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0.65,
      roughness: 0.35,
    });
    signMaterials.push(faceMat);

    const g = new THREE.Group();
    g.position.set(bb.x, getGroundHeight(bb.x, bb.z), bb.z);
    g.rotation.y = bb.yaw;

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 8.2, 10), poleMat);
    leg.position.y = 4.1;
    leg.castShadow = true;
    g.add(leg);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(11.5, 5.4, 0.48), [
      poleMat,
      poleMat,
      poleMat,
      poleMat,
      faceMat,
      faceMat,
    ]);
    panel.position.y = 9.4;
    panel.castShadow = true;
    g.add(panel);

    root.add(g);
  }

  // 5. Ocean Drive Sidewalk Cafés (striped umbrellas, bistro tables, benches) & Tropical Bougainvillea Planters
  const cafeColors = [0xff5e8e, 0x22d3ee, 0xf59e0b, 0x34d399];
  for (let z = -155; z <= 125; z += 26) {
    if (STREET_ZS.some((sz) => Math.abs(z - sz) < 16)) continue;

    // Bistro café table + 2 chairs + parasol on west sidewalk of Ocean Drive
    const cafe = new THREE.Group();
    cafe.position.set(129.2, SIDEWALK_HEIGHT, z);
    const tablePost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.78, 8), poleMat);
    tablePost.position.y = 0.39;
    cafe.add(tablePost);
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 14), planterStoneMat);
    tableTop.position.y = 0.78;
    tableTop.castShadow = true;
    cafe.add(tableTop);

    const umbPole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6), poleMat);
    umbPole.position.y = 1.25;
    cafe.add(umbPole);
    const umbTop = new THREE.Mesh(
      new THREE.ConeGeometry(1.55, 0.52, 10),
      new THREE.MeshStandardMaterial({ color: cafeColors[Math.abs(z) % cafeColors.length], roughness: 0.65 }),
    );
    umbTop.position.y = 2.5;
    umbTop.castShadow = true;
    cafe.add(umbTop);
    root.add(cafe);

    // Tropical bougainvillea stone planter along boardwalk edge
    const planter = new THREE.Group();
    planter.position.set(151.0, 0.0, z + 10);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 4.6), planterStoneMat);
    box.position.y = 0.28;
    box.castShadow = true;
    planter.add(box);
    const bush = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, 4.2), hedgeMat);
    bush.position.y = 0.78;
    bush.castShadow = true;
    planter.add(bush);
    // Vibrant Miami magenta blossoms dot the hedge
    for (let b = -1.6; b <= 1.6; b += 0.85) {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 6), blossomMat);
      flower.position.set((rng() - 0.5) * 0.6, 1.05 + rng() * 0.14, b);
      planter.add(flower);
    }
    root.add(planter);
  }

  // 6. Park Benches in Palm Plaza & along the Boardwalk + Fire Hydrants at street corners
  const benchCoords = [
    { x: 16, z: 16, yaw: 0.78 },
    { x: 34, z: 16, yaw: -0.78 },
    { x: 16, z: 34, yaw: 2.35 },
    { x: 34, z: 34, yaw: -2.35 },
    { x: 163.5, z: -55, yaw: Math.PI * 0.5 },
    { x: 163.5, z: 15, yaw: Math.PI * 0.5 },
    { x: 163.5, z: 85, yaw: Math.PI * 0.5 },
  ];
  for (const bc of benchCoords) {
    const bench = new THREE.Group();
    bench.position.set(bc.x, getGroundHeight(bc.x, bc.z), bc.z);
    bench.rotation.y = bc.yaw;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.56), woodBenchMat);
    seat.position.y = 0.48;
    seat.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.42, 0.08), woodBenchMat);
    back.position.set(0, 0.78, 0.24);
    back.rotation.x = -0.15;
    bench.add(seat, back);
    for (const lx of [-0.85, 0.85]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.5), poleMat);
      leg.position.set(lx, 0.24, 0);
      bench.add(leg);
    }
    root.add(bench);
  }

  // Fire hydrants near avenue corners
  for (const ax of AVENUE_XS) {
    for (const sz of STREET_ZS) {
      if ((ax + sz) % 40 !== 0) continue;
      const hyd = new THREE.Group();
      hyd.position.set(ax + 9.2, 0.24, sz + 9.2);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.72, 8), hydrantMat);
      cyl.position.y = 0.36;
      cyl.castShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), hydrantMat);
      cap.position.y = 0.74;
      hyd.add(cyl, cap);
      root.add(hyd);
    }
  }

  // 6b. Beach Loungers & Colorful Towels resting flush on the sculpted Sol Beach dunes
  const towelColors = [0xff5e8e, 0x22d3ee, 0xffd166, 0x34d399, 0xa855f7];
  const loungerFrameMat = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.45 });
  for (const prop of blueprint.beachProps) {
    if (prop.kind !== 'umbrella') continue;
    const tx = prop.x + 1.5;
    const tz = prop.z + 0.8;
    const ty = getGroundHeight(tx, tz);
    const col = towelColors[Math.abs(Math.round(prop.z)) % towelColors.length];
    const towelMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.86 });

    const lounger = new THREE.Group();
    lounger.position.set(tx, ty + 0.02, tz);
    lounger.rotation.y = Math.PI * 0.5 + (rng() - 0.5) * 0.35;
    // Slight tilt to match local sand slope
    const slopeX = getGroundHeight(tx + 1, tz) - getGroundHeight(tx - 1, tz);
    lounger.rotation.x = Math.atan2(slopeX, 2) * 0.65;

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 1.85), loungerFrameMat);
    base.position.y = 0.24;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 1.45), towelMat);
    cushion.position.set(0, 0.3, 0.16);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.62), towelMat);
    backrest.position.set(0, 0.44, -0.68);
    backrest.rotation.x = 0.52;
    lounger.add(base, cushion, backrest);
    root.add(lounger);
  }

  // 7. Additive Streetlamp Light Halos (creates real cinematic night atmosphere!)
  for (const sl of blueprint.streetLights) {
    const mat = new THREE.SpriteMaterial({
      map: glowTex,
      color: sl.color,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const dx = Math.sin(sl.yaw) * 1.35;
    const dz = Math.cos(sl.yaw) * 1.35;
    sprite.position.set(sl.x + dx, sl.y + 6.5, sl.z + dz);
    sprite.scale.set(4.5, 4.5, 1);
    root.add(sprite);
    lightHalos.push(sprite);
  }

  // 8. Coastal Seagulls soaring lazily above Sol Beach, South Pier, and Marina Cove
  const gullMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.6 });
  const wingGeo = new THREE.BoxGeometry(0.65, 0.04, 0.2);
  const bodyGeo = new THREE.CapsuleGeometry(0.08, 0.32, 4, 6);
  bodyGeo.rotateX(Math.PI * 0.5);

  const gullFlocks = [
    { cx: 225, cz: SOUTH_PIER.centerZ, r: 34, alt: 19 },
    { cx: 195, cz: 35, r: 42, alt: 24 },
    { cx: 195, cz: -75, r: 38, alt: 22 },
    { cx: -10, cz: 215, r: 36, alt: 21 },
  ];

  for (let i = 0; i < 12; i++) {
    const flock = gullFlocks[i % gullFlocks.length];
    const g = new THREE.Group();
    const bMesh = new THREE.Mesh(bodyGeo, gullMat);
    const lWing = new THREE.Mesh(wingGeo, gullMat);
    lWing.position.x = -0.34;
    const rWing = new THREE.Mesh(wingGeo, gullMat);
    rWing.position.x = 0.34;
    g.add(bMesh, lWing, rWing);
    root.add(g);

    seagulls.push({
      group: g,
      leftWing: lWing,
      rightWing: rWing,
      centerX: flock.cx + (rng() - 0.5) * 18,
      centerZ: flock.cz + (rng() - 0.5) * 18,
      radius: flock.r + (rng() - 0.5) * 14,
      altitude: flock.alt + (rng() - 0.5) * 8,
      speed: 0.28 + rng() * 0.16,
      phase: rng() * Math.PI * 2,
    });
  }

  scene.add(root);

  return {
    root,
    update(elapsed: number, nightFactor: number) {
      // Live traffic signal cycle (Green -> Amber -> Red)
      for (const sig of signals) {
        const cycle = (elapsed + sig.phaseOffset) % 14;
        const isGreen = cycle < 7;
        const isAmber = cycle >= 7 && cycle < 9;
        const isRed = cycle >= 9;
        const boost = 1.4 + nightFactor * 1.6;
        sig.greenMat.emissiveIntensity = isGreen ? boost : 0.05;
        sig.amberMat.emissiveIntensity = isAmber ? boost : 0.05;
        sig.redMat.emissiveIntensity = isRed ? boost : 0.05;
      }

      // Brighten neon hotel marquees, billboards & streetlamp halos dramatically at dusk/night
      const signGlow = 0.35 + nightFactor * 1.15;
      for (const sm of signMaterials) {
        sm.emissiveIntensity = signGlow;
      }
      const haloOpacity = 0.14 + nightFactor * 0.65;
      const haloScale = 3.2 + nightFactor * 3.8;
      for (const sp of lightHalos) {
        sp.material.opacity = haloOpacity;
        sp.scale.set(haloScale, haloScale, 1);
      }

      // Animate circling seagulls with gentle wing flaps & banked turns
      for (const gull of seagulls) {
        const ang = elapsed * gull.speed + gull.phase;
        const x = gull.centerX + Math.cos(ang) * gull.radius;
        const z = gull.centerZ + Math.sin(ang) * gull.radius;
        const y = gull.altitude + Math.sin(elapsed * 0.9 + gull.phase) * 1.6;
        gull.group.position.set(x, y, z);
        gull.group.rotation.y = -ang;
        gull.group.rotation.z = 0.18;
        const flap = Math.sin(elapsed * 5.2 + gull.phase * 3) * 0.38;
        gull.leftWing.rotation.z = flap;
        gull.rightWing.rotation.z = -flap;
      }
    },
  };
}
