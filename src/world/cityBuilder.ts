import * as THREE from 'three';
import {
  CAUSEWAY,
  KEY_SOL_BOUNDS,
  SOUTH_PIER,
  getGroundHeight,
} from './cityData';
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
  updateAnimation: (elapsed: number, nightFactor: number, sunDir: THREE.Vector3, sunColor: THREE.Color, fogColor: THREE.Color) => void;
}

const OCEAN_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vWave;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float w1 = sin(wp.x * 0.055 + uTime * 1.15) * 0.24;
    float w2 = cos(wp.z * 0.048 - uTime * 0.92 + wp.x * 0.02) * 0.2;
    float w3 = sin((wp.x - wp.z) * 0.11 + uTime * 1.65) * 0.08;
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

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    // Animated water micro-normal
    float nx = cos(vWorldPos.x * 0.12 + uTime * 1.4) * 0.14 + sin(vWorldPos.z * 0.21 - uTime * 1.8) * 0.07;
    float nz = sin(vWorldPos.z * 0.11 - uTime * 1.25) * 0.14 + cos(vWorldPos.x * 0.19 + uTime * 1.5) * 0.07;
    vec3 normal = normalize(vec3(nx, 1.0, nz));

    // Turquoise tropical shallow water near beach transitioning to deep Atlantic teal
    float coastDist = clamp((vWorldPos.x - 195.0) / 140.0, 0.0, 1.0);
    vec3 shallowDay = vec3(0.08, 0.72, 0.78);
    vec3 deepDay = vec3(0.02, 0.24, 0.44);
    vec3 baseDay = mix(shallowDay, deepDay, coastDist);
    vec3 baseNight = vec3(0.015, 0.07, 0.15);
    vec3 waterCol = mix(baseDay, baseNight, uNightFactor);

    // Fresnel sky tint
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.2);
    waterCol = mix(waterCol, uFogColor * 0.92, clamp(fresnel * 0.65, 0.0, 0.7));

    // Sun specular glints across the ocean
    vec3 sunDir = normalize(uSunDir);
    vec3 halfVec = normalize(sunDir + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 96.0);
    waterCol += uSunColor * spec * mix(1.45, 0.35, uNightFactor);

    // Subtle crest foam near the beach shoreline
    float shoreBand = smoothstep(225.0, 204.0, vWorldPos.x) * smoothstep(185.0, 200.0, vWorldPos.x);
    float foamPattern = smoothstep(0.18, 0.36, vWave + sin(vWorldPos.z * 0.18 + uTime * 2.1) * 0.18);
    waterCol = mix(waterCol, vec3(0.92, 0.98, 1.0), shoreBand * foamPattern * 0.55 * (1.0 - uNightFactor * 0.55));

    // Exponential fog blend matching scene
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-pow(dist * 0.0014, 2.0));
    waterCol = mix(waterCol, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(waterCol, 0.94);
  }
