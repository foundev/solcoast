import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LoadedGameAssets } from './assets';
import {
  CAUSEWAY,
  KEY_SOL_BOUNDS,
  SOUTH_PIER,
  getGroundHeight,
} from './cityData';
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

    // Shallow Miami turquoise water blending into rich Atlantic sapphire
    float coastDist = clamp((vWorldPos.x - 196.0) / 145.0, 0.0, 1.0);
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

    // Organic frothy shoreline surf along Sol Beach
    float shoreBand = smoothstep(226.0, 205.0, vWorldPos.x) * smoothstep(186.0, 201.0, vWorldPos.x);
    float foamNoise = noise(vWorldPos.xz * 0.38 + vec2(-uTime * 0.85, uTime * 0.2));
    float surfWave = sin(vWorldPos.x * 0.32 - uTime * 2.4 + foamNoise * 3.0) * 0.5 + 0.5;
    float foam = shoreBand * smoothstep(0.45, 0.82, surfWave * 0.65 + foamNoise * 0.55);
    waterCol = mix(waterCol, vec3(0.93, 0.97, 1.0), foam * 0.65 * (1.0 - uNightFactor * 0.55));

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
    b.style === 'skyscraper'
      ? Math.max(1, Math.round(b.height / 48))
      : Math.max(1, Math.round(b.height / 24));
  const key = `${b.style}-${b.wallColor}-${rx}-${ry}`;

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
        metalness: b.style === 'skyscraper' ? 0.52 : 0.14,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: pbr.emissiveMap,
        emissiveIntensity: 0.25,
        envMapIntensity: b.style === 'skyscraper' ? 1.6 : 1.05,
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

  // 2. Mainland Peninsula Base with PBR concrete sidewalk pavers
  const mainlandGeo = new THREE.BoxGeometry(408, 2.2, 420);
  const mainlandMat = new THREE.MeshStandardMaterial({
    map: sidewalkPbr.map,
    normalMap: sidewalkPbr.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: sidewalkPbr.roughnessMap,
    roughness: 1.0,
  });
  const mainland = new THREE.Mesh(mainlandGeo, mainlandMat);
  mainland.position.set(-44, -1.11, -18);
  mainland.receiveShadow = true;
  root.add(mainland);

  const seawallMat = new THREE.MeshStandardMaterial({ color: 0xdce0e8, roughness: 0.72 });
  const southWall = new THREE.Mesh(new THREE.BoxGeometry(408, 1.3, 1.4), seawallMat);
  southWall.position.set(-44, -0.1, 192.2);
  root.add(southWall);

  // 3. Boardwalk Promenade with weathered coastal timber planks
  const boardwalkMat = new THREE.MeshStandardMaterial({
    map: woodPbr.map,
    normalMap: woodPbr.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: woodPbr.roughnessMap,
    roughness: 1.0,
  });
  const boardwalk = new THREE.Mesh(new THREE.BoxGeometry(14, 0.32, 376), boardwalkMat);
  boardwalk.position.set(159, -0.05, 0);
  boardwalk.receiveShadow = true;
  root.add(boardwalk);

  // 4. Golden Sandy Beach with wind-rippled normal & quartz roughness map
  const beachGeo = new THREE.PlaneGeometry(60, 382, 20, 20);
  beachGeo.rotateX(-Math.PI * 0.5);
  const posAttr = beachGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const t = (lx + 30) / 60;
    posAttr.setY(i, -0.82 * t);
  }
  beachGeo.computeVertexNormals();
  const beachMat = new THREE.MeshStandardMaterial({
    map: sandPbr.map,
    normalMap: sandPbr.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: sandPbr.roughnessMap,
    roughness: 1.0,
  });
  const beachMesh = new THREE.Mesh(beachGeo, beachMat);
  beachMesh.position.set(194, -0.02, 2);
  beachMesh.receiveShadow = true;
  root.add(beachMesh);

  // 5. Key Sol Luxury Island
  const keySolGeo = new THREE.BoxGeometry(
    KEY_SOL_BOUNDS.maxX - KEY_SOL_BOUNDS.minX,
    2.4,
    KEY_SOL_BOUNDS.maxZ - KEY_SOL_BOUNDS.minZ,
  );
  const keySolMat = new THREE.MeshStandardMaterial({ color: 0x4f915c, roughness: 0.9 });
  const keySolMesh = new THREE.Mesh(keySolGeo, keySolMat);
  keySolMesh.position.set(
    (KEY_SOL_BOUNDS.minX + KEY_SOL_BOUNDS.maxX) * 0.5,
    KEY_SOL_BOUNDS.baseY - 1.22,
    (KEY_SOL_BOUNDS.minZ + KEY_SOL_BOUNDS.maxZ) * 0.5,
  );
  keySolMesh.receiveShadow = true;
  root.add(keySolMesh);

  const keySand = new THREE.Mesh(
    new THREE.BoxGeometry(
      KEY_SOL_BOUNDS.maxX - KEY_SOL_BOUNDS.minX + 12,
      1.6,
      KEY_SOL_BOUNDS.maxZ - KEY_SOL_BOUNDS.minZ + 12,
    ),
    beachMat,
  );
  keySand.position.set(
    (KEY_SOL_BOUNDS.minX + KEY_SOL_BOUNDS.maxX) * 0.5,
    -0.55,
    (KEY_SOL_BOUNDS.minZ + KEY_SOL_BOUNDS.maxZ) * 0.5,
  );
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

  // 8. South Pier (ramp + elevated timber deck + pilings + lighthouse)
  const pilingMat = new THREE.MeshStandardMaterial({ color: 0x523c28, roughness: 0.94 });
  const rampLen = SOUTH_PIER.rampEndX - SOUTH_PIER.startX;
  const rampSlope = Math.atan2(SOUTH_PIER.deckY, rampLen);
  const rampMesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.hypot(rampLen, SOUTH_PIER.deckY), 0.35, SOUTH_PIER.halfWidth * 2),
    boardwalkMat,
  );
  rampMesh.position.set(
    (SOUTH_PIER.startX + SOUTH_PIER.rampEndX) * 0.5,
    SOUTH_PIER.deckY * 0.5 - 0.16,
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

  // 9. Marina Cove timber yacht docks
  for (const dx of [-75, -15, 45]) {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.45, 52), boardwalkMat);
    dock.position.set(dx, 0.24, 215);
    dock.receiveShadow = true;
    root.add(dock);
  }

  // 10. Palm Plaza Central Park & Tiered Fountain
  const parkGrass = new THREE.Mesh(
    new THREE.BoxGeometry(66, 0.14, 66),
    new THREE.MeshStandardMaterial({ color: 0x38854f, roughness: 0.92 }),
  );
  parkGrass.position.set(25, 0.05, 25);
  parkGrass.receiveShadow = true;
  root.add(parkGrass);

  const pathMat = new THREE.MeshStandardMaterial({ color: 0xe2d7c8, roughness: 0.78 });
  const pathNS = new THREE.Mesh(new THREE.BoxGeometry(7, 0.17, 66), pathMat);
  pathNS.position.set(25, 0.06, 25);
  root.add(pathNS);
  const pathEW = new THREE.Mesh(new THREE.BoxGeometry(66, 0.17, 7), pathMat);
  pathEW.position.set(25, 0.06, 25);
  root.add(pathEW);

  const fountainRim = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.6, 1.1, 24), seawallMat);
  fountainRim.position.set(25, 0.55, 25);
  root.add(fountainRim);

  const fountainWaterMat = new THREE.MeshPhysicalMaterial({
    color: 0x1fd8e8,
    emissive: 0x0b96ad,
    emissiveIntensity: 0.65,
    roughness: 0.06,
    clearcoat: 1.0,
  });
  neonMaterials.push(fountainWaterMat);
  const fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 1.15, 24), fountainWaterMat);
  fountainWater.position.set(25, 0.62, 25);
  root.add(fountainWater);

  const fountainSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.65, 3.6, 16), seawallMat);
  fountainSpire.position.set(25, 1.8, 25);
  root.add(fountainSpire);

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

  for (const b of blueprint.buildings) {
    root.add(buildBuildingMesh(b, facadeCache, neonMaterials, windowMaterials, lobbyGlassMat, hvacMat));
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

  // 14. Beach Lifeguard Towers & Umbrellas
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
    root.add(g);
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
      beachMat.color.setHex(0xffe9c7);
      beachMat.needsUpdate = true;
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
    updateAnimation,
  };
}
