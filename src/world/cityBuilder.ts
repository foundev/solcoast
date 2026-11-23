import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { InteriorPropKind, InteriorTextureKey, InteriorTextureMap, LoadedGameAssets } from './assets';
import {
  BOARDWALK_HEIGHT,
  CAUSEWAY,
  KEY_SOL_BOUNDS,
  SEAWALL_HEIGHT,
  SIDEWALK_HEIGHT,
  SOUTH_PIER,
  getBeachHeight,
  getGroundHeight,
  getShorelineX,
} from './cityData';
import { createFountainWaterEffect, type AnimatedFountainWater } from './fountains';
import {
  createAsphaltPbrSet,
  createBeachSandPbrSet,
  createBuildingFacadePbr,
  createPalmBarkPbrSet,
  createPalmFrondTexture,
  createSidewalkPbrSet,
  createWoodPlankPbrSet,
} from './textures';
import type { BuildingSpec, CityBlueprint } from './types';

export interface CitySceneHandles {
  root: THREE.Group;
  waterUniforms: {
    uTime: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
    uNightFactor: { value: number };
  };
  neonMaterials: THREE.MeshStandardMaterial[];
  windowMaterials: THREE.MeshStandardMaterial[];
  streetLampMaterials: THREE.MeshStandardMaterial[];
  lighthouseBeacon: THREE.Mesh;
  yachts: { group: THREE.Group; baseY: number; phase: number }[];
  palmCrowns: { group: THREE.Group; phase: number }[];
  applyPhotoTextures: (textures: LoadedGameAssets['textures']) => void;
  attachGltfFountains: (propsMap: Map<InteriorPropKind, THREE.Group>) => void;
  attachShowcaseBuildings: (propsMap: Map<InteriorPropKind, THREE.Group>) => void;
  attachWorldProps: (propsMap: Map<InteriorPropKind, THREE.Group>) => void;
  applyShowcaseTextures: (texMap: InteriorTextureMap) => void;
  hideFallbackYachts: () => void;
  updateAnimation: (
    elapsed: number,
    nightFactor: number,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    fogColor: THREE.Color,
  ) => void;
}

const OCEAN_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vWave;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float w1 = sin(wp.x * 0.048 + uTime * 1.15) * 0.26;
    float w2 = cos(wp.z * 0.042 - uTime * 0.88 + wp.x * 0.018) * 0.22;
    float w3 = sin((wp.x * 0.8 - wp.z * 0.6) * 0.11 + uTime * 1.65) * 0.10;
    float wave = w1 + w2 + w3;
    wp.y += wave;
    vWave = wave;
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uNightFactor;

  varying vec3 vWorldPos;
  varying float vWave;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.5);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float waveHeight(vec2 p) {
    float h = 0.0;
    h += noise(p * 0.16 + vec2(uTime * 0.42, -uTime * 0.28)) * 0.55;
    h += noise(p * 0.42 + vec2(-uTime * 0.65, uTime * 0.52)) * 0.28;
    h += noise(p * 1.05 + vec2(uTime * 0.9, uTime * 0.7)) * 0.14;
    return h;
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    // Finite-difference multi-octave wave normal for realistic water shimmer
    float eps = 0.35;
    float hC = waveHeight(vWorldPos.xz);
    float hX = waveHeight(vWorldPos.xz + vec2(eps, 0.0));
    float hZ = waveHeight(vWorldPos.xz + vec2(0.0, eps));
    vec3 normal = normalize(vec3((hC - hX) * 0.58, 1.0, (hC - hZ) * 0.58));

    // Shallow Miami turquoise water blending into rich Atlantic sapphire along curved shoreline
    float shoreX = 203.5 + sin(vWorldPos.z * 0.018) * 5.5 + cos(vWorldPos.z * 0.041 + 0.7) * 2.5;
    float coastDist = clamp((vWorldPos.x - (shoreX - 8.0)) / 145.0, 0.0, 1.0);
    vec3 shallowDay = vec3(0.06, 0.64, 0.72);
    vec3 deepDay = vec3(0.018, 0.18, 0.36);
    vec3 baseDay = mix(shallowDay, deepDay, smoothstep(0.0, 1.0, coastDist));
    vec3 baseNight = vec3(0.012, 0.05, 0.12);
    vec3 waterCol = mix(baseDay, baseNight, uNightFactor);

    // Subtle turquoise subsurface scattering through sunlit wave crests
    vec3 sunDir = normalize(uSunDir);
    float sss = pow(max(dot(viewDir, -sunDir + normal * 0.6), 0.0), 3.0) * clamp(vWave + 0.35, 0.0, 1.0);
    waterCol += vec3(0.05, 0.48, 0.52) * sss * (1.0 - uNightFactor * 0.85) * 0.55;

    // Physically inspired Schlick Fresnel sky/horizon reflection
    float cosTheta = max(dot(viewDir, normal), 0.0);
    float fresnel = 0.03 + 0.97 * pow(1.0 - cosTheta, 4.2);
    vec3 skyReflect = mix(uFogColor * 0.92, uSunColor * 0.85, pow(max(dot(reflect(-viewDir, normal), sunDir), 0.0), 5.0) * 0.4);
    waterCol = mix(waterCol, skyReflect, clamp(fresnel * 0.85, 0.0, 0.88));

    // Tight sparkling sun specular path + broader glitter
    vec3 halfVec = normalize(sunDir + viewDir);
    float ndh = max(dot(normal, halfVec), 0.0);
    float specTight = pow(ndh, 240.0) * 2.2;
    float specBroad = pow(ndh, 28.0) * 0.25;
    waterCol += uSunColor * (specTight + specBroad) * mix(1.25, 0.28, uNightFactor);

    // Organic frothy shoreline surf hugging the curved Sol Beach coves
    float beachZMask = smoothstep(-194.0, -180.0, vWorldPos.z) * smoothstep(198.0, 184.0, vWorldPos.z);
    float shoreBand = beachZMask * smoothstep(shoreX + 20.0, shoreX + 1.5, vWorldPos.x) * smoothstep(shoreX - 10.0, shoreX - 1.5, vWorldPos.x);
    float foamNoise = noise(vWorldPos.xz * 0.38 + vec2(-uTime * 0.85, uTime * 0.2));
    float surfWave = sin((vWorldPos.x - shoreX) * 0.42 - uTime * 2.4 + foamNoise * 3.0) * 0.5 + 0.5;
    float foam = shoreBand * smoothstep(0.42, 0.80, surfWave * 0.65 + foamNoise * 0.55);
    waterCol = mix(waterCol, vec3(0.94, 0.98, 1.0), foam * 0.72 * (1.0 - uNightFactor * 0.55));

    // Crisp distant horizon fog matching scene FogExp2
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-pow(dist * 0.00044, 2.0));
    waterCol = mix(waterCol, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(waterCol, 0.96);
  }