`;

function createAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#252933';
  ctx.fillRect(0, 0, 256, 256);

  // Subtle asphalt grain
  for (let i = 0; i < 1600; i++) {
    const x = (i * 73) % 256;
    const y = (i * 137) % 256;
    const v = 30 + (i % 24);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 7})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // White shoulder stripes
  ctx.fillStyle = 'rgba(235, 240, 250, 0.85)';
  ctx.fillRect(10, 0, 4, 256);
  ctx.fillRect(242, 0, 4, 256);

  // Dashed double golden-yellow Miami centerlines
  ctx.fillStyle = '#f5c242';
  for (let y = 12; y < 256; y += 64) {
    ctx.fillRect(123, y, 3, 34);
    ctx.fillRect(130, y, 3, 34);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWindowFacadeTexture(baseHex: number, style: 'skyscraper' | 'art-deco' | 'neon-club'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const baseColor = new THREE.Color(baseHex);
  ctx.fillStyle = `#${baseColor.getHexString()}`;
  ctx.fillRect(0, 0, 256, 256);

  if (style === 'skyscraper') {
    // Sleek reflective curtain wall bands
    for (let y = 8; y < 256; y += 22) {
      ctx.fillStyle = 'rgba(130, 218, 255, 0.25)';
      ctx.fillRect(0, y, 256, 13);
      for (let x = 6; x < 250; x += 20) {
        const lit = ((x * 13 + y * 29) % 11) < 5;
        ctx.fillStyle = lit ? 'rgba(255, 232, 178, 0.78)' : 'rgba(14, 34, 54, 0.78)';
        ctx.fillRect(x, y + 2, 14, 9);
      }
    }
  } else if (style === 'art-deco') {
    // Horizontal stucco fluting + cozy boutique windows
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    for (let y = 0; y < 256; y += 32) {
      ctx.fillRect(0, y, 256, 4);
    }
    for (let y = 14; y < 248; y += 32) {
      for (let x = 14; x < 240; x += 38) {
        const lit = ((x + y * 3) % 7) < 4;
        ctx.fillStyle = lit ? '#ffe6a8' : '#24344c';
        ctx.fillRect(x, y, 22, 16);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, 22, 16);
      }
    }
  } else {
    // Neon strip clubs — dark architectural facade with vivid window slits
    for (let y = 20; y < 240; y += 44) {
      ctx.fillStyle = 'rgba(10, 12, 24, 0.85)';
      ctx.fillRect(10, y, 236, 20);
      ctx.fillStyle = ((y / 44) % 2 === 0) ? 'rgba(255, 70, 165, 0.65)' : 'rgba(44, 243, 255, 0.65)';
      ctx.fillRect(14, y + 6, 228, 6);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWoodPlankTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#9f7550';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    ctx.fillStyle = y % 32 === 0 ? '#a87d56' : '#946b47';
    ctx.fillRect(0, y, 128, 14);
    ctx.fillStyle = '#5e3f27';
    ctx.fillRect(0, y + 14, 128, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPalmTreeMesh(height: number, leanX: number, leanZ: number): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x8f7157,
    roughness: 0.92,
  });
  const frondMat = new THREE.MeshStandardMaterial({
    color: 0x2ca05a,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });

  // Curved segmented trunk
  const segments = 5;
  const segH = height / segments;
  let curX = 0;
  let curY = 0;
  let curZ = 0;

  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const rBot = 0.34 - t * 0.14;
    const rTop = 0.30 - t * 0.14;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, segH * 1.06, 6), trunkMat);
    const dx = leanX * segH * (i + 1) * 0.55;
    const dz = leanZ * segH * (i + 1) * 0.55;
    cyl.position.set(curX + dx * 0.5, curY + segH * 0.5, curZ + dz * 0.5);
    cyl.rotation.z = -leanX * (i + 1) * 0.25;
    cyl.rotation.x = leanZ * (i + 1) * 0.25;
    cyl.castShadow = true;
    group.add(cyl);
    curX += dx;
    curY += segH;
    curZ += dz;
  }

  // Crown of lush curved palm fronds
  const crown = new THREE.Group();
  crown.position.set(curX, curY, curZ);
  const frondCount = 8;
  for (let f = 0; f < frondCount; f++) {
    const angle = (f / frondCount) * Math.PI * 2;
    const frondPivot = new THREE.Group();
    frondPivot.rotation.y = angle;
    const frondLen = 3.2 + (f % 2) * 0.65;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.68, frondLen, 4), frondMat);
    leaf.scale.set(1.0, 1.0, 0.18);
    leaf.rotation.x = Math.PI * 0.58;
    leaf.position.set(0, -0.35, frondLen * 0.48);
    leaf.castShadow = true;
    frondPivot.add(leaf);
    crown.add(frondPivot);
  }
  group.add(crown);

  return group;
}

