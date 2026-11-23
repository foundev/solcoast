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
import {
  createCurbstonePbr,
  createDistrictSidewalkPbr,
  createStormGrateTexture,
  createTactilePadTexture,
  type SidewalkDistrictStyle,
} from './textures';
import type { InteriorPropKind } from './assets';
import type { CityBlueprint } from './types';

export interface StreetPropsHandles {
  root: THREE.Group;
  attachGltfProps: (propsMap: Map<InteriorPropKind, THREE.Group>) => void;
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

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x262d3a, metalness: 0.78, roughness: 0.3 });
  const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xd92b3a, roughness: 0.42, metalness: 0.35 });
  const woodBenchMat = new THREE.MeshStandardMaterial({ color: 0x8a5b38, roughness: 0.75 });
  const planterStoneMat = new THREE.MeshStandardMaterial({ color: 0xe6dfd4, roughness: 0.8 });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x276e3c, roughness: 0.88 });
  const blossomMat = new THREE.MeshStandardMaterial({ color: 0xf2388f, roughness: 0.65 });

  // 1. Redesigned Architectural Miami Sidewalks:
  //    - Rounded/chamfered street corners with beveled granite curbstones (zero flat grey boxes!)
  //    - District-specific high-res 512px PBR sidewalk paving (Coastal Terrazzo, Coral Heights Travertine, Urban Concrete)
  //    - Concrete street gutter aprons, cast-iron storm drains, ADA yellow tactile curb ramps, & palm tree grates!
  const halfRoad = ROAD_WIDTH * 0.5;
  const cornerR = 2.4;
  const bevelSize = 0.04;
  const bevelThick = 0.035;

  const createRoundedBlockGeometry = (w: number, d: number): THREE.ExtrudeGeometry => {
    const hw = w * 0.5 - bevelSize;
    const hd = d * 0.5 - bevelSize;
    const r = Math.min(cornerR, hw * 0.4, hd * 0.4);
    const shape = new THREE.Shape();
    shape.moveTo(-hw + r, -hd);
    shape.lineTo(hw - r, -hd);
    shape.absarc(hw - r, -hd + r, r, -Math.PI * 0.5, 0, false);
    shape.lineTo(hw, hd - r);
    shape.absarc(hw - r, hd - r, r, 0, Math.PI * 0.5, false);
    shape.lineTo(-hw + r, hd);
    shape.absarc(-hw + r, hd - r, r, Math.PI * 0.5, Math.PI, false);
    shape.lineTo(-hw, -hd + r);
    shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);

    const depth = Math.max(0.05, SIDEWALK_HEIGHT - bevelThick * 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevelThick,
      bevelSize,
      bevelSegments: 2,
      curveSegments: 6,
    });
    // Rotate so extrusion rises along +Y with bottom at y = 0 and top cleanly at y = SIDEWALK_HEIGHT
    geo.rotateX(-Math.PI * 0.5);
    geo.translate(0, bevelThick, 0);

    // Normalize UVs to exact real-world meters (1 tile = 2.4m x 2.4m slabs, ZERO stretching!)
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const ny = Math.abs(norm.getY(i));
      if (ny > 0.65) {
        uv.setXY(i, px / 2.4, pz / 2.4);
      } else {
        // Vertical curbstone face: map perimeter length along U, height along V
        const nx = Math.abs(norm.getX(i));
        const uCoord = nx > 0.5 ? pz : px;
        uv.setXY(i, uCoord / 1.4, 1 - py / SIDEWALK_HEIGHT);
      }
    }
    uv.needsUpdate = true;
    return geo;
  };

  const coastalPbr = createDistrictSidewalkPbr('coastal');
  const medPbr = createDistrictSidewalkPbr('mediterranean');
  const urbanPbr = createDistrictSidewalkPbr('urban');
  const curbPbr = createCurbstonePbr();

  const sidewalkTopMats: Record<SidewalkDistrictStyle, THREE.MeshStandardMaterial> = {
    coastal: new THREE.MeshStandardMaterial({
      map: coastalPbr.map,
      normalMap: coastalPbr.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: coastalPbr.roughnessMap,
      roughness: 1.0,
    }),
    mediterranean: new THREE.MeshStandardMaterial({
      map: medPbr.map,
      normalMap: medPbr.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: medPbr.roughnessMap,
      roughness: 1.0,
    }),
    urban: new THREE.MeshStandardMaterial({
      map: urbanPbr.map,
      normalMap: urbanPbr.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: urbanPbr.roughnessMap,
      roughness: 1.0,
    }),
  };

  const curbEdgeMat = new THREE.MeshStandardMaterial({
    map: curbPbr.map,
    normalMap: curbPbr.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.84,
  });

  const blockGeoCache = new Map<string, THREE.ExtrudeGeometry>();
  const getBlockGeo = (w: number, d: number) => {
    const key = `${w.toFixed(1)}x${d.toFixed(1)}`;
    let g = blockGeoCache.get(key);
    if (!g) {
      g = createRoundedBlockGeometry(w, d);
      blockGeoCache.set(key, g);
    }
    return g;
  };

  // Collect instanced sidewalk street-level details across all 36 blocks
  const gutterMatrices: THREE.Matrix4[] = [];
  const tactileMatrices: THREE.Matrix4[] = [];
  const grateMatrices: THREE.Matrix4[] = [];
  const bollardMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();

  for (let bx = 0; bx < AVENUE_XS.length - 1; bx++) {
    for (let bz = 0; bz < STREET_ZS.length - 1; bz++) {
      const minX = AVENUE_XS[bx] + halfRoad + 0.4;
      const maxX = AVENUE_XS[bx + 1] - halfRoad - 0.4;
      const minZ = STREET_ZS[bz] + halfRoad + 0.4;
      const maxZ = STREET_ZS[bz + 1] - halfRoad - 0.4;
      const w = maxX - minX;
      const d = maxZ - minZ;
      const cx = (minX + maxX) * 0.5;
      const cz = (minZ + maxZ) * 0.5;

      // Pick district-specific sidewalk paving style
      const style: SidewalkDistrictStyle =
        bx >= 5 || (bz <= 1 && bx >= 4)
          ? 'coastal'
          : bx <= 1 && bz >= 2
            ? 'mediterranean'
            : 'urban';

      const blockMesh = new THREE.Mesh(getBlockGeo(w, d), [sidewalkTopMats[style], curbEdgeMat]);
      blockMesh.position.set(cx, 0, cz);
      blockMesh.receiveShadow = true;
      root.add(blockMesh);

      // Concrete drainage gutter apron strips along all 4 road edges (flush at y = 0.032)
      const gutterW = 0.62;
      const edgeLenX = w - cornerR * 2;
      const edgeLenZ = d - cornerR * 2;
      for (const side of [-1, 1]) {
        // North & South gutters
        dummy.position.set(cx, 0.032, cz + side * (d * 0.5 + gutterW * 0.5 - 0.02));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(edgeLenX, 1, gutterW);
        dummy.updateMatrix();
        gutterMatrices.push(dummy.matrix.clone());

        // East & West gutters
        dummy.position.set(cx + side * (w * 0.5 + gutterW * 0.5 - 0.02), 0.032, cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(gutterW, 1, edgeLenZ);
        dummy.updateMatrix();
        gutterMatrices.push(dummy.matrix.clone());

        // Cast-iron storm drain grates nestled into the avenue gutters (2 per block side)
        for (const zOff of [-0.28, 0.28]) {
          dummy.position.set(cx + side * (w * 0.5 + 0.28), 0.038, cz + d * zOff);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.54, 1, 0.92);
          dummy.updateMatrix();
          grateMatrices.push(dummy.matrix.clone());
        }
      }

      // Bright safety-yellow ADA tactile curb-ramp warning pads at all 4 crosswalk corners!
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          // Pad facing N/S crosswalk
          dummy.position.set(cx + sx * (w * 0.5 - 3.0), SIDEWALK_HEIGHT + 0.008, cz + sz * (d * 0.5 - 0.58));
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(2.1, 1, 0.72);
          dummy.updateMatrix();
          tactileMatrices.push(dummy.matrix.clone());

          // Pad facing E/W crosswalk
          dummy.position.set(cx + sx * (w * 0.5 - 0.58), SIDEWALK_HEIGHT + 0.008, cz + sz * (d * 0.5 - 3.0));
          dummy.rotation.set(0, Math.PI * 0.5, 0);
          dummy.scale.set(2.1, 1, 0.72);
          dummy.updateMatrix();
          tactileMatrices.push(dummy.matrix.clone());

          // Sleek charcoal corner safety bollards guarding the rounded curb corner
          dummy.position.set(cx + sx * (w * 0.5 - 1.15), SIDEWALK_HEIGHT, cz + sz * (d * 0.5 - 1.15));
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          bollardMatrices.push(dummy.matrix.clone());
        }
      }
    }
  }

  // Batch gutters, tactile ADA pads, storm drain grates, & corner bollards into 4 single draw calls!
  const gutterGeo = new THREE.PlaneGeometry(1, 1);
  gutterGeo.rotateX(-Math.PI * 0.5);
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x8e9199, roughness: 0.9 });
  const gutterInst = new THREE.InstancedMesh(gutterGeo, gutterMat, gutterMatrices.length);
  gutterInst.receiveShadow = true;
  gutterMatrices.forEach((m, i) => gutterInst.setMatrixAt(i, m));
  gutterInst.instanceMatrix.needsUpdate = true;
  root.add(gutterInst);

  const tactileGeo = new THREE.PlaneGeometry(1, 1);
  tactileGeo.rotateX(-Math.PI * 0.5);
  const tactileMat = new THREE.MeshStandardMaterial({ map: createTactilePadTexture(), roughness: 0.65 });
  const tactileInst = new THREE.InstancedMesh(tactileGeo, tactileMat, tactileMatrices.length);
  tactileInst.receiveShadow = true;
  tactileMatrices.forEach((m, i) => tactileInst.setMatrixAt(i, m));
  tactileInst.instanceMatrix.needsUpdate = true;
  root.add(tactileInst);

  const grateGeo = new THREE.PlaneGeometry(1, 1);
  grateGeo.rotateX(-Math.PI * 0.5);
  const grateMat = new THREE.MeshStandardMaterial({
    map: createStormGrateTexture(),
    metalness: 0.75,
    roughness: 0.45,
  });
  const grateInst = new THREE.InstancedMesh(grateGeo, grateMat, grateMatrices.length);
  grateMatrices.forEach((m, i) => grateInst.setMatrixAt(i, m));
  grateInst.instanceMatrix.needsUpdate = true;
  root.add(grateInst);

  const bollardGeo = new THREE.CylinderGeometry(0.085, 0.1, 0.82, 10);
  bollardGeo.translate(0, 0.41, 0);
  const bollardInst = new THREE.InstancedMesh(bollardGeo, poleMat, bollardMatrices.length);
  bollardMatrices.forEach((m, i) => bollardInst.setMatrixAt(i, m));
  bollardInst.instanceMatrix.needsUpdate = true;
  root.add(bollardInst);

  // Cast-iron decorative tree grates framing concrete sidewalk palm trees (skip park lawn palms!)
  const inParkLawn = (x: number, z: number) =>
    (x > -8 && x < 58 && z > -8 && z < 58) || (x > -368 && x < -302 && z > -8 && z < 58);
  const sidewalkPalms = blueprint.palms.filter(
    (p) => Math.abs(p.y - SIDEWALK_HEIGHT) < 0.03 && !inParkLawn(p.x, p.z),
  );
  if (sidewalkPalms.length > 0) {
    const grateRingGeo = new THREE.BoxGeometry(1.55, 0.03, 1.55);
    const treeGrateMat = new THREE.MeshStandardMaterial({
      map: createStormGrateTexture(),
      color: 0x3b404a,
      metalness: 0.65,
      roughness: 0.55,
    });
    const treeGrateInst = new THREE.InstancedMesh(grateRingGeo, treeGrateMat, sidewalkPalms.length);
    sidewalkPalms.forEach((p, i) => {
      dummy.position.set(p.x, SIDEWALK_HEIGHT + 0.012, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      treeGrateInst.setMatrixAt(i, dummy.matrix);
    });
    treeGrateInst.instanceMatrix.needsUpdate = true;
    root.add(treeGrateInst);
  }

  // 2. Live Cycling Intersection Traffic Signal Gantries (shared exact coords with blueprint.propObbs!)
  const signalBoxMat = new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.5, metalness: 0.4 });
  for (const sigSpec of blueprint.trafficSignals) {
      const redMat = new THREE.MeshStandardMaterial({ color: 0x330808, emissive: 0xff1e2d, emissiveIntensity: 0.2 });
      const amberMat = new THREE.MeshStandardMaterial({ color: 0x332406, emissive: 0xffb703, emissiveIntensity: 0.1 });
      const greenMat = new THREE.MeshStandardMaterial({ color: 0x063318, emissive: 0x22ff77, emissiveIntensity: 2.2 });

      signals.push({ redMat, amberMat, greenMat, phaseOffset: sigSpec.phaseOffset });

      const gantry = new THREE.Group();
      gantry.position.set(sigSpec.x, sigSpec.y, sigSpec.z);

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

  // 3. Readable Neon Hotel & District Marquees (shared exact coords with blueprint.propObbs!)
  for (const m of blueprint.marquees) {
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

  // 4. Roadside & Rooftop Miami Billboards (shared exact coords with blueprint.propObbs!)
  for (const bb of blueprint.billboards) {
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
    g.position.set(bb.x, bb.y, bb.z);
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

  // 5. Ocean Drive Sidewalk Cafés & Tropical Bougainvillea Planters (exact blueprint coords!)
  for (const sc of blueprint.sidewalkCafes) {
    const cafe = new THREE.Group();
    cafe.position.set(sc.x, sc.y, sc.z);
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
      new THREE.MeshStandardMaterial({ color: sc.color, roughness: 0.65 }),
    );
    umbTop.position.y = 2.5;
    umbTop.castShadow = true;
    cafe.add(umbTop);
    root.add(cafe);
  }

  for (const pl of blueprint.planters) {
    const planter = new THREE.Group();
    planter.position.set(pl.x, pl.y, pl.z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 4.6), planterStoneMat);
    box.position.y = 0.28;
    box.castShadow = true;
    planter.add(box);
    const bush = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, 4.2), hedgeMat);
    bush.position.y = 0.78;
    bush.castShadow = true;
    planter.add(bush);
    for (let b = -1.6; b <= 1.6; b += 0.85) {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 6), blossomMat);
      flower.position.set((rng() - 0.5) * 0.6, 1.05 + rng() * 0.14, b);
      planter.add(flower);
    }
    root.add(planter);
  }

  // 6. Park Benches in Palm Plaza & along the Boardwalk + Fire Hydrants at street corners
  for (const bc of blueprint.benches) {
    const bench = new THREE.Group();
    bench.position.set(bc.x, bc.y, bc.z);
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
  for (const hy of blueprint.hydrants) {
    const hyd = new THREE.Group();
    hyd.position.set(hy.x, hy.y, hy.z);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.72, 8), hydrantMat);
    cyl.position.y = 0.36;
    cyl.castShadow = true;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), hydrantMat);
    cap.position.y = 0.74;
    hyd.add(cyl, cap);
    root.add(hyd);
  }

  // 6b. Beach Loungers & Colorful Towels resting flush on the sculpted Sol Beach dunes
  const fallbackLoungersRoot = new THREE.Group();
  root.add(fallbackLoungersRoot);
  const gltfStreetPropsRoot = new THREE.Group();
  root.add(gltfStreetPropsRoot);

  const loungerFrameMat = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.45 });
  for (const lg of blueprint.loungers) {
    const towelMat = new THREE.MeshStandardMaterial({ color: lg.color, roughness: 0.86 });
    const lounger = new THREE.Group();
    lounger.position.set(lg.x, lg.y, lg.z);
    lounger.rotation.y = lg.yaw;
    const slopeX = getGroundHeight(lg.x + 1, lg.z) - getGroundHeight(lg.x - 1, lg.z);
    lounger.rotation.x = Math.atan2(slopeX, 2) * 0.65;

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.08, 1.85), loungerFrameMat);
    base.position.y = 0.24;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 1.45), towelMat);
    cushion.position.set(0, 0.3, 0.16);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.62), towelMat);
    backrest.position.set(0, 0.44, -0.68);
    backrest.rotation.x = 0.52;
    lounger.add(base, cushion, backrest);
    fallbackLoungersRoot.add(lounger);
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
    attachGltfProps(propsMap: Map<InteriorPropKind, THREE.Group>) {
      const loungerSrc = propsMap.get('prop_beach_lounger');
      if (loungerSrc) {
        for (const lg of blueprint.loungers) {
          const inst = loungerSrc.clone(true);
          inst.position.set(lg.x, lg.y, lg.z);
          inst.rotation.y = lg.yaw;
          const slopeX = getGroundHeight(lg.x + 1, lg.z) - getGroundHeight(lg.x - 1, lg.z);
          inst.rotation.x = Math.atan2(slopeX, 2) * 0.65;
          inst.traverse((obj) => {
            if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
              if (/TintTowel/i.test(obj.material.name)) {
                const m = obj.material.clone();
                m.color.setHex(lg.color);
                obj.material = m;
              }
            }
          });
          gltfStreetPropsRoot.add(inst);
        }
        fallbackLoungersRoot.visible = false;
      }
    },
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
