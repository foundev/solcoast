import * as THREE from 'three';
import { createRng } from '../core/math';
import {
  AVENUE_XS,
  ROAD_WIDTH,
  SIDEWALK_HEIGHT,
  SOUTH_PIER,
  STREET_ZS,
  getGroundHeight,
  getTerrainHeight,
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

  // 1. Terrain-Conforming Architectural Miami Sidewalks across all 64 city blocks:
  //    - Subdivided top paving mesh draped cleanly onto getTerrainHeight(x, z) + SIDEWALK_HEIGHT so sidewalks
  //      rise & slope naturally with rolling hills, plus deep granite curb skirts down into the roadbed!
  //    - District-specific high-res 512px PBR sidewalk paving (Coastal Terrazzo, Coral Heights Travertine, Urban Concrete)
  //    - Slope-aligned concrete gutters, cast-iron storm drains, ADA yellow tactile curb ramps, & palm tree grates!
  const halfRoad = ROAD_WIDTH * 0.5;
  const cornerR = 2.4;

  const createTerrainBlockMeshes = (
    cx: number,
    cz: number,
    w: number,
    d: number,
    topMat: THREE.MeshStandardMaterial,
    curbMat: THREE.MeshStandardMaterial,
  ): THREE.Group => {
    const g = new THREE.Group();
    const segs = 8;

    // Top paved sidewalk surface conforming vertex-by-vertex to rolling terrain
    const topGeo = new THREE.PlaneGeometry(w, d, segs, segs);
    topGeo.rotateX(-Math.PI * 0.5);
    const tPos = topGeo.attributes.position;
    const tUv = topGeo.attributes.uv;
    for (let i = 0; i < tPos.count; i++) {
      const lx = tPos.getX(i);
      const lz = tPos.getZ(i);
      tPos.setY(i, getTerrainHeight(cx + lx, cz + lz) + SIDEWALK_HEIGHT);
      tUv.setXY(i, lx / 2.4, lz / 2.4);
    }
    topGeo.computeVertexNormals();
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.set(cx, 0, cz);
    topMesh.receiveShadow = true;
    g.add(topMesh);

    // 4-sided terrain-hugging granite curbstone skirt dropping 0.65m below road surface
    const skirtVerts: number[] = [];
    const skirtUvs: number[] = [];
    const skirtIdx: number[] = [];
    let vBase = 0;
    const addCurbSide = (x0: number, z0: number, x1: number, z1: number) => {
      const steps = segs;
      const sideLen = Math.hypot(x1 - x0, z1 - z0);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const wx = x0 + (x1 - x0) * t;
        const wz = z0 + (z1 - z0) * t;
        const ty = getTerrainHeight(wx, wz);
        skirtVerts.push(wx, ty + SIDEWALK_HEIGHT, wz);
        skirtVerts.push(wx, ty - 0.55, wz);
        skirtUvs.push((t * sideLen) / 1.4, 0);
        skirtUvs.push((t * sideLen) / 1.4, 1);
        if (s < steps) {
          const i0 = vBase + s * 2;
          skirtIdx.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
        }
      }
      vBase += (steps + 1) * 2;
    };
    const xL = cx - w * 0.5;
    const xR = cx + w * 0.5;
    const zN = cz - d * 0.5;
    const zS = cz + d * 0.5;
    addCurbSide(xL, zS, xR, zS); // South face (+Z)
    addCurbSide(xR, zS, xR, zN); // East face (+X)
    addCurbSide(xR, zN, xL, zN); // North face (-Z)
    addCurbSide(xL, zN, xL, zS); // West face (-X)

    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtVerts, 3));
    skirtGeo.setAttribute('uv', new THREE.Float32BufferAttribute(skirtUvs, 2));
    skirtGeo.setIndex(skirtIdx);
    skirtGeo.computeVertexNormals();
    const skirtMesh = new THREE.Mesh(skirtGeo, curbMat);
    skirtMesh.receiveShadow = true;
    g.add(skirtMesh);
    return g;
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

  // Collect instanced sidewalk street-level details across all 64 city blocks
  const tactileMatrices: THREE.Matrix4[] = [];
  const grateMatrices: THREE.Matrix4[] = [];
  const bollardMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  const sNorm = new THREE.Vector3();
  const sQuat = new THREE.Quaternion();
  const yQuat = new THREE.Quaternion();
  const alignToTerrain = (wx: number, wz: number, yaw = 0) => {
    const hx = (getTerrainHeight(wx + 1.5, wz) - getTerrainHeight(wx - 1.5, wz)) / 3.0;
    const hz = (getTerrainHeight(wx, wz + 1.5) - getTerrainHeight(wx, wz - 1.5)) / 3.0;
    sNorm.set(-hx, 1, -hz).normalize();
    sQuat.setFromUnitVectors(upVec, sNorm);
    if (yaw !== 0) {
      yQuat.setFromAxisAngle(upVec, yaw);
      sQuat.multiply(yQuat);
    }
    return sQuat;
  };

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

      // Pick district-specific sidewalk paving style by world position
      const style: SidewalkDistrictStyle =
        cx >= 70 || (cz <= -200 && cx >= -20)
          ? 'coastal'
          : cx <= -200
            ? 'mediterranean'
            : 'urban';

      root.add(createTerrainBlockMeshes(cx, cz, w, d, sidewalkTopMats[style], curbEdgeMat));

      // Cast-iron storm drain grates nestled into the avenue gutters (2 per block side)
      for (const side of [-1, 1]) {
        for (const zOff of [-0.28, 0.28]) {
          const gx = cx + side * (w * 0.5 + 0.28);
          const gz = cz + d * zOff;
          dummy.position.set(gx, getTerrainHeight(gx, gz) + 0.044, gz);
          dummy.quaternion.copy(alignToTerrain(gx, gz, 0));
          dummy.scale.set(0.54, 1, 0.92);
          dummy.updateMatrix();
          grateMatrices.push(dummy.matrix.clone());
        }
      }

      // Bright safety-yellow ADA tactile curb-ramp warning pads & corner bollards on rolling terrain!
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const tx1 = cx + sx * (w * 0.5 - 3.0);
          const tz1 = cz + sz * (d * 0.5 - 0.58);
          dummy.position.set(tx1, getTerrainHeight(tx1, tz1) + SIDEWALK_HEIGHT + 0.015, tz1);
          dummy.quaternion.copy(alignToTerrain(tx1, tz1, 0));
          dummy.scale.set(2.1, 1, 0.72);
          dummy.updateMatrix();
          tactileMatrices.push(dummy.matrix.clone());

          const tx2 = cx + sx * (w * 0.5 - 0.58);
          const tz2 = cz + sz * (d * 0.5 - 3.0);
          dummy.position.set(tx2, getTerrainHeight(tx2, tz2) + SIDEWALK_HEIGHT + 0.015, tz2);
          dummy.quaternion.copy(alignToTerrain(tx2, tz2, Math.PI * 0.5));
          dummy.scale.set(2.1, 1, 0.72);
          dummy.updateMatrix();
          tactileMatrices.push(dummy.matrix.clone());

          // Sleek charcoal corner safety bollards guarding each corner
          const bxPos = cx + sx * (w * 0.5 - 1.15);
          const bzPos = cz + sz * (d * 0.5 - 1.15);
          dummy.position.set(bxPos, getTerrainHeight(bxPos, bzPos) + SIDEWALK_HEIGHT, bzPos);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          bollardMatrices.push(dummy.matrix.clone());
        }
      }
    }
  }
  void cornerR;

  // Batch tactile ADA pads, storm drain grates, & corner bollards into 3 single draw calls!
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
    (x > -8 && x < 58 && z > -8 && z < 58) ||
    (x > -368 && x < -302 && z > -8 && z < 58) ||
    (x > -548 && x < -482 && z > -98 && z < -32);
  const sidewalkPalms = blueprint.palms.filter(
    (p) => Math.abs(p.y - (getTerrainHeight(p.x, p.z) + SIDEWALK_HEIGHT)) < 0.05 && !inParkLawn(p.x, p.z),
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
      dummy.position.set(p.x, p.y + 0.014, p.z);
      dummy.quaternion.copy(alignToTerrain(p.x, p.z, 0));
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      treeGrateInst.setMatrixAt(i, dummy.matrix);
    });
    treeGrateInst.instanceMatrix.needsUpdate = true;
    root.add(treeGrateInst);
  }

  // 1b. Readable 3D Corner Street Name Signs at Every Intersection (crossed Avenue + Cross-Street blades!)
  const streetBladeMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const getStreetBladeMat = (label: string, style: 'green' | 'coastal'): THREE.MeshStandardMaterial => {
    const key = `${style}:${label}`;
    let mat = streetBladeMatCache.get(key);
    if (!mat) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = style === 'coastal' ? '#0d5e66' : '#0f5c35';
      ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = style === 'coastal' ? '#ffd166' : '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, 248, 56);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 128, 33, 232);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.36,
        metalness: 0.18,
      });
      streetBladeMatCache.set(key, mat);
    }
    return mat;
  };

  if (blueprint.streetSigns.length > 0) {
    const signPostGeo = new THREE.CylinderGeometry(0.055, 0.065, 3.5, 8);
    signPostGeo.translate(0, 1.75, 0);
    const signPostInst = new THREE.InstancedMesh(signPostGeo, poleMat, blueprint.streetSigns.length);
    signPostInst.castShadow = true;

    const bladeGeo = new THREE.BoxGeometry(1.38, 0.3, 0.045);
    const bladeEdgeMat = new THREE.MeshStandardMaterial({ color: 0xd8e0ea, roughness: 0.35, metalness: 0.7 });

    blueprint.streetSigns.forEach((ss, idx) => {
      dummy.position.set(ss.x, ss.y, ss.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      signPostInst.setMatrixAt(idx, dummy.matrix);

      const aveMat = getStreetBladeMat(ss.avenueName, ss.style);
      const stMat = getStreetBladeMat(ss.streetName, ss.style);

      // Lower blade runs N-S along the Avenue
      const aveBlade = new THREE.Mesh(bladeGeo, [
        bladeEdgeMat,
        bladeEdgeMat,
        bladeEdgeMat,
        bladeEdgeMat,
        aveMat,
        aveMat,
      ]);
      aveBlade.position.set(ss.x, ss.y + 3.06, ss.z);
      aveBlade.rotation.y = Math.PI * 0.5;
      root.add(aveBlade);

      // Upper perpendicular blade runs E-W along the Cross-Street
      const stBlade = new THREE.Mesh(bladeGeo, [
        bladeEdgeMat,
        bladeEdgeMat,
        bladeEdgeMat,
        bladeEdgeMat,
        stMat,
        stMat,
      ]);
      stBlade.position.set(ss.x, ss.y + 3.38, ss.z);
      root.add(stBlade);
    });
    signPostInst.instanceMatrix.needsUpdate = true;
    root.add(signPostInst);
  }

  // 2. Live Cycling Intersection Traffic Signal Gantries (shared exact coords with blueprint.propObbs!)
  const fallbackSignalsRoot = new THREE.Group();
  root.add(fallbackSignalsRoot);
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

      fallbackSignalsRoot.add(gantry);
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
    signFrame.position.set(m.x, getGroundHeight(m.x, m.z) + 5.8, m.z);
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
  const fallbackCafesRoot = new THREE.Group();
  const fallbackPlantersRoot = new THREE.Group();
  const fallbackBenchesRoot = new THREE.Group();
  const fallbackHydrantsRoot = new THREE.Group();
  root.add(fallbackCafesRoot, fallbackPlantersRoot, fallbackBenchesRoot, fallbackHydrantsRoot);

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
    fallbackCafesRoot.add(cafe);
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
    fallbackPlantersRoot.add(planter);
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
    fallbackBenchesRoot.add(bench);
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
    fallbackHydrantsRoot.add(hyd);
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

      const benchSrc = propsMap.get('prop_park_bench');
      if (benchSrc) {
        for (const bc of blueprint.benches) {
          const inst = benchSrc.clone(true);
          inst.position.set(bc.x, bc.y, bc.z);
          inst.rotation.y = bc.yaw;
          inst.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          gltfStreetPropsRoot.add(inst);
        }
        fallbackBenchesRoot.visible = false;
      }

      const hydrantSrc = propsMap.get('prop_fire_hydrant');
      if (hydrantSrc) {
        for (const hy of blueprint.hydrants) {
          const inst = hydrantSrc.clone(true);
          inst.position.set(hy.x, hy.y, hy.z);
          inst.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          gltfStreetPropsRoot.add(inst);
        }
        fallbackHydrantsRoot.visible = false;
      }

      const planterSrc = propsMap.get('prop_bougainvillea_planter');
      if (planterSrc) {
        for (const pl of blueprint.planters) {
          const inst = planterSrc.clone(true);
          inst.position.set(pl.x, pl.y, pl.z);
          inst.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          gltfStreetPropsRoot.add(inst);
        }
        fallbackPlantersRoot.visible = false;
      }

      const cafeSrc = propsMap.get('prop_sidewalk_cafe');
      if (cafeSrc) {
        for (const sc of blueprint.sidewalkCafes) {
          const inst = cafeSrc.clone(true);
          inst.position.set(sc.x, sc.y, sc.z);
          inst.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            obj.castShadow = true;
            obj.receiveShadow = true;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            const cloned = mats.map((m) => {
              if (m instanceof THREE.MeshStandardMaterial && /TintCanopy/i.test(m.name)) {
                const c = m.clone();
                c.color.setHex(sc.color);
                return c;
              }
              return m;
            });
            obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
          });
          gltfStreetPropsRoot.add(inst);
        }
        fallbackCafesRoot.visible = false;
      }

      const bollardSrc = propsMap.get('prop_bollard');
      if (bollardSrc && bollardMatrices.length > 0) {
        bollardSrc.updateMatrixWorld(true);
        let attachedBollards = 0;
        bollardSrc.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const geo = obj.geometry.clone();
          geo.applyMatrix4(obj.matrixWorld);
          const inst = new THREE.InstancedMesh(geo, obj.material, bollardMatrices.length);
          inst.castShadow = true;
          inst.receiveShadow = true;
          bollardMatrices.forEach((m, i) => inst.setMatrixAt(i, m));
          inst.instanceMatrix.needsUpdate = true;
          gltfStreetPropsRoot.add(inst);
          attachedBollards++;
        });
        if (attachedBollards > 0) {
          bollardInst.visible = false;
        }
      }

      const signalSrc = propsMap.get('prop_traffic_signal');
      if (signalSrc && blueprint.trafficSignals.length > 0) {
        signals.length = 0;
        for (const sigSpec of blueprint.trafficSignals) {
          const inst = signalSrc.clone(true);
          inst.position.set(sigSpec.x, sigSpec.y, sigSpec.z);
          let redMat: THREE.MeshStandardMaterial | null = null;
          let amberMat: THREE.MeshStandardMaterial | null = null;
          let greenMat: THREE.MeshStandardMaterial | null = null;
          inst.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            obj.castShadow = true;
            obj.receiveShadow = true;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            const cloned = mats.map((m) => {
              if (!(m instanceof THREE.MeshStandardMaterial)) return m;
              if (/SigRed/i.test(m.name)) {
                redMat = redMat ?? m.clone();
                return redMat;
              }
              if (/SigAmber/i.test(m.name)) {
                amberMat = amberMat ?? m.clone();
                return amberMat;
              }
              if (/SigGreen/i.test(m.name)) {
                greenMat = greenMat ?? m.clone();
                return greenMat;
              }
              return m;
            });
            obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
          });
          if (redMat && amberMat && greenMat) {
            signals.push({ redMat, amberMat, greenMat, phaseOffset: sigSpec.phaseOffset });
          }
          gltfStreetPropsRoot.add(inst);
        }
        fallbackSignalsRoot.visible = false;
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