function buildArchedCauseway(asphaltTex: THREE.CanvasTexture, neonMaterials: THREE.MeshStandardMaterial[]): THREE.Group {
  const group = new THREE.Group();
  const segments = 24;
  const startX = CAUSEWAY.startX;
  const endX = CAUSEWAY.endX;
  const segLen = (endX - startX) / segments;

  const deckTex = asphaltTex.clone();
  deckTex.needsUpdate = true;
  deckTex.repeat.set(1, 0.7);
  deckTex.rotation = Math.PI * 0.5;
  deckTex.center.set(0.5, 0.5);

  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTex,
    roughness: 0.85,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xe6e9f2,
    roughness: 0.65,
  });
  const neonRailMat = new THREE.MeshStandardMaterial({
    color: 0x3ef2ff,
    emissive: 0x3ef2ff,
    emissiveIntensity: 1.5,
    roughness: 0.3,
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
    const hyp = Math.hypot(segLen, y1 - y0) + 0.18;

    const slab = new THREE.Mesh(new THREE.BoxGeometry(hyp, 0.55, CAUSEWAY.halfWidth * 2), deckMat);
    slab.position.set(xm, ym - 0.27, CAUSEWAY.centerZ);
    slab.rotation.z = slope;
    slab.receiveShadow = true;
    group.add(slab);

    // Side parapet rails + glowing cyan trim
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(hyp, 0.85, 0.55), concreteMat);
      rail.position.set(xm, ym + 0.35, CAUSEWAY.centerZ + side * (CAUSEWAY.halfWidth - 0.35));
      rail.rotation.z = slope;
      group.add(rail);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(hyp, 0.14, 0.18), neonRailMat);
      trim.position.set(xm, ym + 0.82, CAUSEWAY.centerZ + side * (CAUSEWAY.halfWidth - 0.35));
      trim.rotation.z = slope;
      group.add(trim);
    }

    // Bridge support piers into the bay every 4 segments
    if (i > 1 && i < segments - 2 && i % 4 === 0) {
      for (const side of [-5.8, 5.8]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, ym + 5, 8), concreteMat);
        pillar.position.set(xm, (ym - 5) * 0.5, CAUSEWAY.centerZ + side);
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
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(b.x, b.baseY, b.z);

  const key = `${b.style}-${b.wallColor}`;
  let wallMat = facadeCache.get(key);
  if (!wallMat) {
    if (b.style === 'villa' || b.style === 'pavilion') {
      wallMat = new THREE.MeshStandardMaterial({
        color: b.wallColor,
        roughness: 0.45,
        metalness: 0.08,
      });
    } else {
      const tex = createWindowFacadeTexture(b.wallColor, b.style);
      tex.repeat.set(Math.max(1, Math.round(b.width / 12)), Math.max(1, Math.round(b.height / 14)));
      wallMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: b.style === 'skyscraper' ? 0.25 : 0.62,
        metalness: b.style === 'skyscraper' ? 0.55 : 0.08,
        emissive: b.style === 'skyscraper' ? new THREE.Color(0x28364c) : new THREE.Color(0x1f1826),
        emissiveMap: tex,
        emissiveIntensity: 0.25,
      });
      windowMaterials.push(wallMat);
    }
    facadeCache.set(key, wallMat);
  }

  // Main tower volume
  const mainMesh = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.depth), wallMat);
  mainMesh.position.y = b.height * 0.5;
  mainMesh.castShadow = true;
  mainMesh.receiveShadow = true;
  group.add(mainMesh);

  // Architectural crown / stepped Art Deco parapet / modernist roof overhang
  const accentMat = new THREE.MeshStandardMaterial({
    color: b.accentColor,
    roughness: 0.4,
    metalness: 0.2,
  });

  if (b.style === 'art-deco') {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.72, 2.6, b.depth * 0.72),
      accentMat,
    );
    step.position.y = b.height + 1.3;
    step.castShadow = true;
    group.add(step);

    // Classic horizontal sun-visor awning above ground floor
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 1.2, 0.4, b.depth + 1.2),
      accentMat,
    );
    awning.position.y = 4.0;
    group.add(awning);
  } else if (b.style === 'skyscraper') {
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(b.width * 0.65, 3.8, b.depth * 0.65),
      accentMat,
    );
    crown.position.y = b.height + 1.9;
    group.add(crown);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.35, 9, 6), accentMat);
    spire.position.y = b.height + 8.0;
    group.add(spire);
  } else if (b.style === 'villa') {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 2.4, 0.7, b.depth + 2.4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }),
    );
    roof.position.y = b.height + 0.35;
    group.add(roof);

    // Panoramic glass band
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 0.25, b.height * 0.45, b.depth + 0.25),
      new THREE.MeshPhysicalMaterial({
        color: 0x3ec8e8,
        roughness: 0.1,
        metalness: 0.2,
        clearcoat: 1.0,
      }),
    );
    glass.position.y = b.height * 0.56;
    group.add(glass);
  }

  // Glowing Miami neon rooftop rim & vertical Art Deco fins
  if (b.neonColor !== undefined) {
    const neonMat = new THREE.MeshStandardMaterial({
      color: b.neonColor,
      emissive: b.neonColor,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    neonMaterials.push(neonMat);

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(b.width + 0.35, 0.42, b.depth + 0.35),
      neonMat,
    );
    rim.position.y = b.height - 0.5;
    group.add(rim);

    if (b.hasRoofSign) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.45, b.height * 0.55, 1.3), neonMat);
      fin.position.set(b.width * 0.5 + 0.25, b.height * 0.62, 0);
      group.add(fin);
    }
  }

  return group;
}