`;

/**
 * Creates a gracefully arched 3D geometry for a single feathered palm frond.
 */
function createArchedFrondGeometry(length = 3.8, width = 1.65): THREE.BufferGeometry {
  const segs = 9;
  const geo = new THREE.PlaneGeometry(width, length, 2, segs);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); // -w/2 .. +w/2
    const y = pos.getY(i); // -len/2 .. +len/2
    const t = (y + length * 0.5) / length; // 0 = base at crown, 1 = drooping tip

    // Arch upward then droop gracefully outward along +Z
    const zOut = t * length;
    const archY = Math.sin(t * Math.PI * 0.78) * 1.18 - t * t * 1.45;
    // Slight V-fold across leaflet width so fronds catch 3D sunlight
    const foldY = -Math.abs(x) * 0.18 * (0.4 + t * 0.6);

    pos.setXYZ(i, x, archY + foldY, zOut);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a single merged BufferGeometry for a complete 11-frond palm crown
 * so ALL palm crowns across the city render in 1 InstancedMesh draw call!
 */
function createMergedPalmCrownGeometry(): THREE.BufferGeometry {
  const baseFrond = createArchedFrondGeometry(3.8, 1.65);
  const parts: THREE.BufferGeometry[] = [];
  const mat = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();

  const lowerCount = 7;
  for (let f = 0; f < lowerCount; f++) {
    const g = baseFrond.clone();
    euler.set(0.16, (f / lowerCount) * Math.PI * 2, 0);
    quat.setFromEuler(euler);
    const sc = 0.95 + (f % 2) * 0.15;
    scale.set(sc, sc, sc);
    mat.compose(pos, quat, scale);
    g.applyMatrix4(mat);
    parts.push(g);
  }
  const upperCount = 4;
  for (let f = 0; f < upperCount; f++) {
    const g = baseFrond.clone();
    euler.set(-0.34, ((f + 0.45) / upperCount) * Math.PI * 2, 0);
    quat.setFromEuler(euler);
    scale.set(0.76, 0.76, 0.76);
    mat.compose(pos, quat, scale);
    g.applyMatrix4(mat);
    parts.push(g);
  }
  baseFrond.dispose();
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * Builds one canonical gently-curved tapered palm trunk (height = 10m, tip at (1.1, 10, 0))
 * instanced across every palm tree in Sol Coast!
 */
function createCanonicalPalmTrunkGeometry(): { geo: THREE.BufferGeometry; tipOffset: THREE.Vector3 } {
  const height = 10;
  const tipOffset = new THREE.Vector3(1.1, height, 0);
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.38, height * 0.55, 0),
    tipOffset,
  );
  const tubeSegs = 10;
  const radialSegs = 7;
  const trunkGeo = new THREE.TubeGeometry(curve, tubeSegs, 0.24, radialSegs, false);
  const posAttr = trunkGeo.attributes.position;
  for (let i = 0; i <= tubeSegs; i++) {
    const t = i / tubeSegs;
    const center = curve.getPointAt(t);
    const scaleR = (1.52 - t * 0.76) * (1 + (t < 0.08 ? (0.08 - t) * 2.4 : 0));
    for (let j = 0; j <= radialSegs; j++) {
      const idx = i * (radialSegs + 1) + j;
      posAttr.setXYZ(
        idx,
        center.x + (posAttr.getX(idx) - center.x) * scaleR,
        center.y + (posAttr.getY(idx) - center.y) * scaleR,
        center.z + (posAttr.getZ(idx) - center.z) * scaleR,
      );
    }
  }
  trunkGeo.computeVertexNormals();
  return { geo: trunkGeo, tipOffset };
}

function buildArchedCauseway(
  asphaltPbr: ReturnType<typeof createAsphaltPbrSet>,
  neonMaterials: THREE.MeshStandardMaterial[],
): THREE.Group {
  const group = new THREE.Group();
  const segments = 26;
  const startX = CAUSEWAY.startX;
  const endX = CAUSEWAY.endX;
  const segLen = (endX - startX) / segments;

  const deckTex = asphaltPbr.map.clone();
  deckTex.needsUpdate = true;
  deckTex.repeat.set(1, 0.7);
  deckTex.rotation = Math.PI * 0.5;
  deckTex.center.set(0.5, 0.5);

  const deckNorm = asphaltPbr.normalMap.clone();
  deckNorm.needsUpdate = true;
  deckNorm.repeat.set(1, 0.7);
  deckNorm.rotation = Math.PI * 0.5;
  deckNorm.center.set(0.5, 0.5);

  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTex,
    normalMap: deckNorm,
    roughness: 0.78,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xe6eaf2,
    roughness: 0.62,
  });
  const neonRailMat = new THREE.MeshStandardMaterial({
    color: 0x3ef2ff,
    emissive: 0x3ef2ff,
    emissiveIntensity: 1.4,
    roughness: 0.25,
  });
  neonMaterials.push(neonRailMat);

  for (let i = 0; i < segments; i++) {
    const x0 = startX + i * segLen;
    const x1 = x0 + segLen;
    const xm = (x0 + x1) * 0.5;
    const y0 = getGroundHeight(x0, CAUSEWAY.centerZ);
    const y1 = getGroundHeight(x1, CAUSEWAY.centerZ);
    const ym = (y0 + y1) * 0.5;
    const slope = Math.atan2(y1 - y0, segLen);
    const hyp = Math.hypot(segLen, y1 - y0) + 0.16;

    const slab = new THREE.Mesh(new THREE.BoxGeometry(hyp, 0.6, CAUSEWAY.halfWidth * 2), deckMat);
    slab.position.set(xm, ym - 0.3, CAUSEWAY.centerZ);
    slab.rotation.z = slope;
    slab.receiveShadow = true;
    group.add(slab);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(hyp, 0.85, 0.55), concreteMat);
      rail.position.set(xm, ym + 0.35, CAUSEWAY.centerZ + side * (CAUSEWAY.halfWidth - 0.35));
      rail.rotation.z = slope;
      group.add(rail);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(hyp, 0.12, 0.16), neonRailMat);
      trim.position.set(xm, ym + 0.82, CAUSEWAY.centerZ + side * (CAUSEWAY.halfWidth - 0.35));
      trim.rotation.z = slope;
      group.add(trim);
    }

    if (i > 1 && i < segments - 2 && i % 4 === 0) {
      for (const side of [-5.8, 5.8]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.98, ym + 5.5, 12), concreteMat);
        pillar.position.set(xm, (ym - 5.5) * 0.5, CAUSEWAY.centerZ + side);
        group.add(pillar);
      }
    }
  }

  return group;
}

function buildBuildingMesh(
  b: BuildingSpec,
  facadeCache: Map<string, THREE.MeshStandardMaterial>,
  neonMaterials: THREE.MeshStandardMaterial[],
  windowMaterials: THREE.MeshStandardMaterial[],
  lobbyGlassMat: THREE.MeshPhysicalMaterial,
  hvacMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(b.x, b.baseY, b.z);

  // True architectural story height scaling (~3.5m per story so windows match 1.8m humans & 1.2m cars)
  const rx = Math.max(1, Math.round(b.width / 16));
  const ry =
    b.style === 'skyscraper' || b.style === 'resort-tower'
      ? Math.max(1, Math.round(b.height / 44))
      : b.style === 'warehouse-mural'
        ? 1
        : Math.max(1, Math.round(b.height / 24));
  const key = `${b.style}-${b.wallColor}-${rx}-${ry}`;

  // Special Landmark: Circular Ribbed Sol Coast Stadium / Arena!
  if (b.style === 'stadium') {
    const outerR = b.width * 0.48;
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0xe6edf5, roughness: 0.42, metalness: 0.18 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x182436, roughness: 0.35, metalness: 0.55 });
    const neonCyan = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    const neonPink = new THREE.MeshStandardMaterial({
      color: 0xff2e93,
      emissive: 0xff2e93,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    });
    neonMaterials.push(neonCyan, neonPink);

    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR * 1.04, outerR * 0.92, b.height * 0.72, 28),
      bowlMat,
    );
    bowl.position.y = b.height * 0.36;
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    group.add(bowl);

    // Panoramic dark concourse glass band
    const concourse = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR * 1.055, outerR * 0.98, 4.6, 28),
      lobbyGlassMat,
    );
    concourse.position.y = 4.2;
    group.add(concourse);

    // Iconic cantilevered halo roof canopy + glowing neon stadium crown
    const roofRim = new THREE.Mesh(new THREE.TorusGeometry(outerR * 0.94, 2.3, 12, 32), bowlMat);
    roofRim.rotation.x = Math.PI * 0.5;
    roofRim.position.y = b.height * 0.78;
    roofRim.castShadow = true;
    group.add(roofRim);

    const innerDome = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR * 0.68, outerR * 0.94, 3.8, 28),
      darkMat,
    );
    innerDome.position.y = b.height * 0.85;
    group.add(innerDome);

    const crownGlow = new THREE.Mesh(new THREE.TorusGeometry(outerR * 1.05, 0.42, 8, 36), neonCyan);
    crownGlow.rotation.x = Math.PI * 0.5;
    crownGlow.position.y = b.height * 0.78;
    group.add(crownGlow);

    const lowerGlow = new THREE.Mesh(new THREE.TorusGeometry(outerR * 1.03, 0.3, 8, 36), neonPink);
    lowerGlow.rotation.x = Math.PI * 0.5;
    lowerGlow.position.y = 7.0;
    group.add(lowerGlow);

    // Architectural radial exterior ribs around the arena bowl
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.85, b.height * 0.76, 1.8), bowlMat);
      rib.position.set(Math.cos(ang) * outerR * 1.01, b.height * 0.38, Math.sin(ang) * outerR * 1.01);
      rib.rotation.y = -ang;
      group.add(rib);
    }

    return group;
  }

  let wallMat = facadeCache.get(key);
  if (!wallMat) {
    if (b.style === 'villa' || b.style === 'pavilion') {
      wallMat = new THREE.MeshStandardMaterial({
        color: b.wallColor,
        roughness: 0.48,
        metalness: 0.06,
      });
    } else {
      const pbr = createBuildingFacadePbr(b.wallColor, b.style, rx, ry);
      wallMat = new THREE.MeshStandardMaterial({
        map: pbr.map,
        normalMap: pbr.normalMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: pbr.roughnessMap,
        roughness: 1.0,
        metalness: b.style === 'skyscraper' ? 0.52 : b.style === 'resort-tower' ? 0.34 : 0.12,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: pbr.emissiveMap,
        emissiveIntensity: 0.25,
        envMapIntensity: b.style === 'skyscraper' || b.style === 'resort-tower' ? 1.55 : 1.0,
      });
      windowMaterials.push(wallMat);
    }
    facadeCache.set(key, wallMat);
  }

  const accentMat = new THREE.MeshStandardMaterial({
    color: b.accentColor,
    roughness: 0.42,
    metalness: 0.22,
  });

  // Main tower volume
  const mainMesh = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.depth), wallMat);
  mainMesh.position.y = b.height * 0.5;
  mainMesh.castShadow = true;
  mainMesh.receiveShadow = true;
  group.add(mainMesh);

  // Recessed ground-floor glass lobby storefront on city buildings
  if (b.style !== 'villa' && b.style !== 'pavilion') {
    const lobby = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 0.16, 3.6, b.depth + 0.16),
      lobbyGlassMat,
    );
    lobby.position.y = 1.85;
    group.add(lobby);
  }

  if (b.style === 'art-deco') {
    // Classic Miami South Beach curved corner drum + eyebrow balconies + stepped penthouse
    const drumRadius = Math.min(b.width, b.depth) * 0.24;
    const cornerDrum = new THREE.Mesh(
      new THREE.CylinderGeometry(drumRadius, drumRadius, b.height + 1.4, 16),
      wallMat,
    );
    cornerDrum.position.set(b.width * 0.44, (b.height + 1.4) * 0.5, b.depth * 0.44);
    cornerDrum.castShadow = true;
    group.add(cornerDrum);

    const step = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.72, 2.8, b.depth * 0.72),
      accentMat,
    );
    step.position.y = b.height + 1.4;
    step.castShadow = true;
    group.add(step);

    // Classic horizontal Art Deco sun-visor eyebrows & shared lightweight glass balcony railings
    for (let ey = 4.2; ey < b.height - 2; ey += 5.4) {
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(b.width + 1.35, 0.34, b.depth + 1.35),
        accentMat,
      );
      visor.position.y = ey;
      group.add(visor);

      if (ey > 5.0) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(b.width + 1.26, 0.92, b.depth + 1.26),
          lobbyGlassMat,
        );
        rail.position.y = ey + 0.62;
        group.add(rail);
      }
    }

    // Ground-floor sloped boutique storefront canopy awning
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 2.2, 0.18, b.depth + 2.2),
      accentMat,
    );
    canopy.position.y = 3.7;
    group.add(canopy);
  } else if (b.style === 'skyscraper') {
    // Architectural setback tier + mechanical penthouse + spire
    const setback = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.74, b.height * 0.18, b.depth * 0.74),
      wallMat,
    );
    setback.position.y = b.height + b.height * 0.09;
    setback.castShadow = true;
    group.add(setback);

    const topY = b.height + b.height * 0.18;
    const mech = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.42, 3.2, b.depth * 0.42),
      hvacMat,
    );
    mech.position.y = topY + 1.6;
    group.add(mech);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.34, 10, 8), accentMat);
    spire.position.y = topY + 8.0;
    group.add(spire);
  } else if (b.style === 'villa') {
    // Sleek cantilevered modernist coastal villa roof + panoramic glass + turquoise pool!
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 2.8, 0.65, b.depth + 2.8),
      new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.36 }),
    );
    roof.position.y = b.height + 0.32;
    roof.castShadow = true;
    group.add(roof);

    const midSlab = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 1.8, 0.42, b.depth + 1.8),
      new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.42 }),
    );
    midSlab.position.y = b.height * 0.5;
    group.add(midSlab);

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 0.22, b.height * 0.42, b.depth + 0.22),
      lobbyGlassMat,
    );
    glass.position.y = b.height * 0.73;
    group.add(glass);

    // Backyard infinity pool deck
    const pool = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.55, 0.16, 4.4),
      new THREE.MeshPhysicalMaterial({
        color: 0x1fd8e8,
        roughness: 0.08,
        clearcoat: 1.0,
        emissive: 0x0b7b8f,
        emissiveIntensity: 0.35,
      }),
    );
    pool.position.set(0, 0.08, b.depth * 0.5 + 3.2);
    group.add(pool);
  } else if (b.style === 'warehouse-mural') {
    // Wynwood industrial art gallery sawtooth skylight roof + steel overhang
    const ridgeCount = Math.max(2, Math.round(b.depth / 8));
    const ridgeDepth = b.depth / ridgeCount;
    for (let r = 0; r < ridgeCount; r++) {
      const saw = new THREE.Mesh(
        new THREE.BoxGeometry(b.width * 0.94, 1.5, ridgeDepth * 0.55),
        hvacMat,
      );
      saw.position.set(0, b.height + 0.65, -b.depth * 0.5 + (r + 0.5) * ridgeDepth);
      saw.rotation.x = 0.28;
      group.add(saw);
    }
  } else if (b.style === 'mediterranean') {
    // Coral Heights / Little Havana hipped terracotta clay-tile roof + shaded stucco eaves
    const roofRadius = Math.hypot(b.width, b.depth) * 0.54;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(roofRadius, 3.6, 4), accentMat);
    roof.rotation.y = Math.PI * 0.25;
    roof.scale.set(b.width / Math.max(b.width, b.depth), 1, b.depth / Math.max(b.width, b.depth));
    roof.position.y = b.height + 1.8;
    roof.castShadow = true;
    group.add(roof);

    const eave = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 1.6, 0.35, b.depth + 1.6),
      accentMat,
    );
    eave.position.y = b.height + 0.08;
    group.add(eave);
  } else if (b.style === 'resort-tower') {
    // North Beach sleek cantilevered wave-balcony floor slabs + rooftop infinity lounge
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xf7fafe, roughness: 0.32, metalness: 0.08 });
    for (let fy = 5.5; fy < b.height - 1.5; fy += 5.8) {
      const waveOff = Math.sin(fy * 0.45) * 0.9;
      const balcony = new THREE.Mesh(
        new THREE.BoxGeometry(b.width + 2.2 + waveOff, 0.36, b.depth + 2.2 - waveOff * 0.5),
        slabMat,
      );
      balcony.position.y = fy;
      group.add(balcony);
    }
    const penthouse = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.62, 4.2, b.depth * 0.62),
      lobbyGlassMat,
    );
    penthouse.position.y = b.height + 2.1;
    group.add(penthouse);
    const roofCap = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.72, 0.5, b.depth * 0.72),
      slabMat,
    );
    roofCap.position.y = b.height + 4.35;
    group.add(roofCap);
  } else if (b.style === 'neon-club') {
    // Rooftop HVAC box + sleek canopy entrance
    const hvac = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.8, 2.8), hvacMat);
    hvac.position.set(0, b.height + 0.9, 0);
    group.add(hvac);
  }

  // Glowing Miami neon rooftop rim & vertical Art Deco fins
  if (b.neonColor !== undefined) {
    const neonMat = new THREE.MeshStandardMaterial({
      color: b.neonColor,
      emissive: b.neonColor,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    });
    neonMaterials.push(neonMat);

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 0.32, 0.34, b.depth + 0.32),
      neonMat,
    );
    rim.position.y = b.height - 0.45;
    group.add(rim);

    if (b.hasRoofSign) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, b.height * 0.52, 1.2), neonMat);
      fin.position.set(b.width * 0.5 + 0.22, b.height * 0.62, 0);
      group.add(fin);
    }
  }

  return group;
}

function buildYachtMesh(length: number, accentColor: number): THREE.Group {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7fafd,
    roughness: 0.18,
    metalness: 0.12,
    clearcoat: 1.0,
    envMapIntensity: 1.4,
  });
  const teakMat = new THREE.MeshStandardMaterial({ color: 0xa47b52, roughness: 0.72 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1f33,
    roughness: 0.04,
    metalness: 0.25,
    clearcoat: 1.0,
    envMapIntensity: 2.0,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.35,
  });

  const width = length * 0.26;
  // Sculpted extruded sleek yacht hull silhouette
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, -length * 0.58); // sharp bow point
  hullShape.quadraticCurveTo(width * 0.58, -length * 0.18, width * 0.5, length * 0.46);
  hullShape.lineTo(-width * 0.5, length * 0.46);
  hullShape.quadraticCurveTo(-width * 0.58, -length * 0.18, 0, -length * 0.58);

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 1.35,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.12,
    bevelSegments: 3,
  });
  hullGeo.rotateX(Math.PI * 0.5);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 1.45;
  hull.castShadow = true;
  group.add(hull);

  // Teak aft deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width * 0.84, 0.12, length * 0.32), teakMat);
  deck.position.set(0, 1.56, length * 0.26);
  group.add(deck);

  // Sleek tapered saloon superstructure + panoramic glass
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 1.15, length * 0.44), hullMat);
  cabin.position.set(0, 2.05, 0.04 * length);
  cabin.castShadow = true;
  group.add(cabin);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(width * 0.76, 0.52, length * 0.38), glassMat);
  glass.position.set(0, 2.15, -0.01 * length);
  group.add(glass);

  // Flybridge radar arch
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(width * 0.36, 0.12, 8, 16, Math.PI),
    hullMat,
  );
  arch.position.set(0, 2.6, 0.08 * length);
  group.add(arch);

  // Hull accent waterline stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, 0.18, length * 0.56), stripeMat);
  stripe.position.set(0, 1.05, 0.08 * length);
  group.add(stripe);

  return group;
}

export function buildCityScene(scene: THREE.Scene, blueprint: CityBlueprint): CitySceneHandles {
  const root = new THREE.Group();
  const neonMaterials: THREE.MeshStandardMaterial[] = [];
  const windowMaterials: THREE.MeshStandardMaterial[] = [];
  const streetLampMaterials: THREE.MeshStandardMaterial[] = [];
  const yachts: { group: THREE.Group; baseY: number; phase: number }[] = [];
  const palmCrowns: { group: THREE.Group; phase: number }[] = [];

  const asphaltPbr = createAsphaltPbrSet();
  const sidewalkPbr = createSidewalkPbrSet();
  const sandPbr = createBeachSandPbrSet();
  const woodPbr = createWoodPlankPbrSet();
  const palmBarkPbr = createPalmBarkPbrSet();
  const palmFrondTex = createPalmFrondTexture();

  // 1. Multi-octave FBM Atlantic Ocean plane
  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.6, 0.3, -0.5).normalize() },
    uSunColor: { value: new THREE.Color(0xffb870) },
    uFogColor: { value: new THREE.Color(0xd78f8c) },
    uNightFactor: { value: 0.15 },
  };
  const oceanGeo = new THREE.PlaneGeometry(4200, 4200, 64, 64);
  oceanGeo.rotateX(-Math.PI * 0.5);
  const oceanMat = new THREE.ShaderMaterial({
    vertexShader: OCEAN_VERTEX_SHADER,
    fragmentShader: OCEAN_FRAGMENT_SHADER,
    uniforms: waterUniforms,
    transparent: true,
  });
  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.position.set(160, -0.55, 0);
  root.add(oceanMesh);

  // 2. Expanded Mainland Peninsula Base (Wynwood, Coral Heights, North Beach, Downtown, Neon Strip, Ocean Drive)
  // Split cleanly so North Bay water east of x=156 (north of z=-182) stays open under Key Sol Causeway!
  const mainlandMat = new THREE.MeshStandardMaterial({
    map: sidewalkPbr.map,
    normalMap: sidewalkPbr.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: sidewalkPbr.roughnessMap,
    roughness: 1.0,
  });
  const mainland = new THREE.Mesh(new THREE.BoxGeometry(584, 2.2, 602), mainlandMat);
  mainland.position.set(-136, -1.11, -109);
  mainland.receiveShadow = true;
  root.add(mainland);

  // Walkable Marina Cove & North Bay waterfront coping curbs (top sits cleanly at SEAWALL_HEIGHT = 0.24m!)
  const seawallMat = new THREE.MeshStandardMaterial({ color: 0xdce0e8, roughness: 0.72 });
  const southWall = new THREE.Mesh(new THREE.BoxGeometry(588, 1.4, 2.7), seawallMat);
  southWall.position.set(-134, SEAWALL_HEIGHT - 0.7, 191.8);
  southWall.receiveShadow = true;
  root.add(southWall);

  // North Bay east seawall promenade (north of Key Sol Causeway overlooking Key Sol Island)
  const northBayEastWall = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.4, 200), seawallMat);
  northBayEastWall.position.set(154.7, SEAWALL_HEIGHT - 0.7, -310);
  northBayEastWall.receiveShadow = true;
  root.add(northBayEastWall);

  // North shoreline seawall along northern rim of Wynwood & North Beach
  const northRimWall = new THREE.Mesh(new THREE.BoxGeometry(584, 1.4, 2.7), seawallMat);
  northRimWall.position.set(-136, SEAWALL_HEIGHT - 0.7, -409);
  northRimWall.receiveShadow = true;
  root.add(northRimWall);

  // 3. Boardwalk Promenade with weathered coastal timber planks
  const boardwalkMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    normalMap: woodPbr.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: woodPbr.roughnessMap,
    roughness: 1.0,
  });
  const boardwalk = new THREE.Mesh(new THREE.BoxGeometry(13.8, BOARDWALK_HEIGHT + 0.18, 376), boardwalkMat);
  boardwalk.position.set(158.9, BOARDWALK_HEIGHT - (BOARDWALK_HEIGHT + 0.18) * 0.5, 0);
  boardwalk.receiveShadow = true;
  root.add(boardwalk);

  // 4. Sculpted 3D Golden Sandy Beach: rolling coastal dunes, curved scalloped shoreline & wet-sand gradient!
  const beachCenterX = 203.5;
  const beachCenterZ = 2;
  const beachWidth = 76;
  const beachLen = 384;
  const beachGeo = new THREE.PlaneGeometry(beachWidth, beachLen, 72, 160);
  beachGeo.rotateX(-Math.PI * 0.5);
  const posAttr = beachGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const dryCrestCol = new THREE.Color(0xfff5e0);
  const goldenCol = new THREE.Color(0xf2d9b0);
  const wetSandCol = new THREE.Color(0x9e7d54);
  const tmpSandCol = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const wx = posAttr.getX(i) + beachCenterX;
    const wz = posAttr.getZ(i) + beachCenterZ;
    const wy = getBeachHeight(wx, wz);
    posAttr.setY(i, wy);

    // Smooth wet-sand -> warm golden -> sun-bleached dune crest vertex shading
    const shoreX = getShorelineX(wz);
    const wetBlend = THREE.MathUtils.clamp((wx - (shoreX - 7.5)) / 9.5, 0, 1);
    const crestBlend = THREE.MathUtils.clamp((wy - 0.35) / 0.65, 0, 1);
    tmpSandCol.copy(goldenCol).lerp(dryCrestCol, crestBlend).lerp(wetSandCol, wetBlend);
    colors[i * 3 + 0] = tmpSandCol.r;
    colors[i * 3 + 1] = tmpSandCol.g;
    colors[i * 3 + 2] = tmpSandCol.b;
  }
  beachGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  beachGeo.computeVertexNormals();

  const beachMat = new THREE.MeshStandardMaterial({
    map: sandPbr.map,
    normalMap: sandPbr.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: sandPbr.roughnessMap,
    roughness: 1.0,
    vertexColors: true,
  });
  const beachMesh = new THREE.Mesh(beachGeo, beachMat);
  beachMesh.position.set(beachCenterX, 0, beachCenterZ);
  beachMesh.receiveShadow = true;
  root.add(beachMesh);

  // Instanced coastal sea-oats & dune grass tufts along the upper rolling dunes (1 draw call!)
  const tuftParts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < 7; b++) {
    const ang = (b / 7) * Math.PI * 2 + (b % 2) * 0.25;
    const blade = new THREE.ConeGeometry(0.06, 0.72 + (b % 3) * 0.14, 4);
    blade.translate(0, 0.36, 0);
    blade.rotateZ(0.28 + (b % 2) * 0.14);
    blade.rotateY(ang);
    tuftParts.push(blade);
  }
  const duneGrassGeo = mergeGeometries(tuftParts, false);
  tuftParts.forEach((g) => g.dispose());
  const duneGrassMat = new THREE.MeshStandardMaterial({
    color: 0x6c8a4a,
    roughness: 0.88,
    metalness: 0.02,
  });
  const grassPositions: { x: number; y: number; z: number; s: number; r: number }[] = [];
  for (let gz = -172; gz <= 172; gz += 5.5) {
    if (Math.abs(gz - SOUTH_PIER.centerZ) < 16) continue;
    // Leave clean sandy boardwalk access gaps every 65m
    if (Math.abs(((gz + 32) % 68) - 34) < 5) continue;
    for (let k = 0; k < 4; k++) {
      const hash = Math.abs(Math.sin(gz * 12.9898 + k * 78.233) * 43758.5453) % 1;
      const hash2 = Math.abs(Math.sin(gz * 39.346 + k * 11.135) * 24634.6345) % 1;
      const gx = 167.2 + hash * 15.5;
      const tz = gz + (hash2 - 0.5) * 4.5;
      const gy = getBeachHeight(gx, tz);
      if (gy > 0.24) {
        grassPositions.push({
          x: gx,
          y: gy - 0.04,
          z: tz,
          s: 0.75 + hash2 * 0.75,
          r: hash * Math.PI * 2,
        });
      }
    }
  }
  const duneGrassInst = new THREE.InstancedMesh(duneGrassGeo, duneGrassMat, grassPositions.length);
  const grassObj = new THREE.Object3D();
  const grassCol = new THREE.Color();
  grassPositions.forEach((gp, idx) => {
    grassObj.position.set(gp.x, gp.y, gp.z);
    grassObj.rotation.set(0, gp.r, 0);
    grassObj.scale.set(gp.s, gp.s * 0.9, gp.s);
    grassObj.updateMatrix();
    duneGrassInst.setMatrixAt(idx, grassObj.matrix);
    grassCol.setHSL(0.22 + (idx % 5) * 0.015, 0.34, 0.36 + (idx % 4) * 0.04);
    duneGrassInst.setColorAt(idx, grassCol);
  });
  duneGrassInst.instanceMatrix.needsUpdate = true;
  if (duneGrassInst.instanceColor) duneGrassInst.instanceColor.needsUpdate = true;
  root.add(duneGrassInst);

  // 5. Key Sol Luxury Island with gently tapered sandy shoreline (no abrupt boxy ledge!)
  const keyW = KEY_SOL_BOUNDS.maxX - KEY_SOL_BOUNDS.minX;
  const keyD = KEY_SOL_BOUNDS.maxZ - KEY_SOL_BOUNDS.minZ;
  const keyCX = (KEY_SOL_BOUNDS.minX + KEY_SOL_BOUNDS.maxX) * 0.5;
  const keyCZ = (KEY_SOL_BOUNDS.minZ + KEY_SOL_BOUNDS.maxZ) * 0.5;
  const keySolGeo = new THREE.BoxGeometry(keyW, 2.4, keyD);
  const keySolMat = new THREE.MeshStandardMaterial({ color: 0x4f915c, roughness: 0.9 });
  const keySolMesh = new THREE.Mesh(keySolGeo, keySolMat);
  keySolMesh.position.set(keyCX, KEY_SOL_BOUNDS.baseY - 1.22, keyCZ);
  keySolMesh.receiveShadow = true;
  root.add(keySolMesh);

  const keySandGeo = new THREE.PlaneGeometry(keyW + 26, keyD + 26, 20, 20);
  keySandGeo.rotateX(-Math.PI * 0.5);
  const ksPos = keySandGeo.attributes.position;
  for (let i = 0; i < ksPos.count; i++) {
    const lx = Math.abs(ksPos.getX(i));
    const lz = Math.abs(ksPos.getZ(i));
    const dxOut = Math.max(0, lx - keyW * 0.5);
    const dzOut = Math.max(0, lz - keyD * 0.5);
    const edgeDist = Math.hypot(dxOut, dzOut);
    const y = KEY_SOL_BOUNDS.baseY - 0.06 - Math.min(1.85, edgeDist * 0.14);
    ksPos.setY(i, y);
  }
  keySandGeo.computeVertexNormals();
  const keySandMat = new THREE.MeshStandardMaterial({
    map: sandPbr.map,
    normalMap: sandPbr.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: sandPbr.roughnessMap,
    roughness: 1.0,
    color: 0xf4dfb8,
  });
  const keySand = new THREE.Mesh(keySandGeo, keySandMat);
  keySand.position.set(keyCX, 0, keyCZ);
  keySand.receiveShadow = true;
  root.add(keySand);

  // 6. PBR Normal- & Roughness-Mapped Asphalt Road Network
  const roadMaterials: { mat: THREE.MeshStandardMaterial; repeatY: number }[] = [];
  const roadMarkingsGroup = new THREE.Group();
  const intersectionMat = new THREE.MeshStandardMaterial({
    color: 0x262a34,
    normalMap: asphaltPbr.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.82,
    metalness: 0.08,
  });

  const yellowLineMat = new THREE.MeshStandardMaterial({ color: 0xf4c042, roughness: 0.65 });
  const whiteLineMat = new THREE.MeshStandardMaterial({ color: 0xe6ecf5, roughness: 0.65 });

  for (const road of blueprint.roads) {
    if (road.isBridge) continue;
    const dx = road.x2 - road.x1;
    const dz = road.z2 - road.z1;
    const len = Math.hypot(dx, dz);
    const xm = (road.x1 + road.x2) * 0.5;
    const zm = (road.z1 + road.z2) * 0.5;
    const baseY = xm > 230 ? KEY_SOL_BOUNDS.baseY + 0.03 : 0.025;
    const rep = Math.max(1, len / 18);

    const map = asphaltPbr.map.clone();
    map.needsUpdate = true;
    map.repeat.set(1, rep);
    const norm = asphaltPbr.normalMap.clone();
    norm.needsUpdate = true;
    norm.repeat.set(1, rep);
    const rough = asphaltPbr.roughnessMap.clone();
    rough.needsUpdate = true;
    rough.repeat.set(1, rep);

    const roadMat = new THREE.MeshStandardMaterial({
      map,
      normalMap: norm,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: rough,
      roughness: 1.0,
      metalness: 0.08,
    });
    roadMaterials.push({ mat: roadMat, repeatY: rep });

    const isHoriz = Math.abs(dx) > Math.abs(dz);
    const geo = new THREE.PlaneGeometry(road.width, len);
    geo.rotateX(-Math.PI * 0.5);
    if (isHoriz) geo.rotateY(Math.PI * 0.5);
    const mesh = new THREE.Mesh(geo, roadMat);
    mesh.position.set(xm, baseY, zm);
    mesh.receiveShadow = true;
    root.add(mesh);

    // Painted double-yellow centerline & white shoulder decals overlaid above photographed asphalt
    const lineY = baseY + 0.012;
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(
        new THREE.PlaneGeometry(isHoriz ? len : 0.22, isHoriz ? 0.22 : len),
        whiteLineMat,
      );
      shoulder.rotation.x = -Math.PI * 0.5;
      shoulder.position.set(
        xm + (isHoriz ? 0 : side * (road.width * 0.5 - 0.65)),
        lineY,
        zm + (isHoriz ? side * (road.width * 0.5 - 0.65) : 0),
      );
      roadMarkingsGroup.add(shoulder);

      const centerStripe = new THREE.Mesh(
        new THREE.PlaneGeometry(isHoriz ? len : 0.14, isHoriz ? 0.14 : len),
        yellowLineMat,
      );
      centerStripe.rotation.x = -Math.PI * 0.5;
      centerStripe.position.set(
        xm + (isHoriz ? 0 : side * 0.16),
        lineY,
        zm + (isHoriz ? side * 0.16 : 0),
      );
      roadMarkingsGroup.add(centerStripe);
    }
  }
  roadMarkingsGroup.visible = false; // Shown automatically once photo asphalt replaces procedural striped map
  root.add(roadMarkingsGroup);

  // Instanced intersection pads & crosswalk stripes (275 meshes -> 2 draw calls!)
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe6ecf5, roughness: 0.65 });
  const totalIntersections = blueprint.avenueXs.length * blueprint.streetZs.length;
  const padGeo = new THREE.PlaneGeometry(blueprint.roadWidth + 0.6, blueprint.roadWidth + 0.6);
  padGeo.rotateX(-Math.PI * 0.5);
  const padInst = new THREE.InstancedMesh(padGeo, intersectionMat, totalIntersections);
  padInst.receiveShadow = true;

  const barGeo = new THREE.PlaneGeometry(1.05, 2.8);
  barGeo.rotateX(-Math.PI * 0.5);
  const barInst = new THREE.InstancedMesh(barGeo, stripeMat, totalIntersections * 10);

  const tmpObj = new THREE.Object3D();
  let padIdx = 0;
  let barIdx = 0;
  for (const ax of blueprint.avenueXs) {
    for (const sz of blueprint.streetZs) {
      tmpObj.position.set(ax, 0.04, sz);
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.scale.set(1, 1, 1);
      tmpObj.updateMatrix();
      padInst.setMatrixAt(padIdx++, tmpObj.matrix);

      for (let s = -5; s <= 5; s += 2.5) {
        tmpObj.position.set(ax + s, 0.052, sz - 9.4);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.updateMatrix();
        barInst.setMatrixAt(barIdx++, tmpObj.matrix);

        tmpObj.position.set(ax + 9.4, 0.052, sz + s);
        tmpObj.rotation.set(0, Math.PI * 0.5, 0);
        tmpObj.updateMatrix();
        barInst.setMatrixAt(barIdx++, tmpObj.matrix);
      }
    }
  }
  padInst.instanceMatrix.needsUpdate = true;
  barInst.instanceMatrix.needsUpdate = true;
  root.add(padInst, barInst);

  // 7. Key Sol Causeway Arch Bridge
  root.add(buildArchedCauseway(asphaltPbr, neonMaterials));

  // 8. South Pier (smooth ramp rising from boardwalk deck + elevated timber deck + pilings + lighthouse)
  const pilingMat = new THREE.MeshStandardMaterial({ color: 0x523c28, roughness: 0.94 });
  const rampLen = SOUTH_PIER.rampEndX - SOUTH_PIER.startX;
  const rampRise = SOUTH_PIER.deckY - BOARDWALK_HEIGHT;
  const rampSlope = Math.atan2(rampRise, rampLen);
  const rampMesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.hypot(rampLen, rampRise), 0.35, SOUTH_PIER.halfWidth * 2),
    boardwalkMat,
  );
  rampMesh.position.set(
    (SOUTH_PIER.startX + SOUTH_PIER.rampEndX) * 0.5,
    BOARDWALK_HEIGHT + rampRise * 0.5 - 0.175,
    SOUTH_PIER.centerZ,
  );
  rampMesh.rotation.z = rampSlope;
  rampMesh.receiveShadow = true;
  root.add(rampMesh);

  const deckLen = SOUTH_PIER.endX - SOUTH_PIER.rampEndX;
  const deckMesh = new THREE.Mesh(
    new THREE.BoxGeometry(deckLen, 0.42, SOUTH_PIER.halfWidth * 2),
    boardwalkMat,
  );
  deckMesh.position.set(
    (SOUTH_PIER.rampEndX + SOUTH_PIER.endX) * 0.5,
    SOUTH_PIER.deckY - 0.21,
    SOUTH_PIER.centerZ,
  );
  deckMesh.receiveShadow = true;
  deckMesh.castShadow = true;
  root.add(deckMesh);

  for (let px = SOUTH_PIER.rampEndX + 6; px <= SOUTH_PIER.endX - 2; px += 14) {
    for (const side of [-5.8, 5.8]) {
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 4.2, 8), pilingMat);
      piling.position.set(px, SOUTH_PIER.deckY - 2.1, SOUTH_PIER.centerZ + side);
      root.add(piling);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.0, 0.24), seawallMat);
      post.position.set(px, SOUTH_PIER.deckY + 0.5, SOUTH_PIER.centerZ + side * 1.15);
      root.add(post);
    }
  }

  const pierGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffd17a,
    emissive: 0xffb347,
    emissiveIntensity: 1.8,
  });
  streetLampMaterials.push(pierGlowMat);
  for (let px = SOUTH_PIER.rampEndX + 8; px <= SOUTH_PIER.endX - 10; px += 22) {
    for (const side of [-6.4, 6.4]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), pierGlowMat);
      bulb.position.set(px, SOUTH_PIER.deckY + 1.15, SOUTH_PIER.centerZ + side);
      root.add(bulb);
    }
  }

  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xfff0aa,
    emissive: 0xffcf5c,
    emissiveIntensity: 2.8,
  });
  neonMaterials.push(beaconMat);
  const lighthouseBeacon = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 2), beaconMat);
  lighthouseBeacon.position.set(279, SOUTH_PIER.deckY + 15.6, SOUTH_PIER.centerZ);
  root.add(lighthouseBeacon);

  // 9. Marina Cove timber yacht docks + smooth approach ramps from promenade (zero knee clipping!)
  const dockRampLen = 7.0;
  const dockRampRise = 0.45;
  const dockRampSlope = Math.atan2(dockRampRise, dockRampLen);
  for (const dx of [-75, -15, 45]) {
    const dockRamp = new THREE.Mesh(
      new THREE.BoxGeometry(8.5, 0.28, Math.hypot(dockRampLen, dockRampRise)),
      boardwalkMat,
    );
    dockRamp.position.set(dx, dockRampRise * 0.5 - 0.14, 190.5);
    dockRamp.rotation.x = -dockRampSlope;
    dockRamp.receiveShadow = true;
    root.add(dockRamp);

    const dock = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.45, 48), boardwalkMat);
    dock.position.set(dx, 0.45 - 0.225, 218);
    dock.receiveShadow = true;
    root.add(dock);
  }

  // 10. Palm Plaza Central Park & Tiered Fountain (resting cleanly atop raised sidewalk slab)
  const parkY = SIDEWALK_HEIGHT;
  const parkGrass = new THREE.Mesh(
    new THREE.BoxGeometry(66, 0.04, 66),
    new THREE.MeshStandardMaterial({ color: 0x38854f, roughness: 0.92 }),
  );
  parkGrass.position.set(25, parkY + 0.015, 25);
  parkGrass.receiveShadow = true;
  root.add(parkGrass);

  const pathMat = new THREE.MeshStandardMaterial({ color: 0xe2d7c8, roughness: 0.78 });
  const pathNS = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 66), pathMat);
  pathNS.position.set(25, parkY + 0.02, 25);
  root.add(pathNS);
  const pathEW = new THREE.Mesh(new THREE.BoxGeometry(66, 0.05, 7), pathMat);
  pathEW.position.set(25, parkY + 0.02, 25);
  root.add(pathEW);

  const fallbackFountainGroup = new THREE.Group();
  const fountainRim = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.6, 1.1, 24), seawallMat);
  fountainRim.position.set(25, parkY + 0.55, 25);
  fallbackFountainGroup.add(fountainRim);

  const fountainWaterMat = new THREE.MeshPhysicalMaterial({
    color: 0x1fd8e8,
    emissive: 0x0b96ad,
    emissiveIntensity: 0.65,
    roughness: 0.06,
    clearcoat: 1.0,
  });
  neonMaterials.push(fountainWaterMat);
  const fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 1.15, 24), fountainWaterMat);
  fountainWater.position.set(25, parkY + 0.62, 25);
  fallbackFountainGroup.add(fountainWater);

  const fountainSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.65, 3.6, 16), seawallMat);
  fountainSpire.position.set(25, parkY + 1.8, 25);
  fallbackFountainGroup.add(fountainSpire);
  root.add(fallbackFountainGroup);

  // Outdoor Sculpted Fountain Varieties + Live Animated Water Jets & Ripples!
  const outdoorFountainsRoot = new THREE.Group();
  root.add(outdoorFountainsRoot);
  const animatedOutdoorFountains: AnimatedFountainWater[] = [];

  const outdoorFountainSpecs: {
    kind: InteriorPropKind;
    style: 'plaza-grand' | 'spanish-courtyard' | 'modern-zen';
    x: number;
    y: number;
    z: number;
    rotY?: number;
    scale?: number;
  }[] = [
    // 1. Palm Plaza Central Park: Monumental 12m Dolphin & 3-Tier Cascading Fountain
    { kind: 'fountain_plaza_grand', style: 'plaza-grand', x: 25, y: parkY, z: 25, scale: 1.0 },
    // 2. Coral Park East Lawn: 8-Point Star Spanish Terracotta & Talavera Mosaic Courtyard Fountain
    { kind: 'fountain_spanish_courtyard', style: 'spanish-courtyard', x: -314, y: parkY, z: 25, scale: 1.05 },
    // 3. Key Sol Luxury Island Center Plaza: Modernist Honed Basalt Infinity & Brass Water-Wall
    { kind: 'fountain_modern_zen', style: 'modern-zen', x: 301, y: KEY_SOL_BOUNDS.baseY, z: -200, scale: 1.0 },
    // 4. Marina Cove Waterfront Promenade: Modernist Honed Basalt Infinity & Brass Water-Wall
    { kind: 'fountain_modern_zen', style: 'modern-zen', x: -45, y: 0, z: 182, scale: 1.0 },
  ];

  for (const spec of outdoorFountainSpecs) {
    const fx = createFountainWaterEffect(spec.style, spec.scale ?? 1.0);
    fx.group.position.set(spec.x, spec.y, spec.z);
    if (spec.rotY) fx.group.rotation.y = spec.rotY;
    outdoorFountainsRoot.add(fx.group);
    animatedOutdoorFountains.push(fx);
  }

  // 10b. Coral Park & Outdoor Miami Basketball Court (-380..-290, -20..70 -> center -335, 25)
  const coralGrass = new THREE.Mesh(
    new THREE.BoxGeometry(66, 0.04, 66),
    new THREE.MeshStandardMaterial({ color: 0x3f8c4f, roughness: 0.92 }),
  );
  coralGrass.position.set(-335, parkY + 0.015, 25);
  coralGrass.receiveShadow = true;
  root.add(coralGrass);

  const courtMat = new THREE.MeshStandardMaterial({ color: 0x16808c, roughness: 0.72 });
  const courtKeyMat = new THREE.MeshStandardMaterial({ color: 0xe64a78, roughness: 0.74 });
  const courtLineMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 });
  const courtDeck = new THREE.Mesh(new THREE.BoxGeometry(17, 0.05, 30), courtMat);
  courtDeck.position.set(-335, parkY + 0.03, 25);
  courtDeck.receiveShadow = true;
  root.add(courtDeck);

  // Painted center circle & coral key lanes + two glass basketball hoops!
  const midRing = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.55, 24), courtLineMat);
  midRing.rotation.x = -Math.PI * 0.5;
  midRing.position.set(-335, parkY + 0.065, 25);
  root.add(midRing);

  const fallbackHoopsGroup = new THREE.Group();
  root.add(fallbackHoopsGroup);
  const hoopPostMat = new THREE.MeshStandardMaterial({ color: 0x222938, metalness: 0.7, roughness: 0.32 });
  const backboardMat = new THREE.MeshStandardMaterial({ color: 0xedf6ff, roughness: 0.18, metalness: 0.1 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff5a22, roughness: 0.35, metalness: 0.6 });
  for (const side of [-1, 1]) {
    const keyPaint = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.055, 5.8), courtKeyMat);
    keyPaint.position.set(-335, parkY + 0.034, 25 + side * 11.4);
    root.add(keyPaint);

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.6, 8), hoopPostMat);
    post.position.set(-335, parkY + 1.8, 25 + side * 14.4);
    fallbackHoopsGroup.add(post);

    const board = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.15, 0.08), backboardMat);
    board.position.set(-335, parkY + 3.4, 25 + side * 13.7);
    fallbackHoopsGroup.add(board);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 16), rimMat);
    rim.rotation.x = Math.PI * 0.5;
    rim.position.set(-335, parkY + 3.05, 25 + side * 13.3);
    fallbackHoopsGroup.add(rim);
  }

  // 11. PBR Buildings
  const facadeCache = new Map<string, THREE.MeshStandardMaterial>();
  const lobbyGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x152c40,
    roughness: 0.06,
    metalness: 0.25,
    clearcoat: 1.0,
    envMapIntensity: 1.9,
  });
  const hvacMat = new THREE.MeshStandardMaterial({ color: 0x7e8796, roughness: 0.75, metalness: 0.35 });

  const SHOWCASE_BUILDING_MAP: Record<string, InteriorPropKind> = {
    'b-108': 'building_hotel_solaire',
    'b-89': 'building_club_neon',
    'b-30': 'building_cafe_habana',
    'b-43': 'building_wynwood_gallery',
  };
  const showcaseFallbacks = new Map<string, { spec: BuildingSpec; mesh: THREE.Object3D }>();
  const showcaseBuildingsRoot = new THREE.Group();
  root.add(showcaseBuildingsRoot);
  let fallbackLighthouseMesh: THREE.Object3D | null = null;
  let fallbackLighthouseSpec: BuildingSpec | null = null;

  for (const b of blueprint.buildings) {
    const mesh = buildBuildingMesh(b, facadeCache, neonMaterials, windowMaterials, lobbyGlassMat, hvacMat);
    root.add(mesh);
    if (b.id in SHOWCASE_BUILDING_MAP) {
      showcaseFallbacks.set(b.id, { spec: b, mesh });
    }
    if (b.id === 'south-pier-lighthouse') {
      fallbackLighthouseMesh = mesh;
      fallbackLighthouseSpec = b;
    }
  }

  // 12. Instanced Feathered-Frond Palm Trees (~1,275 meshes -> 2 InstancedMesh draw calls!)
  const palmTrunkMat = new THREE.MeshStandardMaterial({
    map: palmBarkPbr.map,
    normalMap: palmBarkPbr.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.92,
  });
  const palmFrondMat = new THREE.MeshStandardMaterial({
    map: palmFrondTex,
    alphaTest: 0.35,
    roughness: 0.68,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const { geo: trunkGeo, tipOffset } = createCanonicalPalmTrunkGeometry();
  const crownGeo = createMergedPalmCrownGeometry();

  const palmCount = blueprint.palms.length;
  const trunkInst = new THREE.InstancedMesh(trunkGeo, palmTrunkMat, palmCount);
  trunkInst.castShadow = true;
  trunkInst.receiveShadow = true;
  const crownInst = new THREE.InstancedMesh(crownGeo, palmFrondMat, palmCount);
  crownInst.castShadow = false; // Avoid costly alpha-tested shadow passes on Apple Metal / WebGL!

  const palmTip = new THREE.Vector3();
  blueprint.palms.forEach((p, idx) => {
    const hScale = p.height / 10;
    tmpObj.position.set(p.x, p.y, p.z);
    tmpObj.rotation.set(0, p.seed, 0);
    tmpObj.scale.set(hScale, hScale, hScale);
    tmpObj.updateMatrix();
    trunkInst.setMatrixAt(idx, tmpObj.matrix);

    palmTip.copy(tipOffset).multiplyScalar(hScale).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.seed);
    tmpObj.position.set(p.x + palmTip.x, p.y + palmTip.y - 0.1, p.z + palmTip.z);
    tmpObj.rotation.set(0, p.seed, 0);
    tmpObj.scale.set(hScale, hScale, hScale);
    tmpObj.updateMatrix();
    crownInst.setMatrixAt(idx, tmpObj.matrix);
  });
  trunkInst.instanceMatrix.needsUpdate = true;
  crownInst.instanceMatrix.needsUpdate = true;
  root.add(trunkInst, crownInst);

  // 13. Instanced Streetlights (~240 meshes -> 2 InstancedMesh poles/arms + light bulbs)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a3342, metalness: 0.75, roughness: 0.32 });
  const slCount = blueprint.streetLights.length;
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 6.8, 7);
  poleGeo.translate(0, 3.4, 0);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, 1.65);
  armGeo.translate(0, 6.72, 0.72);
  const bulbGeo = new THREE.BoxGeometry(0.42, 0.14, 0.72);
  bulbGeo.translate(0, 6.6, 1.38);

  const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, slCount);
  const armInst = new THREE.InstancedMesh(armGeo, poleMat, slCount);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffe4b5,
    emissive: 0xffd28a,
    emissiveIntensity: 1.5,
  });
  streetLampMaterials.push(lampMat);
  const bulbInst = new THREE.InstancedMesh(bulbGeo, lampMat, slCount);
  const tmpColor = new THREE.Color();

  blueprint.streetLights.forEach((sl, idx) => {
    tmpObj.position.set(sl.x, sl.y, sl.z);
    tmpObj.rotation.set(0, sl.yaw, 0);
    tmpObj.scale.set(1, 1, 1);
    tmpObj.updateMatrix();
    poleInst.setMatrixAt(idx, tmpObj.matrix);
    armInst.setMatrixAt(idx, tmpObj.matrix);
    bulbInst.setMatrixAt(idx, tmpObj.matrix);
    tmpColor.setHex(sl.color);
    bulbInst.setColorAt(idx, tmpColor);
  });
  poleInst.instanceMatrix.needsUpdate = true;
  armInst.instanceMatrix.needsUpdate = true;
  bulbInst.instanceMatrix.needsUpdate = true;
  if (bulbInst.instanceColor) bulbInst.instanceColor.needsUpdate = true;
  root.add(poleInst, armInst, bulbInst);

  // 14. Beach Lifeguard Towers & Umbrellas (primitive fallback hidden once bespoke Blender GLBs attach!)
  const fallbackBeachPropsRoot = new THREE.Group();
  root.add(fallbackBeachPropsRoot);
  const worldPropsGltfRoot = new THREE.Group();
  root.add(worldPropsGltfRoot);

  for (const prop of blueprint.beachProps) {
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y, prop.z);
    g.rotation.y = prop.yaw;
    if (prop.kind === 'lifeguard') {
      const hutMat = new THREE.MeshStandardMaterial({ color: prop.color, roughness: 0.55 });
      const legMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.7 });
      for (const lx of [-1.2, 1.2]) {
        for (const lz of [-1.2, 1.2]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.4, 0.22), legMat);
          leg.position.set(lx, 1.2, lz);
          g.add(leg);
        }
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.2, 3.8), boardwalkMat);
      deck.position.y = 2.35;
      g.add(deck);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.2, 2.9), hutMat);
      cabin.position.y = 3.45;
      cabin.castShadow = true;
      g.add(cabin);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.55, 1.15, 4), legMat);
      roof.rotation.y = Math.PI * 0.25;
      roof.position.y = 5.1;
      g.add(roof);
    } else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.6, 8), seawallMat);
      pole.position.y = 1.3;
      g.add(pole);
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(1.9, 0.65, 12),
        new THREE.MeshStandardMaterial({ color: prop.color, roughness: 0.65 }),
      );
      canopy.position.y = 2.6;
      canopy.castShadow = true;
      g.add(canopy);
    }
    fallbackBeachPropsRoot.add(g);
  }

  // 15. Sculpted Moored & Offshore Yachts
  blueprint.yachts.forEach((ySpec, idx) => {
    const mesh = buildYachtMesh(ySpec.length, ySpec.accentColor);
    mesh.position.set(ySpec.x, -0.5, ySpec.z);
    mesh.rotation.y = -ySpec.yaw;
    root.add(mesh);
    yachts.push({ group: mesh, baseY: -0.5, phase: idx * 1.1 });
  });

  scene.add(root);

  const updateAnimation = (
    elapsed: number,
    nightFactor: number,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    fogColor: THREE.Color,
  ) => {
    waterUniforms.uTime.value = elapsed;
    waterUniforms.uSunDir.value.copy(sunDir);
    waterUniforms.uSunColor.value.copy(sunColor);
    waterUniforms.uFogColor.value.copy(fogColor);
    waterUniforms.uNightFactor.value = nightFactor;

    const neonIntensity = 0.65 + nightFactor * 2.1;
    for (const mat of neonMaterials) {
      mat.emissiveIntensity = neonIntensity;
    }
    const winIntensity = 0.08 + nightFactor * 1.25;
    for (const mat of windowMaterials) {
      mat.emissiveIntensity = winIntensity;
    }
    const lampIntensity = 0.3 + nightFactor * 2.6;
    for (const mat of streetLampMaterials) {
      mat.emissiveIntensity = lampIntensity;
    }

    lighthouseBeacon.rotation.y = elapsed * 1.6;
    lighthouseBeacon.position.y = SOUTH_PIER.deckY + 15.6 + Math.sin(elapsed * 2.2) * 0.2;

    for (const y of yachts) {
      y.group.position.y = y.baseY + Math.sin(elapsed * 1.3 + y.phase) * 0.14;
      y.group.rotation.z = Math.sin(elapsed * 0.9 + y.phase) * 0.028;
    }

    // Gentle Miami coastal breeze swaying palm crowns
    for (const pc of palmCrowns) {
      pc.group.rotation.z = Math.sin(elapsed * 1.15 + pc.phase) * 0.045;
      pc.group.rotation.x = Math.cos(elapsed * 0.85 + pc.phase) * 0.03;
    }

    // Live animated arching water jets & ripples on all outdoor city fountains!
    for (const fx of animatedOutdoorFountains) {
      fx.update(elapsed);
    }
  };

  const applyPhotoTextures = (textures: LoadedGameAssets['textures']) => {
    if (textures.concrete) {
      mainlandMat.map = textures.concrete.map;
      mainlandMat.normalMap = textures.concrete.normalMap;
      mainlandMat.roughnessMap = textures.concrete.roughnessMap;
      mainlandMat.needsUpdate = true;
    }
    if (textures.sand) {
      beachMat.map = textures.sand.map;
      beachMat.normalMap = textures.sand.normalMap;
      beachMat.roughnessMap = textures.sand.roughnessMap;
      beachMat.color.setHex(0xffffff);
      beachMat.needsUpdate = true;

      keySandMat.map = textures.sand.map;
      keySandMat.normalMap = textures.sand.normalMap;
      keySandMat.roughnessMap = textures.sand.roughnessMap;
      keySandMat.needsUpdate = true;
    }
    if (textures.wood) {
      boardwalkMat.map = textures.wood.map;
      boardwalkMat.normalMap = textures.wood.normalMap;
      boardwalkMat.roughnessMap = textures.wood.roughnessMap;
      boardwalkMat.needsUpdate = true;
    }
    if (textures.asphalt) {
      for (const entry of roadMaterials) {
        const m = textures.asphalt.map.clone();
        m.needsUpdate = true;
        m.repeat.set(1.5, entry.repeatY * 0.85);
        const n = textures.asphalt.normalMap.clone();
        n.needsUpdate = true;
        n.repeat.set(1.5, entry.repeatY * 0.85);
        const r = textures.asphalt.roughnessMap.clone();
        r.needsUpdate = true;
        r.repeat.set(1.5, entry.repeatY * 0.85);
        entry.mat.map = m;
        entry.mat.normalMap = n;
        entry.mat.roughnessMap = r;
        entry.mat.color.setHex(0xb8bec8);
        entry.mat.needsUpdate = true;
      }
      intersectionMat.map = textures.asphalt.map;
      intersectionMat.normalMap = textures.asphalt.normalMap;
      intersectionMat.roughnessMap = textures.asphalt.roughnessMap;
      intersectionMat.color.setHex(0xa8aeb8);
      intersectionMat.needsUpdate = true;
      roadMarkingsGroup.visible = true;
    }
  };

  const attachGltfFountains = (propsMap: Map<InteriorPropKind, THREE.Group>) => {
    let attachedGrand = false;
    for (const spec of outdoorFountainSpecs) {
      const src = propsMap.get(spec.kind);
      if (!src) continue;
      const inst = src.clone(true);
      inst.position.set(spec.x, spec.y, spec.z);
      if (spec.rotY) inst.rotation.y = spec.rotY;
      inst.scale.setScalar(spec.scale ?? 1.0);
      outdoorFountainsRoot.add(inst);
      if (spec.kind === 'fountain_plaza_grand') attachedGrand = true;
    }
    if (attachedGrand) {
      fallbackFountainGroup.visible = false;
    }
  };

  let cachedShowcaseTexMap: InteriorTextureMap | null = null;
  const showcasePbrMaterials: { mat: THREE.MeshStandardMaterial; key: InteriorTextureKey }[] = [];

  const bindShowcaseTextures = (texMap: InteriorTextureMap) => {
    for (const entry of showcasePbrMaterials) {
      const pbr = texMap[entry.key];
      if (!pbr) continue;
      entry.mat.map = pbr.map;
      entry.mat.normalMap = pbr.normalMap;
      entry.mat.normalScale = new THREE.Vector2(0.85, 0.85);
      entry.mat.roughnessMap = pbr.roughnessMap;
      entry.mat.needsUpdate = true;
    }
  };

  const attachShowcaseBuildings = (propsMap: Map<InteriorPropKind, THREE.Group>) => {
    for (const [bid, kind] of Object.entries(SHOWCASE_BUILDING_MAP)) {
      const fb = showcaseFallbacks.get(bid);
      const src = propsMap.get(kind);
      if (!fb || !src) continue;

      const inst = src.clone(true);
      inst.position.set(fb.spec.x, fb.spec.baseY, fb.spec.z);

      inst.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!(m instanceof THREE.MeshStandardMaterial)) continue;
          const n = m.name || '';
          if (n.startsWith('PBR_Plaster_')) showcasePbrMaterials.push({ mat: m, key: 'plaster' });
          else if (n.startsWith('PBR_Marble_')) showcasePbrMaterials.push({ mat: m, key: 'marble' });
          else if (n.startsWith('PBR_Concrete_')) showcasePbrMaterials.push({ mat: m, key: 'concrete' });
          else if (n.startsWith('PBR_Terracotta_')) showcasePbrMaterials.push({ mat: m, key: 'terracotta' });
          else if (n.startsWith('PBR_Parquet_')) showcasePbrMaterials.push({ mat: m, key: 'parquet' });
          else if (n.startsWith('PBR_Brick_')) showcasePbrMaterials.push({ mat: m, key: 'brick' });

          if (n.startsWith('Neon_')) {
            neonMaterials.push(m);
          } else if (n.startsWith('Glass_')) {
            windowMaterials.push(m);
          }
        }
      });

      showcaseBuildingsRoot.add(inst);
      fb.mesh.visible = false;
    }

    if (cachedShowcaseTexMap) {
      bindShowcaseTextures(cachedShowcaseTexMap);
    }
  };

  const applyShowcaseTextures = (texMap: InteriorTextureMap) => {
    cachedShowcaseTexMap = texMap;
    bindShowcaseTextures(texMap);
  };

  const attachWorldProps = (propsMap: Map<InteriorPropKind, THREE.Group>) => {
    const lifeguardSrc = propsMap.get('prop_lifeguard_tower');
    const umbrellaSrc = propsMap.get('prop_beach_umbrella');
    let attachedBeach = false;

    if (lifeguardSrc || umbrellaSrc) {
      for (const prop of blueprint.beachProps) {
        const src = prop.kind === 'lifeguard' ? lifeguardSrc : umbrellaSrc;
        if (!src) continue;
        const inst = src.clone(true);
        inst.position.set(prop.x, prop.y, prop.z);
        inst.rotation.y = prop.yaw;
        const tintName = prop.kind === 'lifeguard' ? 'TintBody' : 'TintCanopy';
        inst.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          obj.castShadow = prop.kind === 'lifeguard';
          obj.receiveShadow = true;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          const cloned = mats.map((m) => {
            if (m instanceof THREE.MeshStandardMaterial && m.name === tintName) {
              const c = m.clone();
              c.color.setHex(prop.color);
              return c;
            }
            return m;
          });
          obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
        });
        worldPropsGltfRoot.add(inst);
        attachedBeach = true;
      }
      if (attachedBeach && lifeguardSrc && umbrellaSrc) {
        fallbackBeachPropsRoot.visible = false;
      }
    }

    const hoopSrc = propsMap.get('prop_basketball_hoop');
    if (hoopSrc) {
      for (const side of [-1, 1]) {
        const inst = hoopSrc.clone(true);
        inst.position.set(-335, parkY, 25 + side * 14.4);
        inst.rotation.y = side === -1 ? 0 : Math.PI;
        inst.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        worldPropsGltfRoot.add(inst);
      }
      fallbackHoopsGroup.visible = false;
    }

    const lhSrc = propsMap.get('prop_lighthouse_pavilion');
    if (lhSrc && fallbackLighthouseSpec) {
      const inst = lhSrc.clone(true);
      inst.position.set(fallbackLighthouseSpec.x, fallbackLighthouseSpec.baseY, fallbackLighthouseSpec.z);
      inst.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial && m.name === 'LHBeaconGlow') {
            neonMaterials.push(m);
          }
        }
      });
      worldPropsGltfRoot.add(inst);
      if (fallbackLighthouseMesh) fallbackLighthouseMesh.visible = false;
      lighthouseBeacon.position.set(
        fallbackLighthouseSpec.x,
        fallbackLighthouseSpec.baseY + 13.25,
        fallbackLighthouseSpec.z,
      );
      lighthouseBeacon.scale.setScalar(0.55);
    }
  };

  const hideFallbackYachts = () => {
    for (const y of yachts) {
      y.group.visible = false;
    }
  };

  return {
    root,
    waterUniforms,
    neonMaterials,
    windowMaterials,
    streetLampMaterials,
    lighthouseBeacon,
    yachts,
    palmCrowns,
    applyPhotoTextures,
    attachGltfFountains,
    attachShowcaseBuildings,
    attachWorldProps,
    applyShowcaseTextures,
    hideFallbackYachts,
    updateAnimation,
  };
}