function buildYachtMesh(length: number, accentColor: number): THREE.Group {
  const group = new THREE.Group();
  const whiteMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7fbff,
    roughness: 0.22,
    clearcoat: 0.9,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x112538,
    roughness: 0.08,
    metalness: 0.3,
    clearcoat: 1.0,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.35,
  });

  const width = length * 0.28;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(width, 1.4, length * 0.78), whiteMat);
  hull.position.y = 0.6;
  hull.castShadow = true;
  group.add(hull);

  // Pointed bow
  const bow = new THREE.Mesh(new THREE.ConeGeometry(width * 0.65, length * 0.35, 4), whiteMat);
  bow.rotation.x = -Math.PI * 0.5;
  bow.rotation.y = Math.PI * 0.25;
  bow.position.set(0, 0.65, -length * 0.55);
  group.add(bow);

  // Upper cabin & dark wraparound windshield
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 1.3, length * 0.42), whiteMat);
  cabin.position.set(0, 1.85, length * 0.05);
  group.add(cabin);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(width * 0.75, 0.55, length * 0.34), glassMat);
  glass.position.set(0, 2.0, -length * 0.02);
  group.add(glass);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.22, length * 0.74), stripeMat);
  stripe.position.set(0, 1.0, 0);
  group.add(stripe);

  return group;
}

export function buildCityScene(scene: THREE.Scene, blueprint: CityBlueprint): CitySceneHandles {
  const root = new THREE.Group();
  const neonMaterials: THREE.MeshStandardMaterial[] = [];
  const windowMaterials: THREE.MeshStandardMaterial[] = [];
  const streetLampMaterials: THREE.MeshStandardMaterial[] = [];
  const yachts: { group: THREE.Group; baseY: number; phase: number }[] = [];

  const asphaltTex = createAsphaltTexture();
  const woodTex = createWoodPlankTexture();

  // 1. Animated Atlantic Ocean water plane
  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.6, 0.3, -0.5).normalize() },
    uSunColor: { value: new THREE.Color(0xffb870) },
    uFogColor: { value: new THREE.Color(0xd78f8c) },
    uNightFactor: { value: 0.15 },
  };
  const oceanGeo = new THREE.PlaneGeometry(1800, 1800, 110, 110);
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

  // 2. Mainland Peninsula Base & Sidewalk Concrete Slab
  const mainlandGeo = new THREE.BoxGeometry(408, 2.2, 420);
  const mainlandMat = new THREE.MeshStandardMaterial({
    color: 0xc8ccd6,
    roughness: 0.88,
  });
  const mainland = new THREE.Mesh(mainlandGeo, mainlandMat);
  mainland.position.set(-44, -1.11, -18);
  mainland.receiveShadow = true;
  root.add(mainland);

  // Seawall rim around peninsula edges
  const seawallMat = new THREE.MeshStandardMaterial({ color: 0xdfe3ec, roughness: 0.72 });
  const southWall = new THREE.Mesh(new THREE.BoxGeometry(408, 1.3, 1.4), seawallMat);
  southWall.position.set(-44, -0.1, 192.2);
  root.add(southWall);

  // 3. Boardwalk Promenade (pastel stone walkway along Ocean Drive)
  const boardwalkMat = new THREE.MeshStandardMaterial({ color: 0xe8d9c5, roughness: 0.78 });
  const boardwalk = new THREE.Mesh(new THREE.BoxGeometry(14, 0.32, 376), boardwalkMat);
  boardwalk.position.set(159, -0.05, 0);
  boardwalk.receiveShadow = true;
  root.add(boardwalk);

  // 4. Golden Sandy Beach (sloped gently into ocean)
  const beachGeo = new THREE.PlaneGeometry(60, 382, 16, 16);
  beachGeo.rotateX(-Math.PI * 0.5);
  const posAttr = beachGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i); // -30..+30
    const t = (lx + 30) / 60;
    posAttr.setY(i, -0.82 * t);
  }
  beachGeo.computeVertexNormals();
  const beachMat = new THREE.MeshStandardMaterial({ color: 0xf0d29c, roughness: 0.94 });
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
  const keySolMat = new THREE.MeshStandardMaterial({ color: 0x5ea86b, roughness: 0.88 });
  const keySolMesh = new THREE.Mesh(keySolGeo, keySolMat);
  keySolMesh.position.set(
    (KEY_SOL_BOUNDS.minX + KEY_SOL_BOUNDS.maxX) * 0.5,
    KEY_SOL_BOUNDS.baseY - 1.22,
    (KEY_SOL_BOUNDS.minZ + KEY_SOL_BOUNDS.maxZ) * 0.5,
  );
  keySolMesh.receiveShadow = true;
  root.add(keySolMesh);

  // Sandy island trim around Key Sol
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

  // 6. Road Network Surfaces (Avenues, Streets, Intersections, Key Sol Loop)
  const intersectionMat = new THREE.MeshStandardMaterial({ color: 0x262b36, roughness: 0.86 });
  for (const road of blueprint.roads) {
    if (road.isBridge) continue;
    const dx = road.x2 - road.x1;
    const dz = road.z2 - road.z1;
    const len = Math.hypot(dx, dz);
    const xm = (road.x1 + road.x2) * 0.5;
    const zm = (road.z1 + road.z2) * 0.5;
    const baseY = xm > 230 ? KEY_SOL_BOUNDS.baseY + 0.03 : 0.025;

    const tex = asphaltTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, Math.max(1, len / 18));
    const roadMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.84,
      metalness: 0.06,
    });

    const isHoriz = Math.abs(dx) > Math.abs(dz);
    const geo = new THREE.PlaneGeometry(road.width, len);
    geo.rotateX(-Math.PI * 0.5);
    if (isHoriz) {
      geo.rotateY(Math.PI * 0.5);
    }
    const mesh = new THREE.Mesh(geo, roadMat);
    mesh.position.set(xm, baseY, zm);
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // Clean intersection pads & crosswalk stripes
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xeef3fa, roughness: 0.7 });
  for (const ax of blueprint.avenueXs) {
    for (const sz of blueprint.streetZs) {
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(blueprint.roadWidth + 0.6, blueprint.roadWidth + 0.6),
        intersectionMat,
      );
      pad.rotation.x = -Math.PI * 0.5;
      pad.position.set(ax, 0.04, sz);
      pad.receiveShadow = true;
      root.add(pad);

      // Zebra crosswalk bars on each side
      for (let s = -5; s <= 5; s += 2.5) {
        const barN = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.8), stripeMat);
        barN.rotation.x = -Math.PI * 0.5;
        barN.position.set(ax + s, 0.052, sz - 9.4);
        root.add(barN);

        const barE = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.1), stripeMat);
        barE.rotation.x = -Math.PI * 0.5;
        barE.position.set(ax + 9.4, 0.052, sz + s);
        root.add(barE);
      }
    }
  }

  // 7. Key Sol Causeway Arch Bridge
  root.add(buildArchedCauseway(asphaltTex, neonMaterials));

  // 8. South Pier (ramp + elevated wooden deck + pilings + lighthouse beacon)
  const pierMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 });
  const pilingMat = new THREE.MeshStandardMaterial({ color: 0x5c422c, roughness: 0.92 });
  const rampLen = SOUTH_PIER.rampEndX - SOUTH_PIER.startX;
  const rampSlope = Math.atan2(SOUTH_PIER.deckY, rampLen);
  const rampMesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.hypot(rampLen, SOUTH_PIER.deckY), 0.35, SOUTH_PIER.halfWidth * 2),
    pierMat,
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
    pierMat,
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
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 4.2, 6), pilingMat);
      piling.position.set(px, SOUTH_PIER.deckY - 2.1, SOUTH_PIER.centerZ + side);
      root.add(piling);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.28), seawallMat);
      post.position.set(px, SOUTH_PIER.deckY + 0.5, SOUTH_PIER.centerZ + side * 1.15);
      root.add(post);
    }
  }

  // Pier warm rail lights
  const pierGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffd17a,
    emissive: 0xffb347,
    emissiveIntensity: 1.8,
  });
  streetLampMaterials.push(pierGlowMat);
  for (let px = SOUTH_PIER.rampEndX + 8; px <= SOUTH_PIER.endX - 10; px += 22) {
    for (const side of [-6.4, 6.4]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), pierGlowMat);
      bulb.position.set(px, SOUTH_PIER.deckY + 1.15, SOUTH_PIER.centerZ + side);
      root.add(bulb);
    }
  }

  // Lighthouse spinning glowing beacon top
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xffef99,
    emissive: 0xffcf5c,
    emissiveIntensity: 3.0,
  });
  neonMaterials.push(beaconMat);
  const lighthouseBeacon = new THREE.Mesh(new THREE.OctahedronGeometry(1.35, 1), beaconMat);
  lighthouseBeacon.position.set(279, SOUTH_PIER.deckY + 15.6, SOUTH_PIER.centerZ);
  root.add(lighthouseBeacon);

  // 9. Marina Cove wooden yacht docks
  for (const dx of [-75, -15, 45]) {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.45, 52), pierMat);
    dock.position.set(dx, 0.24, 215);
    dock.receiveShadow = true;
    root.add(dock);
  }

  // 10. Palm Plaza Central Park & Tiered Fountain
  const parkGrass = new THREE.Mesh(
    new THREE.BoxGeometry(66, 0.14, 66),
    new THREE.MeshStandardMaterial({ color: 0x3f9c5f, roughness: 0.9 }),
  );
  parkGrass.position.set(25, 0.05, 25);
  parkGrass.receiveShadow = true;
  root.add(parkGrass);

  const pathMat = new THREE.MeshStandardMaterial({ color: 0xe6dccd, roughness: 0.82 });
  const pathNS = new THREE.Mesh(new THREE.BoxGeometry(7, 0.17, 66), pathMat);
  pathNS.position.set(25, 0.06, 25);
  root.add(pathNS);
  const pathEW = new THREE.Mesh(new THREE.BoxGeometry(66, 0.17, 7), pathMat);
  pathEW.position.set(25, 0.06, 25);
  root.add(pathEW);

  // Fountain basin & glowing turquoise water
  const fountainRim = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.6, 1.1, 16), seawallMat);
  fountainRim.position.set(25, 0.55, 25);
  root.add(fountainRim);

  const fountainWaterMat = new THREE.MeshStandardMaterial({
    color: 0x2cf3ff,
    emissive: 0x0ec6de,
    emissiveIntensity: 0.85,
    roughness: 0.12,
  });
  neonMaterials.push(fountainWaterMat);
  const fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 1.15, 16), fountainWaterMat);
  fountainWater.position.set(25, 0.62, 25);
  root.add(fountainWater);

  const fountainSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 3.6, 12), seawallMat);
  fountainSpire.position.set(25, 1.8, 25);
  root.add(fountainSpire);

  // 11. All City Buildings
  const facadeCache = new Map<string, THREE.MeshStandardMaterial>();
  for (const b of blueprint.buildings) {
    root.add(buildBuildingMesh(b, facadeCache, neonMaterials, windowMaterials));
  }

  // 12. Palm Trees
  for (const p of blueprint.palms) {
    const palm = createPalmTreeMesh(p.height, p.leanX, p.leanZ);
    palm.position.set(p.x, p.y, p.z);
    palm.rotation.y = p.seed;
    root.add(palm);
  }

  // 13. Streetlights
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x30394b, metalness: 0.6, roughness: 0.4 });
  const lampMatByColor = new Map<number, THREE.MeshStandardMaterial>();
  for (const sl of blueprint.streetLights) {
    let lampMat = lampMatByColor.get(sl.color);
    if (!lampMat) {
      lampMat = new THREE.MeshStandardMaterial({
        color: sl.color,
        emissive: sl.color,
        emissiveIntensity: 1.6,
      });
      lampMatByColor.set(sl.color, lampMat);
      streetLampMaterials.push(lampMat);
    }
    const g = new THREE.Group();
    g.position.set(sl.x, sl.y, sl.z);
    g.rotation.y = sl.yaw;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 6.8, 6), poleMat);
    pole.position.y = 3.4;
    g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.6), poleMat);
    arm.position.set(0, 6.7, 0.7);
    g.add(arm);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.75), lampMat);
    bulb.position.set(0, 6.58, 1.35);
    g.add(bulb);
    root.add(g);
  }

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
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.3, 3.0), hutMat);
      cabin.position.y = 3.45;
      cabin.castShadow = true;
      g.add(cabin);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.2, 4), legMat);
      roof.rotation.y = Math.PI * 0.25;
      roof.position.y = 5.1;
      g.add(roof);
    } else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), seawallMat);
      pole.position.y = 1.3;
      g.add(pole);
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(1.9, 0.65, 8),
        new THREE.MeshStandardMaterial({ color: prop.color, roughness: 0.65 }),
      );
      canopy.position.y = 2.6;
      canopy.castShadow = true;
      g.add(canopy);
    }
    root.add(g);
  }

  // 15. Moored & Offshore Yachts
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

    // Make Miami neon & building windows glow dramatically at sunset & night
    const neonIntensity = 0.75 + nightFactor * 2.2;
    for (const mat of neonMaterials) {
      mat.emissiveIntensity = neonIntensity;
    }
    const winIntensity = 0.12 + nightFactor * 0.82;
    for (const mat of windowMaterials) {
      mat.emissiveIntensity = winIntensity;
    }
    const lampIntensity = 0.35 + nightFactor * 2.6;
    for (const mat of streetLampMaterials) {
      mat.emissiveIntensity = lampIntensity;
    }

    lighthouseBeacon.rotation.y = elapsed * 1.6;
    lighthouseBeacon.position.y = SOUTH_PIER.deckY + 15.6 + Math.sin(elapsed * 2.2) * 0.25;

    for (const y of yachts) {
      y.group.position.y = y.baseY + Math.sin(elapsed * 1.3 + y.phase) * 0.16;
      y.group.rotation.z = Math.sin(elapsed * 0.9 + y.phase) * 0.03;
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
    updateAnimation,
  };
}
